# arena-film

A private, static WebGL 2 photo and video editor with an Instagram workflow. Image uploads open **Photo Mode**; video uploads open **Video Mode** automatically, without a reload. Dropping a new file on the canvas replaces the current media, and **Back** returns to the landing drop zone. Serve the **whole repository** through a web server, for example:

```sh
python3 -m http.server 8000 --bind 0.0.0.0
```

The editor lives in `index.html`, with dependency-free crop, settings-link, ZIP, and video-command helpers in `social-tools.js`. HEIC decoding, portrait detection, and video encoding load only when needed. There is no upload API: media, masks, rendering, and downloads stay in the browser.

## Instagram export

The **Instagram Export** panel adds one-click formats without removing original-size PNG downloads:

| Format | Aspect | Exact output |
| --- | --- | --- |
| Square post | 1:1 | 1080 × 1080 |
| Portrait post | 4:5 | 1080 × 1350 |
| Story / Reel | 9:16 | 1080 × 1920 |
| Landscape | 1.91:1 | 1080 × 566 |
| Original | Source aspect | Source dimensions |

Pick a format and **drag the crop frame** to reposition it. Touch dragging works too; arrow keys fine-tune the crop, and Shift moves faster. Center resets the framing. Done framing hides the guides without losing the crop. Output dimensions update immediately. Images fill the chosen aspect without distortion; smaller sources are upscaled when necessary to meet the exact output dimensions. Oversized source photos are reduced only if they exceed the device's GPU size limits.

Export **JPG at 80–100% quality** (92% by default) or lossless **PNG**. The header Export button opens these photo settings; with a video loaded, it directly starts the selected Reel export. The original **Original-size PNG** action and `D` shortcut bypass the crop and keep the full rendered image. Preview zoom, crop guides, and UI labels never appear in normal exports.

### Before / after content

Enable **Export a before / after pair** for two matching, side-by-side crops: original on the left, edited on the right. Layouts are square **1080 × 1080**, landscape **2160 × 1080 (2:1)**, or story **1080 × 1920**. The crop frame shows the region used for each half. Before / After labels can be turned off. The separate **split preview** button compares the original and edited halves live without affecting normal exports. Pair export is for photos; videos retain their normal full-frame Before / After and split preview.

## Carousel consistency

Upload **up to 10 photos** together. A numbered thumbnail strip below the preview provides quick switching; **Add** appends within the ten-photo limit, and **Remove** removes the selected photo. A successful new main upload replaces the collection; failed imports keep the current media. Mixed photo/video selections are rejected without destroying the current collection.

**Edits are linked by design**: a preset, slider adjustment, effect switch, or pasted settings apply to every photo. Apply to all confirms the current shared edit. Each photo keeps its **own crop position and subject mask**, so switching cannot move another photo's subject or copy its mask. **Carousel ZIP** renders all photos through the same WebGL pipeline and exports numbered JPGs or PNGs in upload order. ZIP creation is local and dependency-free. Exports temporarily lock the controls, support cancellation, and restore the selected photo and preview state afterward.

Background-only dithering waits for each photo's mask during ZIP export. If no protected subject is available, that photo skips background dithering rather than unexpectedly dithering the entire image; the export status reports this.

## Presets and effects

There are **32 built-in looks** plus saved custom presets. The original six remain as quick-pick cards with tone-curve grade swatches; six feed favorites, six color stories, and the new **IG Looks** pack are grouped in **More presets**. Saved custom looks appear as cards in their own **Saved** section. The original Golden Hour remains separate from the IG pack's Golden Hour.

**IG Looks (14):** Moody Dark, Golden Hour, Clean Minimal, Dreamy Pastel, Punchy Vibrant, Film Fade, B&W Editorial, Neon Night, Soft Skin, Café Cream, Coastal Blue, Direct Flash, Terracotta, and Sage Green. Neon Night uses a new signed **Highlight Tint** control for genuine magenta highlights; negative tint adds green. At 0, this addition leaves the original looks unchanged.

All **41 effect sliders** run from −100 to +100 with neutral 0. Red adds an effect; white reduces or reverses it (charcoal in light mode). Negative Bloom and Hallation subtract glow, negative Grain inverts its noise, negative Sharpen softens, and negative Vignette Strength brightens edges. Color & Light includes exposure, contrast, saturation, temperature, selective vibrance, lifted/crushed blacks, teal/plum shadows, icy/amber highlights, and green/magenta highlight tint. Double-click any effect slider to reset it to 0; `R` resets all effect values and returns dithering to Full photo.

Each effect has an ON/OFF switch that bypasses rendering without erasing values. Its chevron expands the advanced controls. All built-in looks leave **sharpening and dithering at 0**; manual settings and custom presets remain available. Preset transitions retain **340 ms**. Saved looks remember effect switches and Dither scope, persist in `film_lab_presets_v4`, and can be selected or deleted from their Saved cards or the More presets selector. Older presets load newer controls at 0, preserving legacy translations and migrations.

### Dither and grain

Dither is a separate signed effect: negative intensity produces a monochrome print, positive produces a color print, and 0 leaves the image unchanged. Color Steps and Dot Size adjust the pattern. Choose **Full photo** or **Background only**. Background Only lazily uses the locally bundled [MediaPipe Selfie Segmentation](vendor/mediapipe-selfie/README.md) model to protect **people**; Protect and Erase brushes handle other subjects or corrections. Detection and brushes never upload the photo.

Painting pauses drag-to-pan and hides crop guides so the two drag modes cannot conflict; wheel/button zoom still work. Tap Done painting to resume panning. On phones, selecting a brush brings the photo into view. Masks belong to their photo, survive carousel switching, and reset when that photo is replaced or Clear Mask is used. Saved looks and shared settings remember scope, not photo-specific masks. Dither and halftone are photo-only effects and are not available in Video Mode. Background-only masking is unavailable for videos.

