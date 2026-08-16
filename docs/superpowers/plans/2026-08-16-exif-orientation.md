# EXIF Orientation em Thumbnails e Dimensões do Masonry (#43) — Implementation Plan

> **Para agentes workers (se delegado):** Implementar EXATAMENTE as tasks abaixo, na ordem. Cada passo tem resultado esperado. **REGRAS INVIOLÁVEIS no final.** Não pule steps, não improvise.

**Goal:** Corrigir #43 — thumbnails e dimensões de layout respeitando o EXIF Orientation, para fotos de câmera/celular renderizarem em pé no grid e no slide view.

**Architecture:** Nenhuma mudança de arquitetura. Extensão dos comandos Tauri existentes (`generate_thumbnail`, `get_image_dimensions`) + novo módulo Rust puro `orientation.rs` (parse do EXIF Orientation tag 0x0112 no IFD0 de JPEG/TIFF, e funções de transformação de imagem/dimensões). No frontend, único bump do diretório de cache de thumbnails para regenerar arquivos existentes (o hot path TS não muda).

**Tech Stack:** Rust (crate `image` 0.24.9 — **NÃO tem** `apply_orientation`, rotação será com `imageops` após o downscale), TypeScript (`src/ipc/renderer.ts`), fixture JPEG gerada com System.Drawing (test fixture).

---

## Contexto que o executor precisa saber

- O bug (origem: upstream `allusion-app/Allusion#641`): câmeras salvam a foto na orientação nativa e giram via EXIF `Orientation` (1-8). O thumbnail Rust decodifica com `image::open` (ignora EXIF) e o `get_image_dimensions` lê as dimensões físicas do cabeçalho — fotos renderizam deitadas no grid (masonry usa essas dimensões) e no slide.
- Formas de renderização atuais:
  - `get_image_dimensions` (src-tauri/src/commands/image.rs) — usado no indexing (`ExifIO.getDimensions` → `file.width/height` no DB → masonry em `MasonryNativeAdapter`).
  - `generate_thumbnail` (src-tauri/src/commands/thumbnail.rs) — usado para arquivos grandes (> `thumbnailMaxSize`); o thumbnail WebP resultante é o olhar do grid/slide.
  - Imagens pequenas (≤ `thumbnailMaxSize`) usam o arquivo original direto (`thumbnailPath === absolutePath`) — o WebView aplica EXIF orientation sozinho (CSS `from-image`), não há bug nesses casos. O bug atinge apenas thumbnails WebP gerados pelo Rust.
