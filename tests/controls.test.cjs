const {test} = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {resolve} = require('node:path');
const vm = require('node:vm');

const html = readFileSync(resolve(__dirname, '../index.html'), 'utf8');
const script = html.split('<script>')[1].split('</script>')[0];
const styles = html.split('<style>')[1].split('</style>')[0];
const config = script.match(/const advancedControls=\{[\s\S]*?\n\};/)[0];
const mapper = script.match(/function advancedValue\(name\)\{[\s\S]*?\n\}/)[0];
const update = script.match(/function updateFromSliders\(\)\{[\s\S]*?\n\}/)[0];
const converter = script.match(/function convertLegacyValues\(values\)\{[\s\S]*?\n\}/)[0];
const upgrade = script.match(/function upgradeV4Preset\(p\)\{[\s\S]*?\n\}/)[0];
const legacyPresets = script.match(/const legacyBuiltInPresets=\{[\s\S]*?\n\};/)[0];
const withoutSharpening = script.match(/const withoutSharpening=values=>[^\n]+;/)[0];
const builtIns = script.match(/const builtInPresets=\{[\s\S]*?\n\};/)[0];
const sliders = {}, params = {};
const context = vm.createContext({sliders, params});
vm.runInContext(`${config}\n${mapper}\n${update}\n${converter}\n${upgrade}\n${legacyPresets}\n${withoutSharpening}\n${builtIns}\nthis.controls=advancedControls;this.mapValue=advancedValue;this.update=updateFromSliders;this.convert=convertLegacyValues;this.upgrade=upgradeV4Preset;this.oldPresets=legacyBuiltInPresets;this.presets=builtInPresets;`, context);
const {controls, mapValue, update: updateFromSliders, convert, upgrade: upgradeV4Preset, oldPresets, presets} = context;
const advancedInputs = [...html.matchAll(/<input class="subSlider" type="range" id="slider(\w+)" min="(-?\d+)" max="(-?\d+)" value="(-?\d+)"/g)];
const intensityInputs = [...html.matchAll(/<input type="range" id="slider(Bloom|Hall|Grain|Sharp)" min="(-?\d+)" max="(-?\d+)" value="(-?\d+)"/g)];

for (const [, name] of [...advancedInputs, ...intensityInputs]) sliders[name] = {value: '0'};

