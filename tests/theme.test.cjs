const {test} = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {resolve} = require('node:path');
const vm = require('node:vm');

const html = readFileSync(resolve(__dirname, '../index.html'), 'utf8');
const styles = html.split('<style>')[1].split('</style>')[0];
const mainScript = html.split('<script>')[1].split('</script>')[0];
const bootstrap = html.match(/<script id="themeBootstrap">([\s\S]*?)<\/script>/)[1];
const controller = mainScript.slice(mainScript.indexOf('const themeToggle ='), mainScript.indexOf('const canvas ='));

function themeUI(saved, blocked = false) {
  const values = new Map();
  if (saved) values.set('film_lab_theme', saved);
  const button = {
    attributes: {}, handlers: {},
    setAttribute(name, value) { this.attributes[name] = value; },
    addEventListener(name, fn) { this.handlers[name] = fn; },
  };
  const root = {dataset: {}};
  const listeners = {};
  const context = vm.createContext({
    document: {documentElement: root, getElementById(id) { assert.equal(id, 'themeToggle'); return button; }},
    localStorage: {
      getItem(key) { if (blocked) throw Error('Storage unavailable'); return values.get(key) ?? null; },
      setItem(key, value) { if (blocked) throw Error('Storage unavailable'); values.set(key, value); },
    },
    window: {addEventListener(name, fn) { listeners[name] = fn; }},
  });
  vm.runInContext(bootstrap, context);
  vm.runInContext(controller, context);
  return {values, root, button, listeners};
}

test('header uses the portfolio navigation gutters and type while keeping mobile actions visible', () => {
  assert.match(styles, /header \{[^}]*padding: 16px 24px;/);
  assert.match(styles, /#logo \{[^}]*font-size: 12px;[^}]*letter-spacing: \.15em;/);
  assert.match(styles, /@media \(min-width: 768px\) \{\s*header \{ padding-inline: 40px; \}/);
  assert.match(styles, /@media \(min-width: 1024px\) \{\s*header \{[^}]*padding-inline: 64px; \}/);
  assert.match(styles, /@media \(max-width: 767px\) \{[\s\S]*?#headerActions \{[^}]*grid-row: 2;[^}]*justify-content: space-between;/);
  for (const action of ['hdrUploadBtn', 'hdrBeforeBtn', 'hdrDownloadBtn']) {
    assert.match(html, new RegExp(`<button type="button" class="hdrBtn(?: primary)?" id="${action}">`));
  }
});

test('both themes cover the editor with legible negative sliders and native color schemes', () => {
  assert.match(styles, /:root \{\s*color-scheme: dark;[^}]*--bg: #000;[^}]*--negative: #e8e8e8;/);
  assert.match(styles, /:root\[data-theme="light"\] \{\s*color-scheme: light;[^}]*--bg: #fff;[^}]*--text: #111;[^}]*--negative: #333;/);
  for (const selector of ['header', '#mainArea', '#glCanvas', '#beforeLabel', '#exportProgress', '#toast']) {
    assert.match(styles, new RegExp(`${selector} \\{[^}]*background: var\\(--bg\\);`), selector);
  }
  assert.match(mainScript, /var\(--slider-center\)[\s\S]*?var\(--slider-track\)/);
  assert.match(mainScript, /s\.classList\.contains\('subSlider'\)\?'var\(--slider-neutral\)'/);
  assert.doesNotMatch(controller, /render\(|canvas\.|gl\.|downloadImage\(|params\./);
  assert.match(styles, /:root\[data-theme="light"\] \.darkHint \{ display: none; \}/);
});

test('icon-only switch uses the portfolio sun/moon glyphs and motion', () => {
  const markup = html.match(/<button type="button" id="themeToggle"[\s\S]*?<\/button>/)[0];
  assert.equal((markup.match(/<svg /g) || []).length, 2);
  assert.doesNotMatch(markup, /<span|>Light<|>Dark</);
  assert.match(markup, /<circle cx="12" cy="12" r="4"\/>/); // Lucide Sun
  assert.match(markup, /<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"\/>/); // Lucide Moon
  assert.match(styles, /#themeToggle svg \{[^}]*width: 18px; height: 18px;[^}]*stroke-width: 1\.5;[^}]*transition: opacity \.5s ease-out, transform \.5s ease-out;/);
  assert.match(styles, /:root\[data-theme="light"\] #themeToggle \.moonIcon \{ opacity: 1; transform: rotate\(0\) scale\(1\); \}/);
});

test('theme toggle defaults to dark, updates its accessible label, and persists across reloads', () => {
  const {values, root, button, listeners} = themeUI();
  assert.equal(root.dataset.theme, 'dark');
  assert.equal(button.attributes['aria-label'], 'Switch to light theme');
  button.handlers.click();
  assert.equal(root.dataset.theme, 'light');
  assert.equal(values.get('film_lab_theme'), 'light');
  assert.equal(button.attributes['aria-label'], 'Switch to dark theme');
  assert.equal(themeUI(values.get('film_lab_theme')).root.dataset.theme, 'light');
  button.handlers.click();
  assert.equal(root.dataset.theme, 'dark');
  assert.equal(values.get('film_lab_theme'), 'dark');
  listeners.storage({key: 'film_lab_theme', newValue: 'light'});
  assert.equal(root.dataset.theme, 'light');
  assert.equal(button.attributes['aria-label'], 'Switch to dark theme');
  listeners.storage({key: 'film_lab_theme', newValue: null});
  assert.equal(root.dataset.theme, 'dark');
});

test('theme still works when localStorage is unavailable', () => {
  const {root, button} = themeUI(null, true);
  button.handlers.click();
  assert.equal(root.dataset.theme, 'light');
  assert.equal(button.attributes['aria-label'], 'Switch to dark theme');
});

test('keyboard shortcuts let Space activate a focused theme button', () => {
  assert.match(mainScript, /if\(\['INPUT','BUTTON','TEXTAREA','SELECT'\]\.includes\(e\.target\.tagName\) \|\| e\.target\.isContentEditable\) return;/);
});


test('mobile video controls keep the timeline above the phone safe area and the editing sheet clear of tracks', () => {
  assert.match(styles, /#app \{ padding-bottom: env\(safe-area-inset-bottom\); \}/);
  assert.match(styles, /#app\[data-workspace="video"\] #mainArea \{ inset: 0 0 220px;/);
  assert.match(styles, /#app\[data-workspace="video"\] #holdCompareBtn \{ bottom: 12px; \}/);
  assert.match(styles, /#app\[data-workspace="video"\] #sidebar \{ bottom: 220px; max-height: calc\(100% - 238px\); \}/);
  assert.match(styles, /@media \(min-width: 768px\) and \(max-width: 900px\)[\s\S]*?grid-template-columns: minmax\(0,1fr\) minmax\(300px,42vw\)/);
  assert.match(styles, /@media \(pointer: coarse\)[\s\S]*?\.mtl-trim-handle \{ width: 18px;/);
});
