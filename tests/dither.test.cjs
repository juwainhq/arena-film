const {test} = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync, statSync} = require('node:fs');
const {resolve} = require('node:path');
const vm = require('node:vm');

const html = readFileSync(resolve(__dirname, '../index.html'), 'utf8');
const styles = html.split('<style>')[1].split('</style>')[0];
const script = html.split('<script>')[1].split('</script>')[0];
const composite = script.match(/const fsComposite=`([\s\S]*?)`;/)[1];

test('Dither has signed intensity, two explicit photo scopes, on/off, and advanced controls', () => {
  assert.match(html, /data-group="dither"[\s\S]*?aria-controls="ditherControls"/);
  assert.match(html, /class="effectToggle" data-toggle="dither" role="switch" aria-checked="true"/);
  for (const name of ['Dither','DitherSteps','DitherSize','DitherBrush']) {
    assert.match(html,new RegExp(`id="slider${name}" min="-100" max="100" value="0"`));
    assert.match(html,new RegExp(`id="val${name}">0<`));
  }
  assert.match(html, /role="radiogroup" aria-label="Dither area"/);
  assert.match(html, /name="ditherScope" value="full" checked/);
  assert.match(html, /name="ditherScope" value="background"/);
  assert.match(html, /id="ditherMaskTools" hidden/);
  assert.match(styles, /\.ditherMaskTools\[hidden\] \{ display: none; \}/);
  assert.match(script, /\['Bloom','Hall','Grain','Dither','Sharp'\]\.forEach/);
  assert.match(script, /params\.dither=Number\(sliders\.Dither\.value\)\/100/);
});

