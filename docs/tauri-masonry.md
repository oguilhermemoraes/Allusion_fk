# Masonry Nativo (Tauri)

Os comandos Rust `compute_masonry_horizontal`, `compute_masonry_vertical` e
`compute_masonry_grid` (em `src-tauri/src/commands/masonry.rs`) reproduzem
exatamente o algoritmo do antigo `wasm/masonry/src/layout.rs`: divisão inteira
arredondada (`div_int`), clamp de aspect ratio a `100/3` e transforms
`[width, height, top, left]`.

O frontend usa exclusivamente `MasonryNativeAdapter` (invoke dos comandos acima).
Não existe mais o `MasonryWorkerAdapter` (WASM): o runtime é Tauri-only desde a
remoção da pasta `wasm/` (issue #31). Argumentos Rust snake_case chegam como
camelCase no JS (`thumbnail_size` → `thumbnailSize`, `container_width` →
`containerWidth`).
