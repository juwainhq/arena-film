# arena-film

A single-file WebGL 2 photo and video effects editor. Serve `index.html` through a local web server (for example, `python3 -m http.server 8000`).

All 32 sliders run from -100 to +100, centered at neutral 0. Amber adds an effect; blue reduces or reverses it. Negative Bloom and Hallation subtract glow, negative Grain inverts its noise, negative Sharpen softens, and negative Vignette Strength brightens edges. Double-click any slider to reset it to 0; R resets everything. Six built-in looks and custom presets are available; earlier custom presets are migrated into localStorage v4.

Photo export works locally. Video export (up to 60 seconds) lazily loads ffmpeg.wasm from a CDN, so it needs network access; WebCodecs `VideoFrame` is used for frame uploads where supported, with a video-element/canvas fallback.

Run the dependency-free control tests with `node --test tests/controls.test.cjs`.