test('Dither is a deterministic Bayer print effect, masked only outside a protected subject', () => {
  assert.match(composite, /uniform sampler2D u_subjectMask;/);
  for (const uniform of ['u_ditherStrength','u_ditherSteps','u_ditherSize','u_ditherBackgroundOnly']) assert.match(composite,new RegExp(`uniform (?:float|int) ${uniform};`));
  assert.match(composite, /const float bayer\[16\]=float\[16\]\(0\.,8\.,2\.,10\.,12\.,4\.,14\.,6\.,3\.,11\.,1\.,9\.,15\.,7\.,13\.,5\.\)/);
  assert.match(composite, /if\(abs\(u_ditherStrength\)>0\.001\)/); // neutral bypasses old presets
  assert.match(composite, /if\(u_ditherStrength<0\.0\)\{[\s\S]*?ink=mix\(ink,vec3\(gray\),amount\)/);
  assert.match(composite, /orderedDither\(gl_FragCoord\.xy\)/); // anchored in image pixels, not zoom
  assert.match(composite, /u_ditherBackgroundOnly==1 \? 1\.0-smoothstep\(0\.05,0\.95,texture\(u_subjectMask,v_texCoord\)\.r\) : 1\.0/);
  assert.match(composite, /col=mix\(col,printed,amount\*area\)/);
  assert.match(script, /gl\.activeTexture\(gl\.TEXTURE3\); gl\.bindTexture\(gl\.TEXTURE_2D,subjectMaskTexture\)/);
  assert.match(script, /'u_ditherStrength'\),backgroundOnly && !subjectProtected \? 0 : effectValue\('dither',params\.dither\)/);
  assert.match(script, /const subjectProtected=!!autoSubjectMask \|\| maskStrokes\.some\(s=>s\.mode==='protect'\)/);
  assert.match(script, /ditherScope==='background' && !isVideo \? 1 : 0/);
  assert.match(script, /if\(showOriginal\)\{[\s\S]*?progPassthrough/);
});

test('automatic person protection is local, lazy, and stale inference cannot overwrite a new photo', () => {
  const dir=resolve(__dirname, '../vendor/mediapipe-selfie');
  for(const file of ['selfie_segmentation.js','selfie_segmentation.tflite','selfie_segmentation.binarypb','selfie_segmentation_solution_simd_wasm_bin.js','selfie_segmentation_solution_simd_wasm_bin.wasm','selfie_segmentation_solution_wasm_bin.js','selfie_segmentation_solution_wasm_bin.wasm']) {
    assert.ok(statSync(resolve(dir,file)).size>0,file);
  }
  assert.match(readFileSync(resolve(dir,'LICENSE'),'utf8'),/Apache License[\s\S]*?Version 2\.0/);
  assert.match(script, /script\.src='vendor\/mediapipe-selfie\/selfie_segmentation\.js'/);
  assert.match(script, /new window\.SelfieSegmentation\(\{locateFile:file=>base\+file\}\)/);
  assert.match(script, /if\(activeMaskRequest!==maskRequestId \|\| !maskCanvas \|\| !results\.segmentationMask\) return/);
  assert.match(script, /if\(token!==maskRequestId \|\| photo!==photoForMask\) return/);
  assert.match(script, /maskStrokes=\[\]; maskStroke=null; maskPaintMode=null; autoSubjectMask=null;/);
  assert.match(script, /if\(autoSubjectMask\) maskCtx\.drawImage\(autoSubjectMask/);
  assert.match(script, /if\(forVideo\)\{ maskCanvas=null; maskCtx=null; photoForMask=null; backgroundScope\.disabled=true; \}/);
  assert.match(script, /else if\(maskCanvas\)\{ maskCtx\.fillStyle='#000'; maskCtx\.fillRect/);
});

test('protect and erase brushes track image coordinates through zoom, including touch', () => {
  const bounds={left:100,top:50,width:600,height:400}; // scaled-and-panned preview
  const fn=script.match(/function subjectPoint\(e\)\{[\s\S]*?\n\}/)[0];
  const context=vm.createContext({canvas:{getBoundingClientRect:()=>bounds}});
  vm.runInContext(`${fn}\nthis.point=subjectPoint;`,context);
  assert.deepEqual(JSON.parse(JSON.stringify(context.point({clientX:250,clientY:150}))),{x:.25,y:.25});
  assert.deepEqual(JSON.parse(JSON.stringify(context.point({clientX:1300,clientY:-20}))),{x:1,y:0});
  assert.match(script, /canvas\.setPointerCapture\(e\.pointerId\)/);
  assert.match(script, /if\(maskStroke\)\{ paintSubject\(e\); return; \}/);
  assert.match(script, /function scheduleSubjectMaskUpload\(\)\{[\s\S]*?requestAnimationFrame\(\(\)=>\{ maskUploadFrame=0; uploadSubjectMask\(\); \}\)/);
  assert.match(script, /if\(maskUploadFrame\) uploadSubjectMask\(\); \/\/ export must see the final brush stroke immediately/);
  assert.match(styles, /#canvasWrap\.maskPainting #glCanvas \{ cursor: crosshair; touch-action: none; \}/);
  assert.match(script, /if\(!maskPaintMode\) fileInput\.click\(\)/);
  assert.match(html, /id="protectSubjectBtn" aria-pressed="false"/);
  assert.match(html, /id="eraseSubjectBtn" aria-pressed="false"/);
  assert.match(html, /id="maskStatus" role="status" aria-live="polite"/);
  assert.match(html, /id="maskDoneBtn" aria-label="Finish painting subject mask"/);
  assert.match(styles, /#canvasWrap\.maskPainting #maskDoneBtn \{ display: block; \}/);
  assert.match(script, /maskDoneBtn\.addEventListener\('click',\(\)=>setMaskPaintMode\(null\)\)/);
  assert.match(script, /canvas\.scrollIntoView\(\{block:'center',behavior:reduced\?'auto':'smooth'\}\)/);
});

test('still-photo grain remains frozen despite Speed; video grain can still animate', () => {
  assert.match(script, /'u_grainSpeed'\),isVideo \? params\.grainSpeed : 0/);
  assert.match(script, /'u_time'\),isVideo \? \(timeMs\?\?performance\.now\(\)\)\*0\.001 : 0/);
  assert.match(composite, /float t=u_time\*u_grainSpeed/);
  assert.match(html, /Speed <span>video only · photos stay still<\/span>/);
});

test('presets and resets return new sliders to neutral and remember scope for saved looks', () => {
  assert.match(script, /Bloom:0,Hall:0,Grain:0,Dither:0,Sharp:0/);
  assert.match(script, /setDitherScope\(values\.DitherScope==='background'\?'background':'full'\)/);
  assert.match(script, /const values=\{\.\.\.getCurrentValues\(\),DitherScope:ditherScope\}/);
  assert.match(script, /if\(btn\.dataset\.reset==='dither'\) setDitherScope\('full'\)/);
  assert.match(script, /ids\.forEach\(k=>\{ sliders\[k\]\.value=0; \}\);\n    setDitherScope\('full'\)/);
  assert.match(script, /const dur=340/);
});
