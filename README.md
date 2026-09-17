# SkinLite

Optimizá el TXD de una skin de SA-MP desde el navegador. El `.DFF` queda igual; el `.TXD` se guarda con las texturas más livianas y con `-ligera` en el nombre. Los archivos no salen del equipo.

Probala en <https://lopezdev7.github.io/SkinLite/>.

## Uso

1. Elegí el `.DFF` y el `.TXD` de la misma skin (juntos o uno por uno, también podés pegarlos con Ctrl + V).
2. Elegí el tamaño máximo de textura y la calidad.
3. Descargá el `.zip` con los dos archivos y probalos en el juego.

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

## Publicación

`.github/workflows/pages.yml` compila el motor y publica el sitio en GitHub Pages cuando se pushea a `main`. Pages está configurado con **GitHub Actions** como fuente.

## Licencia

MIT. El motor usa `libtxd` (MPL-2.0); el detalle está en [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
