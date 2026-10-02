const {test} = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {resolve} = require('node:path');
const vm = require('node:vm');

const html = readFileSync(resolve(__dirname, '../index.html'), 'utf8');
const script = html.split('<script>')[1].split('</script>')[0];
const styles = html.split('<style>')[1].split('</style>')[0];

test('loaded previews expose zoom controls and keep zoom separate from export pixels', () => {
  for (const id of ['zoomOutBtn', 'zoomResetBtn', 'zoomInBtn']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(html, /id="zoomControls" role="group" aria-label="Preview zoom and rotation controls"/);
  assert.match(styles, /#canvasWrap \{[^}]*overflow: hidden;/);
  assert.match(script, /canvas\.style\.transform=`translate3d\(/);
  assert.match(script, /canvas\.addEventListener\('wheel',[\s\S]*?\{passive:false\}\)/);
  assert.match(script, /canvas\.addEventListener\('pointermove'/);
  assert.match(script, /const touchZoomPointers=new Map\(\)/);
  assert.match(script, /function updatePinchZoom\(\)/);
  assert.match(script, /pinchZoom\.zoom\*distance\/pinchZoom\.distance/);
  assert.match(styles, /#glCanvas \{[^}]*touch-action: none/);
  assert.match(script, /zoomControls\.addEventListener\('dblclick',e=>e\.stopPropagation\(\)\)/);
  assert.match(script, /canvasWrap\.addEventListener\('pointerup'[\s\S]*?suppressTouchPickerUntil=now\+750/);
  assert.match(script, /canvasWrap\.addEventListener\('dblclick',e=>\{ if\(performance\.now\(\)>=suppressTouchPickerUntil && !maskPaintMode && !e\.target\.closest\('#cropOverlay,#captionOverlay'\)\) fileInput\.click\(\); \}\)/);
  assert.match(script, /if\(resetView\) resetPreviewZoom\(\)/); // photo imports and carousel switching
  assert.match(script, /canvasWrap\.style\.display='flex'; resetPreviewZoom\(\)/); // video imports
  assert.match(script, /a\.href=canvas\.toDataURL\('image\/png'\)/); // export source is unchanged
});

test('touch pinch zoom uses two captured pointers, anchors at the gesture midpoint, and clamps to the preview range', () => {
  const canvas = {
    width:1280, height:800, clientWidth:800, clientHeight:500, style: {},
    getBoundingClientRect: () => ({left:100, top:100, width:800, height:500}),
  };
  const classes = new Set();
  const canvasWrap = {
    clientWidth:800, clientHeight:600,
    getBoundingClientRect: () => ({left:100, top:50, width:800, height:600}),
    classList: {
      toggle: (name, on) => on ? classes.add(name) : classes.delete(name),
      remove: name => classes.delete(name),
    },
  };
  const zoomOutBtn = {}, zoomInBtn = {};
  const zoomResetBtn = {setAttribute(name, value) { this[name] = value; }};
  const context = vm.createContext({canvas, canvasWrap, zoomOutBtn, zoomInBtn, zoomResetBtn, updateCropOverlay(){},updateSplitDivider(){}});
  const state = script.match(/const MIN_PREVIEW_ZOOM=0\.5, MAX_PREVIEW_ZOOM=5;\nlet previewZoom=1, previewPanX=0, previewPanY=0, previewDrag=null, pinchZoom=null;\nlet lastCanvasTouchTap=0, suppressTouchPickerUntil=0;\nconst touchZoomPointers=new Map\(\);/)[0];
  const functions = script.slice(script.indexOf('function clampPreviewPan(){'), script.indexOf("zoomOutBtn.addEventListener('click'"));
  vm.runInContext(`${state}\n${functions}\nthis.pinch=(distance)=>{touchZoomPointers.set(1,{x:300,y:300});touchZoomPointers.set(2,{x:500,y:300});pinchZoom={ids:[1,2],distance:200,zoom:1,focalX:.5,focalY:.5};touchZoomPointers.get(1).x=400-distance/2;touchZoomPointers.get(2).x=400+distance/2;updatePinchZoom();return {zoom:previewZoom,x:previewPanX,y:previewPanY};};`, context);
  const doubled = context.pinch(400);
  assert.equal(doubled.zoom, 2);
  assert.equal(doubled.x, -100);
  assert.equal(doubled.y, -50);
  assert.equal(context.pinch(2000).zoom, 5);
});

test('preview zoom clamps to 50–500%, pans within the frame, and resets without resizing pixels', () => {
  const bounds = {left:100, top:50, width:800, height:600};
  const canvas = {
    width:1280, height:800, clientWidth:800, clientHeight:500, style: {},
    getBoundingClientRect: () => ({left:100, top:100, width:800, height:500}),
  };
  const classes = new Set();
  const canvasWrap = {
    clientWidth:800, clientHeight:600,
    getBoundingClientRect: () => bounds,
    classList: {
      toggle: (name, on) => on ? classes.add(name) : classes.delete(name),
      remove: name => classes.delete(name),
    },
  };
  const zoomOutBtn = {}, zoomInBtn = {};
  const zoomResetBtn = {setAttribute(name, value) { this[name] = value; }};
  const context = vm.createContext({canvas, canvasWrap, zoomOutBtn, zoomInBtn, zoomResetBtn, updateCropOverlay(){},updateSplitDivider(){}});
  const state = script.match(/const MIN_PREVIEW_ZOOM=0\.5, MAX_PREVIEW_ZOOM=5;\nlet previewZoom=1, previewPanX=0, previewPanY=0, previewDrag=null, pinchZoom=null;\nlet lastCanvasTouchTap=0, suppressTouchPickerUntil=0;\nconst touchZoomPointers=new Map\(\);/)[0];
  const functions = script.slice(script.indexOf('function clampPreviewPan(){'), script.indexOf("zoomOutBtn.addEventListener('click'"));
  vm.runInContext(`${state}\n${functions}\nthis.zoom=zoomPreviewTo;this.reset=resetPreviewZoom;this.snapshot=()=>({zoom:previewZoom,x:previewPanX,y:previewPanY});`, context);
  context.zoom(2, 850, 550);
  assert.equal(context.snapshot().zoom, 2);
  assert.ok(Math.abs(context.snapshot().x) <= 400); // 800px canvas × 2, inside 800px frame
  assert.ok(Math.abs(context.snapshot().y) <= 200); // 500px canvas × 2, inside 600px frame
  assert.equal(classes.has('zoomed'), true);
  assert.equal(zoomResetBtn.textContent, '200%');
  context.zoom(100, 850, 550);
  assert.equal(context.snapshot().zoom, 5);
  assert.equal(zoomInBtn.disabled, true);
  context.zoom(0, 850, 550);
  assert.equal(context.snapshot().zoom, 0.5);
  assert.equal(zoomOutBtn.disabled, true);
  assert.equal(context.snapshot().x, 0);
  assert.equal(context.snapshot().y, 0);
  context.reset();
  assert.equal(context.snapshot().zoom, 1);
  assert.equal(zoomResetBtn.textContent, '100%');
  assert.equal(canvas.width, 1280);
  assert.equal(canvas.height, 800);
  assert.equal(classes.has('zoomed'), false);
});
