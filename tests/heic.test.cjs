const {test} = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync, statSync} = require('node:fs');
const {resolve} = require('node:path');
const vm = require('node:vm');

const html = readFileSync(resolve(__dirname, '../index.html'), 'utf8');
const script = html.split('<script>')[1].split('</script>')[0];
const fileHandlers = script.slice(script.indexOf('function isHeicFile('), script.indexOf("dropZone.addEventListener('click'"));

function makeContext(overrides = {}) {
  const toasts = [], errors = [], revoked = [];
  const context = vm.createContext({
    Blob,
    window: {},
    document: {createElement: () => ({}), head: {appendChild: () => {}}},
    URL: {createObjectURL: () => 'blob:sample', revokeObjectURL: url => revoked.push(url)},
    showToast: text => toasts.push(text),
    console: {error: (...args) => errors.push(args)},
    ...overrides,
  });
  vm.runInContext(fileHandlers, context);
  return {context, toasts, errors, revoked};
}

test('picker and both drop targets accept HEIC/HEIF even without a MIME type', () => {
  assert.match(html, /id="fileInput" accept="[^"]*\.heic,\.heif,image\/heic,image\/heif[^"]*"/);
  assert.match(html, /JPG · PNG · HEIC · HEIF/);
  assert.match(script, /isHeicFile\(f\)\|\|f\.type\.startsWith\('image\/'\)/);
  assert.match(script, /dropZone\.addEventListener\('drop',[^\n]*e\.stopPropagation\(\)/);
  const {context} = makeContext();
  for (const file of [
    {name: 'IMG_0001.HEIC', type: ''},
    {name: 'IMG_0002.heif', type: 'application/octet-stream'},
    {name: 'mystery', type: 'image/heic'},
    {name: 'burst', type: 'image/heif-sequence'},
  ]) assert.equal(context.isHeicFile(file), true, file.name);
  for (const file of [
    {name: 'image.jpg', type: 'image/jpeg'},
    {name: 'fake.heic.jpg', type: 'image/jpeg'},
  ]) assert.equal(context.isHeicFile(file), false, file.name);
});

test('the decoder is bundled locally, lazy loaded, and has a CDN fallback', async () => {
  assert.ok(statSync(resolve(__dirname, '../vendor/heic2any.min.js')).size > 100000);
  assert.match(readFileSync(resolve(__dirname, '../vendor/LICENSE.heic2any.md'), 'utf8'), /MIT License/);
  const sources = [];
  const decoder = async () => new Blob(['image'], {type: 'image/png'});
  const {context} = makeContext({
    document: {
      createElement: () => ({remove() {}}),
      head: {appendChild(element) {
        sources.push(element.src);
        queueMicrotask(() => {
          if (sources.length === 1) element.onerror();
          else { context.window.heic2any = decoder; element.onload(); }
        });
      }},
    },
  });
  const load = context.loadHeicDecoder();
  assert.equal(await load, decoder);
  assert.deepEqual(sources, [
    'vendor/heic2any.min.js',
    'https://cdn.jsdelivr.net/npm/heic2any@0.0.4/dist/heic2any.min.js',
  ]);
  assert.equal(await context.loadHeicDecoder(), decoder);
  assert.equal(sources.length, 2); // no duplicate script injection
});

test('a failed native decode converts the photo to PNG and displays its first frame', async () => {
  const original = {name: 'portrait.HEIC', type: ''};
  const png = new Blob(['PNG content'], {type: 'image/png'});
  const shown = [];
  const {context, toasts, revoked} = makeContext({
    window: {heic2any: async ({blob, toType}) => {
      assert.equal(blob, original);
      assert.equal(toType, 'image/png');
      return [png]; // multi-image HEICs expose an array; the first is the photo
    }},
    Image: class {set src(_) { this.onerror(); }},
  });
  vm.runInContext('fileLoadId = 1', context);
  const convert = context.convertHeic;
  context.convertHeic = (...args) => shown.push(args);
  context.loadImage(original, original, 1);
  assert.equal(shown.length, 1);
  assert.equal(shown[0][0], original);
  assert.deepEqual(revoked, ['blob:sample']);
  context.convertHeic = convert;
  context.loadImage = (...args) => shown.push(args);
  await context.convertHeic(original, 1);
  assert.equal(shown[1][0], png);
  assert.equal(shown[1][1], original);
  assert.equal(shown[1][3], true); // do not endlessly retry conversion
  assert.ok(toasts.some(t => t.includes('Decoding HEIC')));
});

test('a stale HEIC conversion cannot replace a newer file', async () => {
  const shown = [];
  const {context} = makeContext({window: {heic2any: async () => new Blob(['png'], {type: 'image/png'})}});
  context.loadImage = (...args) => shown.push(args);
  vm.runInContext('fileLoadId = 2', context);
  await vm.runInContext('convertHeic({name:"old.heic",type:""}, 1)', context);
  assert.equal(shown.length, 0);
});

test('corrupt or unsupported HEIC photos show a recoverable error', async () => {
  const {context, toasts, errors} = makeContext({window: {heic2any: async () => {throw new Error('Invalid HEIC data')}}});
  vm.runInContext('fileLoadId = 1', context);
  await vm.runInContext('convertHeic({name:"bad.heic",type:""}, 1)', context);
  assert.match(toasts.at(-1), /Could not open this HEIC \/ HEIF photo/);
  assert.equal(errors.length, 1);
});
