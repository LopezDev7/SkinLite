# SkinLite

[![sitio](https://img.shields.io/website?url=https%3A%2F%2Flopezdev7.github.io%2FSkinLite%2F&label=sitio&style=flat-square)](https://lopezdev7.github.io/SkinLite/)
[![stars](https://img.shields.io/github/stars/LopezDev7/SkinLite?style=flat-square&logo=github)](https://github.com/LopezDev7/SkinLite/stargazers)
[![commit](https://img.shields.io/github/last-commit/LopezDev7/SkinLite?style=flat-square)](https://github.com/LopezDev7/SkinLite/commits/main)
[![licencia](https://img.shields.io/badge/licencia-MIT-blue?style=flat-square)](LICENSE)
[![stack](https://img.shields.io/badge/stack-Rust%20%2B%20WASM-orange?style=flat-square)](wasm-engine)

Optimizá los archivos DFF y TXD de una skin de SA-MP desde el navegador. El DFF se achica juntando vértices muy cercanos (15% por defecto) y el TXD se guarda con las texturas más livianas. Los archivos no salen del equipo.

Probala en <https://lopezdev7.github.io/SkinLite/>.

## Uso

1. Elegí el `.DFF` y el `.TXD` de la misma skin (juntos o uno por uno, también podés pegarlos con Ctrl + V).
2. Elegí el tamaño máximo de textura, la calidad y la reducción del DFF.
3. Descargá el `.zip` con los dos archivos y sus nombres originales, o solo el DFF, y probalos en el juego.

Guardá los originales hasta comprobar que la skin se ve bien. Si el TXD tiene algo que el optimizador no puede conservar, se detiene y te dice qué pasó: no genera archivos a medias.

## Cómo funciona

La página llama a un módulo WebAssembly compilado desde Rust (`wasm-engine`). Ese módulo lee el TXD con [libtxd](https://crates.io/crates/libtxd), convierte las texturas a DXT1 o DXT3 (DXT3 cuando hay transparencia), las reduce si hace falta y vuelve a armar el TXD. Todo corre en el navegador de quien usa la página; GitHub solo sirve los archivos.

## Desarrollo local

Abrí `index.html` para ver la página. Para que el optimizador funcione, compilá el módulo:

```sh
wasm-pack build wasm-engine --target web --release --out-dir ../pkg --out-name skinlite_txd
```

Después serví la carpeta con `python -m http.server` y entrá a <http://localhost:8000>. Los navegadores no cargan módulos WebAssembly abriendo el archivo con doble clic.

Para revisar solo el código Rust:

```sh
cd wasm-engine
cargo check --target wasm32-unknown-unknown --release
```

## Licencia

MIT. El motor usa `libtxd` (MPL-2.0); el detalle está en [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
