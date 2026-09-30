const {test} = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {resolve} = require('node:path');
const vm = require('node:vm');

const html = readFileSync(resolve(__dirname, '../index.html'), 'utf8');
const styles = html.split('<style>')[1].split('</style>')[0];
const source = html.match(/<script id="cursorEffects">([\s\S]*?)<\/script>/)[1];

function makeCursor(matches) {
  const windowEvents = {}, rootEvents = {}, frames = new Map();
  let nextFrame = 0, onChange;
  class ElementStub { constructor(interactive) { this.interactive = interactive; } closest() { return this.interactive ? this : null; } }
  function overlay() {
    const classes = new Set();
    return {style: {}, classes, classList: {
      add: (...names) => names.forEach(name => classes.add(name)),
      remove: (...names) => names.forEach(name => classes.delete(name)),
      toggle: (name, force) => force ? classes.add(name) : classes.delete(name),
    }};
  }
  const dot = overlay(), ring = overlay();
  const support = {
    get matches() { return matches; },
    addEventListener(event, listener) { assert.equal(event, 'change'); onChange = listener; },
  };
  const window = {
    matchMedia(query) {
      assert.equal(query, '(pointer: fine) and (prefers-reduced-motion: no-preference)');
      return support;
    },
    addEventListener(event, listener) { windowEvents[event] = listener; },
    removeEventListener(event) { delete windowEvents[event]; },
  };
  const document = {
    getElementById(id) { return {cursorDot: dot, cursorRing: ring}[id]; },
    documentElement: {
      addEventListener(event, listener) { rootEvents[event] = listener; },
      removeEventListener(event) { delete rootEvents[event]; },
    },
  };
  const context = vm.createContext({
    window, document, Element: ElementStub, innerWidth: 200, innerHeight: 100,
    requestAnimationFrame(fn) { frames.set(++nextFrame, fn); return nextFrame; },
    cancelAnimationFrame(id) { frames.delete(id); },
  });
  vm.runInContext(source, context);
  return {
    dot, ring, windowEvents, rootEvents, frames, ElementStub,
    change(value) { matches = value; onChange(); },
    tick() {
      const [id, frame] = frames.entries().next().value;
      frames.delete(id);
      frame();
    },
  };
}

test('the portfolio dot and ring do not replace the native cursor or affect exports', () => {
  assert.match(html, /id="cursorDot" class="cursor-fx cursor-fx-dot" aria-hidden="true"/);
  assert.match(html, /id="cursorRing" class="cursor-fx cursor-fx-ring" aria-hidden="true"/);
  assert.match(styles, /@media \(pointer: fine\) and \(prefers-reduced-motion: no-preference\) \{\s*\.cursor-fx \{ display: block; \}/);
  assert.match(styles, /\.cursor-fx \{[^}]*display: none;[^}]*position: fixed;[^}]*pointer-events: none;[^}]*mix-blend-mode: difference;/);
  assert.match(styles, /\.cursor-fx-dot \{ width: 6px; height: 6px;/);
  assert.match(styles, /\.cursor-fx-ring \{ width: 36px; height: 36px;/);
  assert.match(styles, /\.cursor-fx-ring\.is-hover \{ width: 56px; height: 56px;/);
  assert.match(styles, /\.cursor-fx-ring\.is-down \{ width: 28px; height: 28px;/);
  assert.doesNotMatch(styles, /cursor:\s*none\b/);
  assert.match(source, /\.effectHeader, #dropZone, #glCanvas/);
  assert.match(styles, /#glCanvas \{[^}]*cursor: zoom-in;/);
});

test('cursor follows the pointer, eases the ring, and reacts to hover, press, and leaving', () => {
  const fx = makeCursor(true);
  assert.ok(fx.windowEvents.mousemove && fx.rootEvents.mouseleave);
  fx.windowEvents.mousemove({clientX: 150, clientY: 100, target: new fx.ElementStub(true)});
  assert.equal(fx.dot.style.opacity, '1');
  assert.equal(fx.ring.classes.has('is-hover'), true);
  fx.tick();
  assert.equal(fx.dot.style.transform, 'translate3d(150px, 100px, 0)');
  assert.equal(fx.ring.style.transform, 'translate3d(108px, 58px, 0)');
  fx.windowEvents.mousedown();
  assert.equal(fx.ring.classes.has('is-down'), true);
  fx.windowEvents.mouseup();
  assert.equal(fx.ring.classes.has('is-down'), false);
  fx.windowEvents.mousemove({clientX: 160, clientY: 110, target: new fx.ElementStub(false)});
  assert.equal(fx.ring.classes.has('is-hover'), false);
  fx.rootEvents.mouseleave();
  assert.equal(fx.dot.style.opacity, '0');
  assert.equal(fx.ring.style.opacity, '0');
});

test('touch or reduced motion disables the cursor and a media change cleans up listeners', () => {
  const fx = makeCursor(false);
  assert.equal(fx.windowEvents.mousemove, undefined);
  assert.equal(fx.frames.size, 0);
  fx.change(true);
  assert.ok(fx.windowEvents.mousemove);
  assert.equal(fx.frames.size, 1);
  fx.windowEvents.mousemove({clientX: 3, clientY: 4, target: new fx.ElementStub(false)});
  fx.change(false);
  assert.equal(fx.windowEvents.mousemove, undefined);
  assert.equal(fx.rootEvents.mouseleave, undefined);
  assert.equal(fx.frames.size, 0);
  assert.equal(fx.dot.style.opacity, '0');
});