Photo grain is **still**, regardless of Grain Speed, including old presets and exports. Grain Speed continues to animate video grain.

## Reels trim and video export

Upload one video at a time to enter **Video Mode**. The workspace places the WebGL preview and playback controls above a 160px editing timeline, with the editor sidebar on the right. It includes sampled thumbnails, a decoded audio waveform when the browser supports the source codec, a ruler, zoomable scrubbing, draggable trim handles, cut/delete with undo/redo, and hard-cut, dissolve, fade-to-black, and fade-from-black transitions. Playback supports Space, current/total time, volume/mute, and **0.5× / 1× / 1.5× / 2×** speeds. Quick 15s / 30s / 60s trims remain available. Clips longer than 60 seconds show a performance warning; the initial selected region is limited to 60 seconds. Cut segments and transitions are reflected in exported video.

A single **Text & Captions** layer can be styled with font, size, and color, dragged on the preview, shown or hidden for the clip, and positioned with simple timeline keyframes. Captions are composited into video output. Dropping another video onto the canvas replaces the current clip.

Choose **Original / 1080p / 720p**, **MP4 / WebM**, and **Low / Medium / High** quality. Resolution, format, quality, and the current trim are visible in the Video Export workspace. Video exports preserve the source aspect ratio; Instagram crop and frame-format choices and still-image export buttons are photo-only. MP4 uses H.264 with AAC source audio when present; WebM uses VP8 with Opus. Keep source audio can be disabled in More video options. All applicable WebGL effects remain active in video export, while Dither/Halftone are unavailable in Video Mode. Preview zoom never affects output framing. Output is 24 fps, so trim boundaries resolve to frame precision. Output dimensions are padded to even values where needed for the codec.

After a video upload succeeds, the app initializes one shared instance of the locally bundled [ffmpeg.wasm wrapper/worker](vendor/ffmpeg/README.md) and downloads the single-threaded core from a CDN in the background (**about 31 MB**, internet required). Nothing is initialized for photo-only sessions, and the progress dialog stays hidden until export begins. WebCodecs `VideoFrame` uploads are used where supported, with a video-element/canvas fallback. Two-second encoding sections bound raw-frame memory; for one continuous segment, source audio is read from the uploaded Blob through WORKERFS where available and joined at the selected offset. Original audio is omitted when timeline gaps or transitions make the edit non-contiguous. The shared progress dialog shows encoding percentage and an estimated time remaining; completed exports download automatically and the Video Export status reports completion. Temporary frames, sections, and worker files are cleaned up after success, failure, or cancellation. Longer, high-resolution clips with heavy effects can take several minutes on slower devices; Cancel export restores the preview.

## Copy, paste, and look links

**Copy settings** copies a portable snapshot of every effect value, effect switch, Dither scope, and crop/photo export option. A browser-storage copy survives reloads if the system clipboard is unavailable. **Paste settings** accepts copied settings or a look link, falling back to the stored browser copy. It does not replace uploaded media or masks.

**Share this look as a link** encodes the current settings in a versioned `#look=v1.…` URL hash. Opening the link restores the look before an upload; the recipient supplies their own photos. Links include **no photos, masks, per-photo crop positions, or video trim points**. Values and versions are validated; invalid links leave the current edit unchanged. Changing edits does not rewrite an existing shared link until Share is pressed again.

## Uploads, preview, and style

Photos support JPG, PNG, HEIC, and HEIF, including uppercase extensions and empty MIME types. When native HEIC/HEIF decoding is unavailable, the locally bundled [heic2any 0.0.4](vendor/LICENSE.heic2any.md) decoder converts the first photo frame to PNG in the browser, with a CDN decoder fallback. Conversion is cached within the carousel, and stale imports cannot replace a newer upload. Other browser-decodable image types can also be opened.

Hover and scroll to zoom from **50% to 500%**, or use the − / + buttons on desktop or touch. Drag to pan when zoomed; click the percentage to reset to fit. Double-click the picture to open the picker when no mask brush is active (crop-frame gestures do not reopen the picker). Zoom changes the preview only, never the export pixels.

The Juwain Haque header keeps the portfolio's **24px / 40px / 64px** gutters. On phones, header actions move behind one **···** menu, while the editor controls become a draggable bottom sheet with Looks, Adjust, and Export tabs; swipe up to expand it and down to minimize it. The **Looks** view opens first, **Adjust** groups controls into Basic, Creative, and Technical clusters, and **Export** focuses on the relevant photo or video settings. Hold the canvas pill to compare with the original. The icon-only sun/moon control switches dark/light UI without changing media pixels, saves `film_lab_theme`, and defaults to dark. The portfolio-style dot-and-ring cursor leaves the native cursor available and is disabled for touch and reduced motion. New panels retain the flat black/white/red aesthetic.

| Shortcut | Action |
| --- | --- |
| Space | Before / After |
| R | Reset effect values |
| D | Original-size PNG |
| E | Expand/collapse all effects |
| C | Toggle crop/export panel |

Shortcuts do not hijack text fields or native selects; Space still activates a focused button.

## Tests

```sh
node --test tests/*.test.cjs
```

Dependency-free tests cover signed controls, legacy/IG presets, crop geometry, exact output dimensions, before/after layouts, ZIP integrity, settings links, trim/encoding commands, HEIC import races, cursor, themes, and zoom. Browser validation also checks desktop/mobile touch framing, carousel consistency/cancellation, per-photo masks, saved effect switches, clipboard fallback across reloads, and real MP4/AAC and WebM encoding. Neutral output and all 18 pre-existing looks have been checked pixel-for-pixel against the preceding build.
