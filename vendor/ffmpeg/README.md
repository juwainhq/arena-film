# ffmpeg.wasm browser wrapper

The unmodified UMD wrapper, worker, and source maps are from [`@ffmpeg/ffmpeg` 0.12.10](https://www.npmjs.com/package/@ffmpeg/ffmpeg/v/0.12.10), distributed under the [MIT license](LICENSE). The license is from the [upstream v0.12.10 tag](https://github.com/ffmpegwasm/ffmpeg.wasm/blob/v0.12.10/LICENSE).

Serving the worker from the app's origin avoids cross-origin Worker errors on static hosting. The single-threaded `@ffmpeg/core` 0.12.10 JavaScript and WebAssembly are **not bundled**: they are loaded on demand from jsDelivr, with unpkg as a fallback, only for video export. The FFmpeg core and its codecs have their own upstream licensing; see [ffmpeg.wasm licensing](https://github.com/ffmpegwasm/ffmpeg.wasm#license) and the [core source/build configuration](https://github.com/ffmpegwasm/ffmpeg.wasm/tree/v0.12.10).

Photos, photo ZIPs, crop guides, and settings links do not depend on FFmpeg or a CDN. Video files and rendered frames stay in the browser's worker filesystem and are deleted after export or cancellation.
