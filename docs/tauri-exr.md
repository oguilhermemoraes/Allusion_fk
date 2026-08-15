# EXR Nativo (Tauri)

O comando `decode_exr_image` (em `src-tauri/src/commands/exr.rs`) decodifica um
EXR para RGBA8 aplicando a pipeline de cor portada do antigo
`wasm/exr-decoder/src/color.rs` (`ColorMapper`): lê `chromaticities` do header,
converte o gamut para sRGB e aplica gamma correction.

O frontend usa exclusivamente `ExrLoader.decodePath` (invoke `decode_exr_image`).
Não existe fallback WASM: o runtime é Tauri-only desde a remoção da pasta `wasm/`
(issue #31).
