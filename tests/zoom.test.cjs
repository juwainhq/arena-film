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
  assert.match(html, /id="zoomControls" role="group" aria-label="Preview zoom controls"/);
  assert.match(styles, /#canvasWrap \{[^}]*overflow: hidden;/);
  assert.match(script, /canvas\.style\.transform=`translate3d\(/);
  assert.match(script, /canvas\.addEventListener\('wheel',[\s\S]*?\{passive:false\}\)/);
  assert.match(script, /canvas\.addEventListener\('pointermove'/);
  assert.match(script, /zoomControls\.addEventListener\('dblclick',e=>e\.stopPropagation\(\)\)/);
  assert.match(script, /canvasWrap\.addEventListener\('dblclick',e=>\{ if\(!maskPaintMode && !e\.target\.closest\('#cropOverlay'\)\) fileInput\.click\(\); \}\)/);
  assert.match(script, /if\(resetView\) resetPreviewZoom\(\)/); // photo imports and carousel switching
  assert.match(script, /canvasWrap\.style\.display='flex'; resetPreviewZoom\(\)/); // video imports
  assert.match(script, /a\.href=canvas\.toDataURL\('image\/png'\)/); // export source is unchanged
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
  const state = script.match(/const MIN_PREVIEW_ZOOM=0\.5, MAX_PREVIEW_ZOOM=5;\nlet previewZoom=1, previewPanX=0, previewPanY=0, previewDrag=null;/)[0];
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