test('the editor has an editorial monochrome layout with a restrained red accent', () => {
  assert.match(styles, /--bg:\s*#000/);
  assert.match(styles, /--text:\s*#fafafa/);
  assert.match(styles, /--accent:\s*#d62828/);
  assert.match(styles, /--negative:\s*#e8e8e8/);
  assert.match(styles, /#dropZone h2\s*\{[^}]*font-family:\s*var\(--display\);[^}]*text-transform:\s*uppercase/);
  assert.match(styles, /\.effectGroup\s*\{[^}]*border-top:\s*1px solid var\(--panel-border\);[^}]*border-radius:\s*0/);
  assert.match(styles, /\.hdrBtn\.primary\s*\{[^}]*background:\s*transparent;/);
  assert.doesNotMatch(styles, /#f5a623|#6aafff|#ff8c00/);
  assert.match(html, /white subtracts · red adds/);
});

test('the header uses Juwain Haque branding without changing the editor identity', () => {
  assert.match(html, /<div id="logo">Juwain Haque<\/div>/);
  assert.match(styles, /#logo \{[^}]*letter-spacing: \.15em;[^}]*text-transform: uppercase/);
  assert.doesNotMatch(html, /<div id="logo">[\s\S]*?CINEMATIC ENGINE<\/div>/);
  assert.match(html, /<title>FILM LAB — Cinematic Effects<\/title>/);
});

test('every effect has a separate accessible ON/OFF switch and a visible accordion arrow', () => {
  const groups = ['color', 'bloom', 'hallation', 'grain', 'sharpen'];
  const switches = [...html.matchAll(/class="effectToggle" data-toggle="(\w+)" role="switch" aria-checked="true" aria-label="([^"]+)"/g)];
  assert.deepEqual(switches.map(m => m[1]), groups);
  for (const group of groups) assert.match(html, new RegExp(`aria-controls="${group}Controls"`));
  assert.match(styles, /\.effectTitle \.expand \{[^}]*width: 26px;[^}]*border: 1px solid rgba\(255,255,255,\.62\)/);
  assert.match(styles, /\.effectTitle \.expand::before \{[^}]*border-right: 2px solid currentColor;[^}]*border-bottom: 2px solid currentColor/);
  assert.match(script, /e\.stopPropagation\(\); \/\/ switching an effect must not collapse its controls/);
  assert.match(script, /setGroupOpen\(g,!!anyClosed\)/);
});

test('effect switches bypass rendering at neutral without changing slider values', () => {
  const code = script.match(/const effectEnabled=\{[^\n]+;\nfunction effectValue\(group,value,neutral=0\)\{[^\n]+\}/)[0];
  const state = vm.createContext({});
  vm.runInContext(`${code}\nthis.enabled=effectEnabled;this.value=effectValue;`, state);
  for (const group of ['color', 'bloom', 'hallation', 'grain', 'sharpen']) {
    assert.equal(state.value(group, 0.75), 0.75);
    state.enabled[group] = false;
    assert.equal(state.value(group, 0.75), 0);
    state.enabled[group] = true;
    assert.equal(state.value(group, 0.75), 0.75);
  }
  state.enabled.color = false;
  assert.equal(state.value('color', 0.75, 1), 1); // neutral contrast and saturation
  for (const [uniform, group, param] of [
    ['u_strength', 'sharpen', 'sharpen'], ['u_bloomStrength', 'bloom', 'bloom'],
    ['u_hallationStrength', 'hallation', 'hallation'], ['u_grainStrength', 'grain', 'grain'],
    ['u_exposure', 'color', 'exposure'], ['u_temperature', 'color', 'temperature'],
    ['u_vignStrength', 'color', 'vignStrength'],
  ]) assert.ok(script.includes(`'${uniform}'),effectValue('${group}',params.${param})`), uniform);
  for (const param of ['contrast', 'saturation']) {
    assert.ok(script.includes(`'u_${param}'),effectValue('color',params.${param},1)`), param);
  }
});

test('all 32 controls start at 0 with centered -100 to +100 scales', () => {
  assert.equal(advancedInputs.length, 28);
  assert.equal(intensityInputs.length, 4);
  assert.deepEqual(advancedInputs.map(m => m[1]).sort(), Object.keys(controls).sort());
  for (const [, name, min, max, value] of [...advancedInputs, ...intensityInputs]) {
    assert.deepEqual([min, max, value], ['-100', '100', '0'], name);
    assert.match(html, new RegExp(`id="val${name}">0<`));
  }
  assert.match(script, /addScale\(slider\.parentNode\)/); // main intensities have labels too
  assert.match(script, /const fill=value<0\?'var\(--negative\)':'var\(--accent\)'/);
});

test('zero is neutral, details have two-sided ranges and intensities are signed', () => {
  for (const [name, {range}] of Object.entries(controls)) {
    for (const [position, expected] of [[-100, range[0]], [0, range[1]], [100, range[2]]]) {
      sliders[name].value = String(position);
      assert.ok(Math.abs(mapValue(name) - expected) < 1e-10, `${name} at ${position}`);
    }
    assert.ok(range[0] < range[1] && range[1] < range[2], `${name} needs both directions`);
    sliders[name].value = '0';
  }
  assert.deepEqual(Array.from(controls.Exposure.range), [-2, 0, 2]);
  assert.deepEqual(Array.from(controls.HallDir.range), [-180, 0, 180]);
  assert.equal(controls.BloomThresh.range[0], 0.3);
  assert.equal(controls.BloomThresh.range[2], 0.95);
  assert.equal(controls.VignStrength.range[1], 0); // no vignette at rest
  assert.equal(controls.Contrast.range[1], 1);
  assert.equal(controls.Saturation.range[1], 1);
  updateFromSliders();
  assert.equal(params.bloom, 0);
  assert.equal(params.hallation, 0);
  assert.equal(params.grain, 0);
  assert.equal(params.sharpen, 0);
  for (const name of ['Bloom', 'Hall', 'Grain', 'Sharp']) {
    for (const sign of [-100, 100]) {
      sliders[name].value = String(sign);
      updateFromSliders();
      assert.equal(params[{Bloom:'bloom',Hall:'hallation',Grain:'grain',Sharp:'sharpen'}[name]], sign / 100);
    }
    sliders[name].value = '0';
  }
});

test('negative effects are rendered as subtraction, inverse grain, blur, or bright edges', () => {
  assert.match(script, /sign\(u_bloomStrength\)\*bloomFinal/);
  assert.match(script, /hall\.rgb \* u_hallationStrength/);
  assert.match(script, /if\(abs\(u_grainStrength\)>0\.001\)/);
  assert.match(script, /float intensity=u_grainStrength\*0\.22/);
  assert.match(script, /if\(u_strength<0\.0\)\{[\s\S]*?mix\(center\.rgb, blur\.rgb, amount\)/);
  assert.match(script, /dot\(uv2,uv2\)\*u_vignStrength/);
  assert.match(script, /Math\.abs\(params\.bloom\)/);
  assert.match(script, /Math\.abs\(params\.hallation\)/);
});

test('six complete presets, legacy translations and v4 upgrades retain old looks', () => {
  assert.deepEqual(Object.keys(presets).sort(), ['Kodak Vision','Anamorphic','Matte Film','Clean Digital','Dream Glow','Noir Crunch'].sort());
  assert.equal(Object.keys(presets['Noir Crunch']).length, 32);
  assert.equal(presets['Noir Crunch'].Saturation, -100);
  assert.ok(presets['Noir Crunch'].Bloom < 0);
  for (const [name, {range, legacyZero}] of Object.entries(controls)) {
    assert.equal(convert({[name]: legacyZero})[name], 0, `${name} neutral`);
  }
  assert.equal(convert({Exposure: 52}).Exposure, 2); // old +0.04 stops, new range is wider
  assert.equal(convert({BloomThresh: 55}).BloomThresh, -21);
  assert.equal(convert({HallDir: 5}).HallDir, 10); // old 18° => new +10
  for (const values of Object.values(oldPresets)) {
    const converted = convert(values);
    for (const [name, {range, legacyZero}] of Object.entries(controls)) {
      const old = values[name], signed = converted[name];
      assert.ok(signed >= -100 && signed <= 100, name);
      sliders[name].value = String(signed);
      if (name === 'HallDir') {
        const radians = Math.PI / 180;
        assert.ok(Math.abs(Math.cos(old * 3.6 * radians) - Math.cos(mapValue(name) * radians)) < 0.04);
        assert.ok(Math.abs(Math.sin(old * 3.6 * radians) - Math.sin(mapValue(name) * radians)) < 0.04);
      } else {
        const [min, neutral, max] = range;
        const previous = name === 'Exposure' ? (old - 50) / 50
          : old < legacyZero
            ? min + old / legacyZero * (neutral - min)
            : neutral + (old - legacyZero) / (100 - legacyZero) * (max - neutral);
        assert.ok(Math.abs(previous - mapValue(name)) <= (max - min) / 100 + 1e-10, name);
      }
    }
    for (const name of ['Bloom', 'Hall', 'Grain', 'Sharp']) assert.equal(converted[name], values[name]);
  }
  const oldCustom = {name:'Saved',values:{Exposure:40,HallDir:-60,Bloom:30}};
  const migrated = upgradeV4Preset(oldCustom);
  assert.equal(migrated.values.Exposure, 20);
  assert.equal(migrated.values.HallDir, -30);
  assert.equal(migrated.values.Bloom, 30);
  assert.equal(migrated.version, 2);
  assert.equal(upgradeV4Preset(migrated), migrated);
  assert.match(script, /const dur=340/);
  assert.match(script, /film_lab_presets_v4/);
});

test('all built-in looks leave sharpening neutral while preserving their other effects', () => {
  const sharpenControls = ['Sharp', 'SharpRadius', 'SharpEdge', 'SharpDetail', 'SharpLuma'];
  for (const [name, values] of Object.entries(presets)) {
    assert.equal(Object.keys(values).length, 32, `${name} is complete`);
    for (const key of sharpenControls) assert.equal(values[key], 0, `${name}: ${key}`);
    if (oldPresets[name]) {
      const previous = convert(oldPresets[name]);
      for (const key of Object.keys(previous)) {
        if (!sharpenControls.includes(key)) assert.equal(values[key], previous[key], `${name}: ${key}`);
      }
    }
  }
  assert.match(script, /if\(abs\(u_strength\)<0\.001\)\{ outColor=center; return; \}/);
  assert.equal(convert({Sharp:80}).Sharp, 80); // manual and saved custom settings remain available
});

test('video processing retains a 60s cap, WebCodecs fallback and frame progress', () => {
  assert.match(script, /Math\.min\(videoEl\.duration,60\)/);
  assert.match(script, /@ffmpeg\/ffmpeg@0\.12\.10\/dist\/umd\/ffmpeg\.js/);
  assert.match(script, /@ffmpeg\/ffmpeg@0\.11\.6\/dist\/ffmpeg\.min\.js/);
  assert.match(script, /typeof window\.VideoFrame==='function'/);
  assert.match(script, /frame=new VideoFrame\(videoEl/);
  assert.match(script, /useWebCodecs=false;[\s\S]*?gl\.texImage2D\([\s\S]*?videoEl\)/);
  assert.match(script, /Frame \$\{i\+1\}\/\$\{total\}/);
  assert.match(script, /cancelAnimationFrame\(animId\)/);
});
