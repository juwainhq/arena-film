# arena-film

A static WebGL 2 photo and video effects editor. The app lives in `index.html`; the HEIC/HEIF decoder in `vendor/` is loaded only when needed. Serve the repository through a local web server (for example, `python3 -m http.server 8000`).

All 32 sliders run from -100 to +100, centered at neutral 0. Red adds an effect; white reduces or reverses it. Negative Bloom and Hallation subtract glow, negative Grain inverts its noise, negative Sharpen softens, and negative Vignette Strength brightens edges. Double-click any slider to reset it to 0; R resets everything. Six built-in looks and custom presets are available; the built-in looks leave all sharpening controls at 0, while manual sharpening and saved custom presets remain available. Earlier custom presets are migrated into localStorage v4.

Photos can be imported as JPG, PNG, HEIC, or HEIF (including uppercase extensions and files with an empty MIME type). If the browser cannot decode HEIC/HEIF natively, Film Lab lazily converts it to PNG in the browser with the bundled [heic2any 0.0.4](vendor/LICENSE.heic2any.md) decoder; the photo is never uploaded to a server. If you copy only `index.html` without `vendor/`, the decoder can fall back to a CDN when online. Photo export remains PNG. Video export (up to 60 seconds) lazily loads ffmpeg.wasm from a CDN, so it needs network access; WebCodecs `VideoFrame` is used for frame uploads where supported, with a video-element/canvas fallback.

Run the dependency-free control and HEIC tests with `node --test tests/*.test.cjs`.