- `image` 0.24.9 não possui `ImageDecoder::apply_orientation` nem `JpegDecoder::orientation()`. Implementação: ler a tag via parse manual dos bytes (JPEG APP1 "Exif\0\0" ou TIFF standalone) e aplicar rotação/flip com `DynamicImage` (métodos `fliph()`, `flipv()`, `rotate90()`, `rotate180()`, `rotate270()`).
- **MAPA EXIF (1-8)**: 1=normal, 2=flip horizontal, 3=rotate180, 4=flip vertical, 5=transpose (fliph+rotate90), 6=rotate90 CW, 7=transverse (fliph+rotate270), 8=rotate270 CW. Para 5/6/7/8 as dimensões trocam (w↔h).
- **Memória (importante, ver #42)**: a ordem correta no thumbnail é **decodificar → resize → aplicar orientação**, para que a transformação rode sobre o buffer pequeno (rotacionar a imagem full-size alocaria outro buffer de ~130MB).
- **Cache**: thumbnails existentes nunca regeneram para formatos 'web' (`verifyAndGenerateThumbnail` em `src/frontend/image/ImageLoader.ts:166`). Para que a correção valha para arquivos já indexados, o diretório de cache muda de `Allusion/thumbnails` para `Allusion/thumbnails-v2` (`getDefaultThumbnailDirectory` em `src/ipc/renderer.ts:388`) — regeneração passa a ser lazy (por viewport), sem bulk scan.
- `read_dimensions(bytes)` (image.rs:166) já parseia JPEG SOF; o módulo de orientação NÃO decodifica a imagem, apenas o cabeçalho APP1/IFD0 — custo marginal desprezível no indexing.
- Fixture de teste: `resources/test_images/oriented_200x100_o6.jpg` (JPEG 200x100 com EXIF Orientation=6) — GERAR ANTES dos testes, ver Task 0.

---

### Task 0: Gerar a fixture JPEG com EXIF Orientation=6

**Files:**
- Create: `resources/test_images/oriented_200x100_o6.jpg` (binário, ~1-2 KB)

- [ ] **Step 1:** Rodar no PowerShell (System.Drawing disponível) para criar um JPEG 200x100 com PropertyItem EXIF Orientation=6:

```powershell
Add-Type -AssemblyName System.Drawing
$bmp = New-Object System.Drawing.Bitmap(200, 100)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.Clear([System.Drawing.Color]::CornflowerBlue)
$brush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::Orange)
$g.FillRectangle($brush, 0, 0, 100, 100)
$item = [System.Drawing.Imaging.PropertyItem]::new()
$item.Id = 0x0112
$item.Type = 3
$item.Len = 2
$item.Value = [byte[]](6, 0)
$bmp.SetPropertyItem($item)
$enc = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }
$ep = New-Object System.Drawing.Imaging.EncoderParameters(1)
$ep.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter([System.Drawing.Imaging.Encoder]::Quality, [long]85)
$bmp.Save('D:\vibe-coding\02-native\allusion\resources\test_images\oriented_200x100_o6.jpg', $enc, $ep)
$g.Dispose(); $bmp.Dispose()
```

- [ ] **Step 2:** Confirmar que o arquivo existe, tem entre 1 e 20 KB, e que os bytes contêm a sequência ASCII `Exif` (busca binária). Resultado esperado: arquivo válido, 1-20 KB, contém "Exif".

---

### Task 1: Testes (TDD, devem falhar ANTES da implementação)

**Files:**
- Create: `src-tauri/src/orientation.rs` (apenas o bloco `#[cfg(test)] mod tests` NESTA task? NÃO — ver instrução: escrever o arquivo COMPLETO com implementação vazia/faltante e testes que falham. Para simplicidade e determinismo: criar o arquivo com as funções PÚBLICAS stubs (`todo!()`/incompletas) + testes; depois Task 2 preenche o corpo.)
- Modify: `src-tauri/src/commands/image.rs` (adicionar sessão `#[cfg(test)]` — estender `mod tests` existente com novos testes que chamam a futura função do comando)
- Modify: `src-tauri/src/commands/thumbnail.rs` (estender `mod tests` com teste de integração da fixture)

- [ ] **Step 1:** Criar `src-tauri/src/orientation.rs` com as assinaturas públicas E os testes abaixo (corpos das funções preenchidos na Task 2; comece com implementações mínimas que falhem — p.ex. `pub fn read_exif_orientation(_b: &[u8]) -> Option<u8> { None }` e `pub fn apply_exif_orientation(img: DynamicImage, _o: u8) -> DynamicImage { img }`):

```rust
//! Suporte ao EXIF Orientation (tag 0x0112) para thumbnails e dimensões (#43).

use image::DynamicImage;

/// Valor do EXIF Orientation que indica imagem não rotacionada.
pub const ORIENTATION_NORMAL: u8 = 1;

/// Lê a tag EXIF Orientation (SHORT, IFD0) dos bytes de um JPEG ou TIFF, sem
/// decodificar a imagem. `None` quando ausente/ilegível.
pub fn read_exif_orientation(bytes: &[u8]) -> Option<u8> { /* Task 2 */ }

/// Troca largura/altura quando a orientação 5-8 gira a imagem em 90°/270°.
pub fn oriented_dimensions(width: u32, height: u32, orientation: Option<u8>) -> (u32, u32) { /* Task 2 */ }

/// Aplica a orientação EXIF numa imagem decodificada (1 = identidade).
pub fn apply_exif_orientation(img: DynamicImage, orientation: u8) -> DynamicImage { /* Task 2 */ }

#[cfg(test)]
mod tests {
    use super::*;
    use image::ImageBuffer;

    /// Monta um JPEG sintético: FFD8 + APP1("Exif\0\0" + TIFF LE com 1 entry: tag 0x0112 = orientation) + SOF0 (w x h).
    fn jpeg_with_orientation(w: u16, h: u16, orientation: u8) -> Vec<u8> {
        let mut b: Vec<u8> = vec![];
        b.extend_from_slice(&[0xFF, 0xD8]); // SOI
        // TIFF header LE (II 2A 00, IFD0 @ 8)
        let mut tiff: Vec<u8> = vec![];
        tiff.extend_from_slice(b"II\x2A\x00");
        tiff.extend_from_slice(&8u32.to_le_bytes()); // offset IFD0
        tiff.extend_from_slice(&1u16.to_le_bytes()); // 1 entry
        // entry: tag 0x0112, type SHORT(3), count 1, value inline
        tiff.extend_from_slice(&0x0112u16.to_le_bytes());
        tiff.extend_from_slice(&3u16.to_le_bytes());
        tiff.extend_from_slice(&1u32.to_le_bytes());
        tiff.extend_from_slice(&u16::from(orientation).to_le_bytes());
        tiff.extend_from_slice(&[0, 0]); // padding do valor
        tiff.extend_from_slice(&0u32.to_le_bytes()); // next IFD
        // APP1
        let payload = [b"Exif\x00\x00".as_slice(), &tiff].concat();
        let seg_len = (payload.len() + 2) as u16;
        b.extend_from_slice(&[0xFF, 0xE1]);
        b.extend_from_slice(&seg_len.to_be_bytes());
        b.extend_from_slice(&payload);
        // SOF0: len 11, precision 8, h, w
        b.extend_from_slice(&[0xFF, 0xC0, 0x00, 0x11, 0x08]);
        b.extend_from_slice(&h.to_be_bytes());
        b.extend_from_slice(&w.to_be_bytes());
        b.push(0x00); // componentes
        b
    }

    fn dummy_image(w: u32, h: u32) -> DynamicImage {
        DynamicImage::ImageRgba8(ImageBuffer::from_pixel(w, h, image::Rgba([10, 20, 30, 255])))
    }

    #[test]
    fn reads_orientation_from_synthetic_jpeg() {
        assert_eq!(read_exif_orientation(&jpeg_with_orientation(200, 100, 6)), Some(6));
        assert_eq!(read_exif_orientation(&jpeg_with_orientation(200, 100, 1)), Some(1));
    }

    #[test]
    fn returns_none_when_exif_absent() {
        let no_exif = [0xFF, 0xD8, 0xFF, 0xC0, 0x00, 0x11, 0x08, 0x00, 0x64, 0x00, 0xC8, 0x00];
        assert_eq!(read_exif_orientation(&no_exif), None);
        assert_eq!(read_exif_orientation(b"not an image"), None);
    }

    #[test]
    fn reads_orientation_from_standalone_tiff() {
        let mut tiff: Vec<u8> = vec![];
        tiff.extend_from_slice(b"II\x2A\x00");
        tiff.extend_from_slice(&8u32.to_le_bytes());
        tiff.extend_from_slice(&1u16.to_le_bytes());
        tiff.extend_from_slice(&0x0112u16.to_le_bytes());
        tiff.extend_from_slice(&3u16.to_le_bytes());
        tiff.extend_from_slice(&1u32.to_le_bytes());
        tiff.extend_from_slice(&8u16.to_le_bytes());
        tiff.extend_from_slice(&[0, 0]);
        tiff.extend_from_slice(&0u32.to_le_bytes());
        assert_eq!(read_exif_orientation(&tiff), Some(8));
    }

    #[test]
    fn swaps_dimensions_only_for_quarter_rotations() {
        assert_eq!(oriented_dimensions(800, 600, Some(6)), (600, 800));
        assert_eq!(oriented_dimensions(800, 600, Some(5)), (600, 800));
        assert_eq!(oriented_dimensions(800, 600, Some(8)), (600, 800));
        assert_eq!(oriented_dimensions(800, 600, Some(7)), (600, 800));
        assert_eq!(oriented_dimensions(800, 600, Some(1)), (800, 600));
        assert_eq!(oriented_dimensions(800, 600, Some(3)), (800, 600));
        assert_eq!(oriented_dimensions(800, 600, None), (800, 600));
    }

    #[test]
    fn rotates_quarter_turns_and_flips() {
        let base = dummy_image(4, 2);
        let r90 = apply_exif_orientation(base.clone(), 6);
        assert_eq!(r90.dimensions(), (2, 4));
        let r270 = apply_exif_orientation(base.clone(), 8);
        assert_eq!(r270.dimensions(), (2, 4));
        let r180 = apply_exif_orientation(base.clone(), 3);
        assert_eq!(r180.dimensions(), (4, 2));
        let normal = apply_exif_orientation(base.clone(), 1);
        assert_eq!(normal.dimensions(), (4, 2));
        // flip não muda dimensões
        assert_eq!(apply_exif_orientation(base.clone(), 2).dimensions(), (4, 2));
        assert_eq!(apply_exif_orientation(base.clone(), 5).dimensions(), (2, 4));
        assert_eq!(apply_exif_orientation(base.clone(), 7).dimensions(), (2, 4));
    }
}
```

- [ ] **Step 2:** Em `src-tauri/src/commands/image.rs` — dentro do `mod tests` existente, adicionar os testes (vão falhar pois o comando ainda não usa orientação):

```rust
    fn jpeg_with_orientation(w: u16, h: u16, orientation: u8) -> Vec<u8> {
        // reutiliza a mesma construção da Task 1 Step 1 (APP1 "Exif\0\0"). Caminho alternativo
        // aceito: chamar crate::orientation::tests::jpeg_with_orientation se o crate o expuser
        // — preferir duplicar a helper local para não acoplar testes entre módulos.
        // (copiar a função intacta do Step 1)
    }

    #[test]
    fn dimensions_respect_exif_orientation() {
        let bytes = jpeg_with_orientation(200, 100, 6);
        let dims = read_dimensions(&bytes).expect("SOF should parse");
        assert_eq!(dims, (200, 100));
        // O comando deve retornar as dimensões JÁ orientadas (retrato):
        // (implementar como teste do caminho completo via nova função pública do módulo)
    }
```

IMPORTANTE: como `read_dimensions` é uma função pura e o swap de orientação é feito pelo `read_exif_orientation` + `oriented_dimensions`, o teste REAL deve cobrir o comando. Adicionar função pública interna no mesmo módulo de commands:

```rust
/// Dimensões com EXIF Orientation aplicado (5-8 trocam w/h).
pub fn read_dimensions_oriented(bytes: &[u8]) -> Option<(u32, u32)> {
    let (w, h) = read_dimensions(bytes)?;
    Some(crate::orientation::oriented_dimensions(w, h, crate::orientation::read_exif_orientation(bytes)))
}
```

e testá-la:

```rust
    #[test]
    fn oriented_dimensions_from_synthetic_jpeg() {
        let bytes = jpeg_with_orientation(200, 100, 6);
        assert_eq!(read_dimensions_oriented(&bytes), Some((100, 200)));
        let bytes = jpeg_with_orientation(200, 100, 1);
        assert_eq!(read_dimensions_oriented(&bytes), Some((200, 100)));
        assert_eq!(read_dimensions_oriented(&png_bytes(640, 480)), Some((640, 480)));
    }
```

`get_image_dimensions` (comando) passa a usar `read_dimensions_oriented(&bytes)`.

- [ ] **Step 3:** Em `src-tauri/src/commands/thumbnail.rs` — dentro do `mod tests`, adicionar:

```rust
    #[test]
    fn generates_rotated_thumbnail_for_oriented_jpg() {
        let src = test_images_dir().join("oriented_200x100_o6.jpg");
        let out = temp_out("oriented").join("thumb.webp");
        let _ = fs::remove_dir_all(out.parent().unwrap());

        let result =
            generate_thumbnail_impl(&src.to_string_lossy(), &out.to_string_lossy(), 100).unwrap();

        assert!(result.generated);
        let decoded = image::load_from_memory(&fs::read(&out).unwrap()).unwrap();
        let (w, h) = decoded.dimensions();
        assert_eq!((w, h), (50, 100), "EXIF orientation 6 must produce a portrait thumbnail");
        let _ = fs::remove_dir_all(out.parent().unwrap());
    }
```

(somente após a Task 3 o resultado será (50,100); antes, o teste falha com (100,50) — estado RED desejado).

- [ ] **Step 4:** Rodar `cargo test -p allusion orientation` (ou `cargo test orientation::`) e confirmar que os testes de orientação FALHAM como esperado (RED). Também rodar `cargo test image::` e `cargo test thumbnail::` e anotar as falhas esperadas (generates_rotated_thumbnail_for_oriented_jpg falha com dimensões (100,50)).

**Resultado esperado do Step 4:** pelo menos 4 testes falhando, todos relacionados às funções novas/stubs — NENHUM teste pré-existente falhando.

---

### Task 2: Implementar `orientation.rs` (GREEN)

**Files:**
- Modify: `src-tauri/src/orientation.rs` (corpos das 3 funções)

- [ ] **Step 1:** Preencher `read_exif_orientation`:

```rust
pub fn read_exif_orientation(bytes: &[u8]) -> Option<u8> {
    let tiff = find_tiff(bytes)?;
    let value = read_orientation_from_ifd(tiff)?;
    (1..=8).contains(&value).then_some(value)
}

/// Localiza o payload TIFF: dentro do APP1 "Exif\0\0" (JPEG) ou arquivo TIFF standalone.
fn find_tiff(bytes: &[u8]) -> Option<&[u8]> {
    if bytes.starts_with(&[0xFF, 0xD8]) {
        let mut i = 2usize;
        while i + 4 < bytes.len() {
            if bytes[i] != 0xFF { i += 1; continue; }
            let marker = bytes[i + 1];
            if marker == 0x01 || (0xD0..=0xD7).contains(&marker) || marker == 0xD9 || marker == 0xFF {
                i += 2; continue;
            }
            let seg_len = u16::from_be_bytes([bytes[i + 2], bytes[i + 3]]) as usize;
            if marker == 0xE1 && seg_len >= 8 && i + 2 + seg_len <= bytes.len() {
                let payload = &bytes[i + 4..i + 2 + seg_len];
                if payload.len() >= 6 && &payload[0..6] == b"Exif\0\0" {
                    return Some(&payload[6..]);
                }
            }
            i += 2 + seg_len;
        }
        None
    } else if bytes.len() >= 8 && (bytes.starts_with(b"II*\0") || bytes.starts_with(b"MM\0*")) {
        Some(bytes)
    } else {
        None
    }
}

/// Lê a tag 0x0112 (SHORT) do IFD0 de um TIFF (LE ou BE).
fn read_orientation_from_ifd(tiff: &[u8]) -> Option<u16> {
    if tiff.len() < 8 { return None; }
    let le = tiff.starts_with(b"II");
    let read_u16 = |off: usize| -> Option<u16> {
        let b = tiff.get(off..off + 2)?;
        Some(if le { u16::from_le_bytes([b[0], b[1]]) } else { u16::from_be_bytes([b[0], b[1]]) })
    };
    let read_u32 = |off: usize| -> Option<u32> {
        let b = tiff.get(off..off + 4)?;
        Some(if le { u32::from_le_bytes([b[0], b[1], b[2], b[3]]) } else { u32::from_be_bytes([b[0], b[1], b[2], b[3]]) })
    };
    let ifd0 = read_u32(4)? as usize;
    let count = read_u16(ifd0)? as usize;
    for entry in 0..count {
        let e = ifd0 + 2 + entry * 12;
        let tag = read_u16(e)?;
        if tag == 0x0112 {
            let typ = read_u16(e + 2)?;
            let count = read_u32(e + 4)?;
            if typ == 3 && count >= 1 {
                return read_u16(e + 8); // valor SHORT fica inline no campo Value
            }
            return None;
        }
    }
    None
}
```

- [ ] **Step 2:** Preencher `oriented_dimensions` e `apply_exif_orientation`:

```rust
pub fn oriented_dimensions(width: u32, height: u32, orientation: Option<u8>) -> (u32, u32) {
    match orientation {
        Some(5) | Some(6) | Some(7) | Some(8) => (height, width),
        _ => (width, height),
    }
}

pub fn apply_exif_orientation(mut img: DynamicImage, orientation: u8) -> DynamicImage {
    match orientation {
        2 => img.fliph(),
        3 => img.rotate180(),
        4 => img.flipv(),
        5 => img.fliph().rotate90(),
        6 => img.rotate90(),
        7 => img.fliph().rotate270(),
        8 => img.rotate270(),
        _ => img,
    }
}
```

Antes de seguir, VALIDAR que `DynamicImage` 0.24.9 expõe `fliph()`, `flipv()`, `rotate90()`, `rotate180()`, `rotate270()` (grep em `~/.cargo/registry/src/index.crates.io-*/image-0.24.9/src/dynamicimage.rs`). Se algum faltar, substituir pela chamada equivalente de `image::imageops` (`rotate90(&img)` devolve DynamicImage; `flip_horizontal(&img)`) — o compilador dirá.

- [ ] **Step 3:** Registrar o módulo: em `src-tauri/src/commands/mod.rs`, adicionar `pub mod orientation;` (ou `mod orientation;` se virar helper interno — preferir `pub(crate)`). Verificar como `commands/mod.rs` declara os módulos existentes e seguir o mesmo padrão.

- [ ] **Step 4:** Rodar `cargo test orientation::` — todos os testes de `orientation.rs` devem passar (GREEN). Não progredir se algum falhar: corrigir a implementação ou o teste, reportando.

**Resultado esperado:** `cargo test orientation::` verde.

---

### Task 3: Integrar no thumbnail e nas dimensões (GREEN dos módulos dependentes)

**Files:**
- Modify: `src-tauri/src/commands/thumbnail.rs`
- Modify: `src-tauri/src/commands/image.rs`

- [ ] **Step 1** (`thumbnail.rs`): alterar `generate_thumbnail_impl` para ler os bytes UMA vez e decodificar deles, aplicar orientação após o resize:

De (linhas atuais ~57-84):
```rust
    let mut img = image::open(path).map_err(|e| format!("failed to decode image: {e}"))?;
    let (width, height) = img.dimensions();
    if width == 0 || height == 0 {
        return Err("empty image".to_string());
    }

    if width.max(height) > target_size.max(1) {
        let (new_width, new_height) = scale_dimensions(width, height, target_size.max(1));
        img = image::DynamicImage::ImageRgba8(image::imageops::resize(
            &img,
            new_width,
            new_height,
            image::imageops::FilterType::Triangle,
        ));
    }
```

Para:
```rust
    let bytes = fs::read(path).map_err(|e| format!("failed to read image: {e}"))?;
    let orientation = crate::commands::orientation::read_exif_orientation(&bytes).unwrap_or(1);
    let mut img = image::load_from_memory(&bytes)
        .map_err(|e| format!("failed to decode image: {e}"))?;
    let (width, height) = img.dimensions();
    if width == 0 || height == 0 {
        return Err("empty image".to_string());
    }

    if width.max(height) > target_size.max(1) {
        let (new_width, new_height) = scale_dimensions(width, height, target_size.max(1));
        img = image::DynamicImage::ImageRgba8(image::imageops::resize(
            &img,
            new_width,
            new_height,
            image::imageops::FilterType::Triangle,
        ));
    }
    // Rotaciona/flip no buffer já reduzido (#43): a transformação em full-size
    // alocaria outro buffer do tamanho do arquivo original (#42).
    if orientation != 1 {
        img = crate::commands::orientation::apply_exif_orientation(img, orientation);
    }
```

NOTA: a régua de RAM continua valendo — `load_from_memory` decodifica igual ao `open`, dentro do semáforo.

- [ ] **Step 2** (`image.rs`): ajustar o comando e adicionar a função auxiliar pública:

```rust
#[tauri::command]
pub fn get_image_dimensions(path: String) -> Result<(u32, u32), String> {
    let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
    read_dimensions_oriented(&bytes)
        .ok_or_else(|| "Unsupported image format or corrupted file".to_string())
}

/// Dimensões com EXIF Orientation aplicado (tags 5-8 trocam w/h) (#43).
pub fn read_dimensions_oriented(bytes: &[u8]) -> Option<(u32, u32)> {
    let (w, h) = read_dimensions(bytes)?;
    Some(crate::commands::orientation::oriented_dimensions(
        w,
        h,
        crate::commands::orientation::read_exif_orientation(bytes),
    ))
}
```

- [ ] **Step 3:** Rodar toda a suíte Rust: `cargo test` (deve passar: módulos novos + suítes existentes do thumbnail/image/masonry). Se a fixture `oriented_200x100_o6.jpg` falhar no decode (arquivo mal gerado), reportar — não contornar com `unwrap_or(1)`.

**Resultado esperado:** `cargo test` 100% verde.

---

### Task 4: Bump do diretório de cache de thumbnails (frontend)

**Files:**
- Modify: `src/ipc/renderer.ts`

- [ ] **Step 1:** Em `getDefaultThumbnailDirectory` (linha ~388), trocar o nome do diretório:

De:
```ts
    return path.join(userDataPath, 'Allusion', 'thumbnails');
```
Para:
```ts
    // v2: EXIF orientation gate em thumbnails (#43). Thumbnails v1 (pós e pré
    // geração) ficariam deitadas para sempre porque formatos 'web' nunca
    // regeneram por mtime (ImageLoader.verifyAndGenerateThumbnail). O novo dir
    // regenera lazy, conforme o usuário visita as pastas.
    return path.join(userDataPath, 'Allusion', 'thumbnails-v2');
```

- [ ] **Step 2:** Grep em todo `src/` por `'thumbnails'` e `"thumbnails"` — se houver OUTRO lugar construindo esse caminho (backend default, backup, asset scope), avaliar se precisa do mesmo bump; NÃO alterar nada além do renderer.ts sem precisão — reportar desvios.

**Resultado esperado:** somente `renderer.ts` alterado; grep mostrando que `thumbnails-v2` é a única construction do dir cache; o `registerThumbnailScope`/asset protocol continuam funcionando porque recebem o valor retornado por essa função.

---

### Task 5: Verificação final e commit

- [ ] **Step 1:** Rodar `cargo test` (verde) e `cargo fmt --check` (se o repo usa fmt — se houver divergências de formatação, rodar `cargo fmt` e conferir o diff).
- [ ] **Step 2:** Rodar `npx tsc --noEmit` (deve continuar exit 0).
- [ ] **Step 3:** Rodar `yarn test` (jest 27 suites / 168 testes — devem continuar passando).
- [ ] **Step 4:** `git status --short` — confirmar lista EXATA de alterados: `src-tauri/src/orientation.rs` (novo), `src-tauri/src/commands/mod.rs`, `src-tauri/src/commands/thumbnail.rs`, `src-tauri/src/commands/image.rs`, `src/ipc/renderer.ts`, `resources/test_images/oriented_200x100_o6.jpg` (novo). NÃO deve haver mais nada (os 5 WIP pré-existentes do usuário permanecem sujos no working tree — não commitar).
- [ ] **Step 5:** Commit com mensagem obrigatória:

```bash
git add src-tauri/src/orientation.rs src-tauri/src/commands/mod.rs src-tauri/src/commands/thumbnail.rs src-tauri/src/commands/image.rs src/ipc/renderer.ts resources/test_images/oriented_200x100_o6.jpg
git commit -m "fix: thumbnails e dimensoes respeitam EXIF Orientation (#43)"
```

- [ ] **Step 6:** `git push` com a URL do remote com token (não usar origin sem credenciais — ver histórico de sessão).

**Resultado esperado:** commit único com os 6 arquivos, push OK.

---

## REGRAS INVIOLÁVEIS

1. Não editar nenhum arquivo fora da lista de Tasks (exceção: `src-tauri/src/commands/mod.rs` para registrar o módulo).
2. Não rodar `yarn lint` **com** `--fix` (script padrão usa `--fix` e mexeria nos 5 WIP do usuário). Se precisar lintar, rodar eslint sem `--fix` apenas nos arquivos TS alterados.
3. Não tocar nos 5 arquivos WIP do usuário (RenameFileDialog, FolderDialog, LocationsPanel, LocationStore, UiStore) nem em `.agents/scripts/`.
4. Não usar a API do GitHub (sem token, sem curl, sem `gh`).
5. Se QUALQUER passo divergir do esperado (teste não falha no RED, crate sem método, fixture inválida), PARAR e reportar com o desvio exato — nunca improvisar "consertos" fora do escopo.
6. Return final: resumo dos status de cada task (RED/GREEN), resultados dos comandos de verificação, SHA do commit, e desvios (ou "nenhum").