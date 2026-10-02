/* Film Lab video timeline — isolated from the WebGL render loop and FFmpeg worker. */
(() => {
  'use strict';
  function mountTimelineModule() {
  const root = document.getElementById('timeline-module');
  const bridge = window.filmLabTimelineBridge;
  if (!root || !bridge) return;
  const $ = (id) => document.getElementById(id);
  const view = $('timeline-scroll'), inner = $('timeline-inner'), ruler = $('timeline-ruler');
  const clipLayer = $('timeline-clips'), playhead = $('timeline-playhead'), waveform = $('timeline-audio');
  const state = { duration: 0, windowStart: 0, windowEnd: 0, zoom: 1, segments: [], selected: null, nextId: 1, undo: [], redo: [], cut: false, transitionTarget: null, drag: null, updating: false };
  const transitionNames = { none: 'None', dissolve: 'Dissolve', 'fade-to-black': 'Fade to black', 'fade-from-black': 'Fade from black' };
  const TRANSITION_SECONDS = 0.5;
  const copySegments = () => state.segments.map(segment => ({ ...segment }));
  const video = () => document.getElementById('videoEl');
  const valid = () => !!video() && Number.isFinite(video().duration) && video().duration > 0;
  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
  const formatTime = (n) => {
    const t = Math.max(0, Number(n) || 0), m = Math.floor(t / 60), s = Math.floor(t % 60), tenths = Math.floor(t * 10) % 10;
    return t >= 60 ? `${m}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}.${tenths}`;
  };
  function snapshot() { state.undo.push({ segments: copySegments(), selected: state.selected }); if (state.undo.length > 60) state.undo.shift(); state.redo.length = 0; }
  function restore(entry) { state.segments = entry.segments.map(segment => ({ ...segment })); state.selected = entry.selected; render(); syncEnvelope(); }
  function timeAtPointer(event) {
    const rect = inner.getBoundingClientRect();
    return clamp((event.clientX - rect.left) / Math.max(1, rect.width) * state.duration, 0, state.duration);
  }
  function scaleWidth() { return Math.max(560, Math.round(view.clientWidth * state.zoom)); }
  function renderRuler() {
    const width = scaleWidth(); inner.style.width = `${width}px`;
    ruler.style.width = `${width}px`; ruler.replaceChildren();
    if (!state.duration) return;
    const visibleSeconds = state.duration / state.zoom;
    const step = [1, 2, 5, 10, 15, 30, 60, 120, 300].find(value => visibleSeconds / value <= 7) || 600;
    for (let time = 0; time <= state.duration + 0.001; time += step) {
      const tick = document.createElement('span'); tick.className = 'timeline-ruler-tick'; tick.style.left = `${time / state.duration * 100}%`;
      const label = document.createElement('span'); label.className = 'timeline-ruler-label'; label.textContent = formatTime(time); tick.appendChild(label); ruler.appendChild(tick);
    }
  }
  function drawThumbnailLayer() {
    const layer = $('timeline-thumbnails'); layer.replaceChildren();
    const sources = [...document.querySelectorAll('#timelineFilmstrip img')].map(image => image.src);
    if (!sources.length) return;
    sources.forEach((src, index) => {
      const image = document.createElement('img'); image.className = 'timeline-thumbnail'; image.src = src; image.alt = ''; image.draggable = false;
      image.style.left = `${index / sources.length * 100}%`; image.style.width = `${100 / sources.length + 0.3}%`; layer.appendChild(image);
    });
  }
  function drawWaveform() {
    waveform.replaceChildren();
    const oldBars = [...document.querySelectorAll('#audioWaveform .audioWaveBar')];
    if (!oldBars.length) return;
    oldBars.forEach(old => {
      const bar = document.createElement('i'); bar.className = 'timeline-wave-bar';
      bar.style.height = old.style.getPropertyValue('--wave-height') || '8%'; waveform.appendChild(bar);
    });
  }
  function makeHandle(segment, edge) {
    const button = document.createElement('button'); button.type = 'button'; button.className = `timeline-trim-handle timeline-trim-${edge}`;
    const label = document.createElement('span'); label.className = 'timeline-trim-label';
    label.textContent = `${edge === 'in' ? 'IN' : 'OUT'} ${formatTime(edge === 'in' ? segment.start : segment.end)}`; button.appendChild(label);
    button.setAttribute('aria-label', `${edge === 'in' ? 'Trim segment start' : 'Trim segment end'} at ${formatTime(edge === 'in' ? segment.start : segment.end)}`);
    button.title = label.textContent;
    button.addEventListener('pointerdown', event => { event.stopPropagation(); beginDrag(event, edge, segment.id); });
    return button;
  }
  function render() {
    const duration = state.duration;
    renderRuler(); clipLayer.replaceChildren();
    if (!duration) {
      $('timeline-empty').hidden = false; $('timeline-timecode').textContent = '0:00 / 0:00'; $('timeline-selected-duration').textContent = 'No clip loaded';
      $('timeline-thumbnails').replaceChildren(); waveform.replaceChildren(); updateToolbar(); return;
    }
    drawThumbnailLayer(); drawWaveform();
    state.segments.forEach((segment, index) => {
      const item = document.createElement('div'); item.className = 'timeline-clip';
      if (segment.id === state.selected) item.classList.add('timeline-clip-selected');
      item.dataset.segment = String(segment.id); item.style.left = `${segment.start / duration * 100}%`; item.style.width = `${Math.max(0.2, (segment.end - segment.start) / duration * 100)}%`;
      const thumbs = document.createElement('div'); thumbs.className = 'timeline-clip-thumbnails';
      [...document.querySelectorAll('#timelineFilmstrip img')].forEach(image => { const thumb = document.createElement('img'); thumb.src = image.src; thumb.alt = ''; thumb.draggable = false; thumbs.appendChild(thumb); });
      item.append(thumbs, makeHandle(segment, 'in'), makeHandle(segment, 'out'));
      item.addEventListener('pointerdown', event => {
        if (event.target.closest('.timeline-trim-handle')) return;
        if (state.cut) { event.preventDefault(); event.stopPropagation(); const at = timeAtPointer(event); splitAt(at); state.cut = false; $('timeline-cut').setAttribute('aria-pressed', 'false'); root.classList.remove('timeline-cut-mode'); return; }
        state.selected = segment.id; render();
      });
      clipLayer.appendChild(item);
      if (index < state.segments.length - 1) {
        const next = state.segments[index + 1], boundary = document.createElement('button'); boundary.type = 'button'; boundary.className = 'timeline-transition';
        boundary.style.left = `${(segment.end + next.start) / 2 / duration * 100}%`; boundary.textContent = '◇';
        boundary.title = `Transition: ${transitionNames[segment.transition || 'none']}`; boundary.setAttribute('aria-label', `Transition after clip ${index + 1}: ${transitionNames[segment.transition || 'none']}`);
        boundary.addEventListener('click', event => { event.stopPropagation(); state.transitionTarget = segment.id; showTransitionMenu(boundary, segment); });
        clipLayer.appendChild(boundary);
        if (segment.end < next.start - 0.04) {
          const gap = document.createElement('div'); gap.className = 'timeline-gap'; gap.style.left = `${segment.end / duration * 100}%`; gap.style.width = `${(next.start - segment.end) / duration * 100}%`; clipLayer.appendChild(gap);
        }
      }
    });
    $('timeline-empty').hidden = state.segments.length > 0;
    updatePlayhead(); updateToolbar();
  }
  function updateToolbar() {
    const empty = !state.duration;
    for (const id of ['timeline-skip-start','timeline-play','timeline-skip-end','timeline-cut','timeline-zoom-minus','timeline-zoom-plus','timeline-mute','timeline-volume']) $(id).disabled = empty;
    document.querySelectorAll('.timeline-rate').forEach(button => { button.disabled = empty; });
    $('timeline-delete').disabled = empty || !state.selected || state.segments.length <= 1;
    $('timeline-undo').disabled = empty || !state.undo.length; $('timeline-redo').disabled = empty || !state.redo.length;
    if (!empty) $('timeline-selected-duration').textContent = `${state.segments.reduce((sum, segment) => sum + segment.end - segment.start, 0).toFixed(1)}s selected`;
  }
  function updatePlayhead() {
    if (!state.duration) return;
    const current = clamp(video()?.currentTime || 0, 0, state.duration);
    playhead.style.left = `${current / state.duration * 100}%`;
    $('timeline-timecode').textContent = `${formatTime(current)} / ${formatTime(state.duration)}`;
    $('timeline-play').textContent = video()?.paused ? '▶' : 'Ⅱ';
    $('timeline-play').setAttribute('aria-label', video()?.paused ? 'Play video' : 'Pause video');
    $('timeline-mute').textContent = video()?.muted ? '🔇' : '🔊';
    $('timeline-mute').setAttribute('aria-label', video()?.muted ? 'Unmute video' : 'Mute video');
    document.querySelectorAll('.timeline-rate').forEach(button => button.setAttribute('aria-pressed', String(Number(button.dataset.rate) === (video()?.playbackRate || 1))));
    for (const segment of state.segments) {
      if (current > segment.start + 0.025 && current < segment.end - 0.025) return;
    }
    const active = state.segments.find(segment => Math.abs(current - segment.start) < 0.05 || Math.abs(current - segment.end) < 0.05);
    if (active) { state.selected = active.id; document.querySelectorAll('.timeline-clip').forEach(item => item.classList.toggle('timeline-clip-selected', Number(item.dataset.segment) === active.id)); }
  }
  function syncEnvelope() {
    if (!state.segments.length || state.updating) return;
    const start = Math.min(...state.segments.map(segment => segment.start));
    const end = Math.max(...state.segments.map(segment => segment.end));
    state.updating = true;
    bridge.setTrim(start, end);
    state.updating = false;
  }
  function splitAt(time) {
    const segment = state.segments.find(item => time > item.start + 0.2 && time < item.end - 0.2);
    if (!segment) return;
    snapshot(); const index = state.segments.indexOf(segment), originalEnd = segment.end;
    segment.end = time; segment.transition = 'none';
    const right = { id: state.nextId++, start: time, end: originalEnd, transition: 'none' };
    state.segments.splice(index + 1, 0, right); state.selected = right.id; render();
  }
  function deleteSelected() {
    if (!state.selected || state.segments.length <= 1) return;
    snapshot(); const index = state.segments.findIndex(segment => segment.id === state.selected);
    if (index < 0) return;
    state.segments.splice(index, 1); if (index > 0) state.segments[index - 1].transition = 'none';
    state.selected = state.segments[Math.max(0, index - 1)].id; render(); syncEnvelope();
  }
  function beginDrag(event, edge, id) {
    if (!valid() || event.button > 0) return;
    event.preventDefault(); view.setPointerCapture(event.pointerId);
    snapshot(); state.drag = { edge, id };
    dragTo(event);
  }
  function dragTo(event) {
    if (!state.drag) return;
    const segment = state.segments.find(item => item.id === state.drag.id); if (!segment) return;
    const at = timeAtPointer(event), min = Math.min(0.2, state.duration), index = state.segments.indexOf(segment);
    const previous = state.segments[index - 1], next = state.segments[index + 1];
    const otherDuration = state.segments.reduce((sum, item) => sum + (item.id === segment.id ? 0 : item.end - item.start), 0);
    const maxLength = Math.max(min, Math.min(state.duration, 60 - otherDuration));
    if (state.drag.edge === 'in') segment.start = clamp(at, Math.max(previous?.end ?? state.windowStart, segment.end - maxLength), segment.end - min);
    else segment.end = clamp(at, segment.start + min, Math.min(next?.start ?? state.windowEnd, segment.start + maxLength));
    state.selected = segment.id; render(); syncEnvelope();
  }
  function showTransitionMenu(button, segment) {
    const popover = $('timeline-transition-menu'); popover.hidden = false;
    const box = button.getBoundingClientRect(), rootBox = root.getBoundingClientRect();
    popover.style.left = `${clamp(box.left - rootBox.left, 4, Math.max(4, root.clientWidth - 192))}px`;
    popover.style.top = `${clamp(box.top - rootBox.top - 106, 4, Math.max(4, root.clientHeight - 106))}px`;
    popover.querySelectorAll('[data-transition]').forEach(option => option.setAttribute('aria-pressed', String(option.dataset.transition === (segment.transition || 'none'))));
  }
  function setTransition(value) {
    const segment = state.segments.find(item => item.id === state.transitionTarget); if (!segment) return;
    snapshot(); segment.transition = value; $('timeline-transition-menu').hidden = true; render();
  }
  function getExportPlan() {
    const segments = state.segments.map(segment => ({ start: segment.start, end: segment.end, transition: segment.transition || 'none' }));
    const duration = segments.reduce((sum, segment) => sum + segment.end - segment.start, 0) - segments.reduce((sum, segment, index) => sum + (segment.transition === 'dissolve' && segments[index+1] ? Math.min(TRANSITION_SECONDS,(segment.end-segment.start)/2,(segments[index+1].end-segments[index+1].start)/2) : 0), 0);
    return { segments, duration: Math.max(0.01, duration), transitionSeconds: TRANSITION_SECONDS };
  }
  function mapOutputTime(time, plan = getExportPlan()) {
    let cursor = 0;
    for (let i = 0; i < plan.segments.length; i++) {
      const segment = plan.segments[i], incoming = i > 0 && plan.segments[i - 1].transition === 'dissolve' ? Math.min(plan.transitionSeconds, (plan.segments[i - 1].end - plan.segments[i - 1].start)/2, (segment.end - segment.start)/2) : 0;
      const outgoing = segment.transition === 'dissolve' && i < plan.segments.length - 1 ? Math.min(plan.transitionSeconds, (segment.end - segment.start)/2, (plan.segments[i + 1].end - plan.segments[i + 1].start)/2) : 0;
      const bodyStart = segment.start + incoming, bodyEnd = segment.end - outgoing, bodyDuration = Math.max(0, bodyEnd - bodyStart);
      if (time < cursor + bodyDuration) {
        const sourceTime = bodyStart + (time - cursor); let blackAlpha = 0;
        const transitionIn = i > 0 ? plan.segments[i - 1].transition : 'none';
        const fadeInDuration = Math.min(plan.transitionSeconds, bodyDuration), fadeOutDuration = Math.min(plan.transitionSeconds, bodyDuration);
        if (transitionIn === 'fade-from-black' && time - cursor < fadeInDuration) blackAlpha = 1 - clamp((time - cursor) / fadeInDuration, 0, 1);
        if (segment.transition === 'fade-to-black' && bodyDuration - (time - cursor) < fadeOutDuration) blackAlpha = clamp(1 - (bodyDuration - (time - cursor)) / fadeOutDuration, 0, 1);
        return { sourceTime, blackAlpha };
      }
      cursor += bodyDuration;
      if (outgoing) {
        if (time < cursor + outgoing) { const progress = clamp((time - cursor) / outgoing, 0, 1); return { sourceTime: segment.end - outgoing + progress * outgoing, blendTime: plan.segments[i + 1].start + progress * outgoing, blend: progress }; }
        cursor += outgoing;
      }
      if (time < cursor + 0.001 && i === plan.segments.length - 1) return { sourceTime: segment.end - 0.001, blackAlpha: 0 };
    }
    const last = plan.segments[plan.segments.length - 1]; return { sourceTime: last ? last.end - 0.001 : 0, blackAlpha: 0 };
  }
  function setVideo(duration, start, end) {
    state.duration = Number(duration) || 0; state.zoom = 1; state.undo.length = 0; state.redo.length = 0; state.nextId = 1;
    const minimum = Math.min(0.2, state.duration), inPoint = Number(start) || 0, outPoint = Number(end) || state.duration;
    state.windowStart = state.duration ? clamp(Math.min(inPoint, outPoint - 60), 0, state.duration - minimum) : 0;
    state.windowEnd = Math.min(state.duration, state.windowStart + 60);
    state.segments = state.duration ? [{ id: state.nextId++, start: clamp(inPoint, state.windowStart, state.windowEnd - minimum), end: clamp(outPoint, minimum, state.windowEnd), transition: 'none' }] : [];
    state.selected = state.segments[0]?.id || null; root.hidden = false; observedVideo(); render();
  }
  function reset() { state.duration = 0; state.windowStart = 0; state.windowEnd = 0; state.segments = []; state.selected = null; root.hidden = false; $('timeline-transition-menu').hidden = true; render(); }
  function setZoom(value, anchorX = view.clientWidth / 2) {
    const oldWidth = Math.max(1, inner.clientWidth), anchorTime = (view.scrollLeft + anchorX) / oldWidth;
    state.zoom = clamp(value, 1, 8); renderRuler(); view.scrollLeft = anchorTime * inner.clientWidth - anchorX; updateZoomLabel(); render();
  }
  function updateZoomLabel() { $('timeline-zoom-label').textContent = `${state.zoom.toFixed(1)}×`; }
  function onWheel(event) { if (!valid()) return; event.preventDefault(); const direction = event.deltaY < 0 ? 1.18 : 1 / 1.18; setZoom(state.zoom * direction, event.clientX - view.getBoundingClientRect().left); }
  function onKeydown(event) {
    if (!valid() || event.target.matches('input,textarea,select,[contenteditable="true"]') || event.altKey || event.ctrlKey || event.metaKey) return;
    if ((event.key === 'Delete' || event.key === 'Backspace') && root.contains(event.target)) { event.preventDefault(); deleteSelected(); }
  }
  $('timeline-skip-start').addEventListener('click', () => { const segment = state.segments[0]; if (segment && video()) video().currentTime = segment.start; });
  $('timeline-play').addEventListener('click', () => $('videoPlayBtn')?.click());
  $('timeline-skip-end').addEventListener('click', () => { const segment = state.segments[state.segments.length - 1]; if (segment && video()) video().currentTime = segment.end; });
  $('timeline-cut').addEventListener('click', event => { state.cut = !state.cut; event.currentTarget.setAttribute('aria-pressed', String(state.cut)); root.classList.toggle('timeline-cut-mode', state.cut); });
  $('timeline-delete').addEventListener('click', deleteSelected);
  $('timeline-undo').addEventListener('click', () => { if (!state.undo.length) return; state.redo.push({ segments: copySegments(), selected: state.selected }); restore(state.undo.pop()); });
  $('timeline-redo').addEventListener('click', () => { if (!state.redo.length) return; state.undo.push({ segments: copySegments(), selected: state.selected }); restore(state.redo.pop()); });
  $('timeline-zoom-minus').addEventListener('click', () => setZoom(state.zoom / 1.25)); $('timeline-zoom-plus').addEventListener('click', () => setZoom(state.zoom * 1.25));
  $('timeline-transition-menu').querySelectorAll('[data-transition]').forEach(button => button.addEventListener('click', () => setTransition(button.dataset.transition)));
  $('timeline-transition-close').addEventListener('click', () => { $('timeline-transition-menu').hidden = true; });
  document.addEventListener('pointerdown', event => { if (!event.target.closest('#timeline-transition-menu,.timeline-transition')) $('timeline-transition-menu').hidden = true; });
  view.addEventListener('pointerdown', event => {
    if (!valid() || event.target.closest('.timeline-trim-handle,.timeline-transition')) return;
    if (state.cut) { splitAt(timeAtPointer(event)); state.cut = false; $('timeline-cut').setAttribute('aria-pressed', 'false'); root.classList.remove('timeline-cut-mode'); return; }
    state.drag = { edge: 'playhead' }; view.setPointerCapture(event.pointerId); if (!video().paused) $('videoPlayBtn')?.click(); video().currentTime = timeAtPointer(event); updatePlayhead();
  });
  view.addEventListener('pointermove', event => {
    if (!state.drag) return;
    if (state.drag.edge === 'playhead') { const target = timeAtPointer(event); if (state.segments.some(segment => target >= segment.start && target <= segment.end)) video().currentTime = target; else { const closest = state.segments.reduce((best, segment) => Math.abs(segment.start - target) < Math.abs(best.start - target) ? segment : best, state.segments[0]); video().currentTime = closest.start; } updatePlayhead(); }
    else dragTo(event);
  });
  ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(type => { view.addEventListener(type, () => { state.drag = null; }); document.addEventListener(type, () => { if (state.drag && state.drag.edge !== 'playhead') state.drag = null; }); });
  view.addEventListener('wheel', onWheel, { passive: false });
  view.addEventListener('scroll', () => { $('timeline-ruler-scroll').scrollLeft = view.scrollLeft; }, { passive: true });
  root.addEventListener('keydown', onKeydown);
  window.addEventListener('resize', () => { if (state.duration) { renderRuler(); render(); } });
  let boundVideo = null;
  const observedVideo = () => {
    const element = video(); if (!element || element === boundVideo) return;
    boundVideo = element;
    const onPlaybackTime = () => {
      updatePlayhead();
      if (element.paused || state.segments.length < 2) return;
      const current = element.currentTime, active = state.segments.some(segment => current >= segment.start - 0.015 && current < segment.end - 0.02);
      if (!active) {
        const next = state.segments.find(segment => segment.start > current);
        if (next) element.currentTime = next.start;
        else if ($('videoLoopToggle')?.getAttribute('aria-pressed') === 'true') element.currentTime = state.segments[0].start;
        else { element.currentTime = state.segments[state.segments.length-1].end; $('videoPlayBtn')?.click(); }
      }
    };
    element.addEventListener('timeupdate', onPlaybackTime); element.addEventListener('seeked', updatePlayhead); element.addEventListener('play', updatePlayhead); element.addEventListener('pause', updatePlayhead); element.addEventListener('ratechange', updatePlayhead); element.addEventListener('volumechange', updatePlayhead);
  };
  $('timeline-mute').addEventListener('click', () => { $('videoMuteBtn')?.click(); updatePlayhead(); });
  $('timeline-volume').addEventListener('input', event => { const input = $('videoVolume'); input.value = event.target.value; input.dispatchEvent(new Event('input', { bubbles: true })); });
  document.querySelectorAll('.timeline-rate').forEach(button => button.addEventListener('click', () => { document.querySelector(`#videoPlaybackControls [data-playback-rate="${button.dataset.rate}"]`)?.click(); updatePlayhead(); }));
  const api = {
    setVideo, reset, refresh: updatePlayhead, syncBaseTrim(trim) {
      if (state.updating || !state.duration) return;
      state.windowStart = clamp(Math.min(trim.start,trim.end-60),0,Math.max(0,state.duration-.2)); state.windowEnd = Math.min(state.duration,state.windowStart+60);
      if (state.segments.length === 1) { state.segments[0].start = trim.start; state.segments[0].end = trim.end; }
      else {
        state.segments = state.segments.map(segment => ({...segment,start:Math.max(segment.start,trim.start),end:Math.min(segment.end,trim.end)})).filter(segment => segment.end-segment.start >= Math.min(.2,state.duration));
        if (!state.segments.length) state.segments = [{id:state.nextId++,start:trim.start,end:trim.end,transition:'none'}];
        state.segments[state.segments.length-1].transition='none';
        if (!state.segments.some(segment => segment.id===state.selected)) state.selected=state.segments[0].id;
      }
      render();
    },
    getExportPlan, mapOutputTime,
  };
  window.filmLabTimeline = api;
  observedVideo();
  new MutationObserver(() => observedVideo()).observe(document.getElementById('previewStage'), { childList: true });
  renderRuler(); updateZoomLabel(); render();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountTimelineModule, { once: true });
  else mountTimelineModule();
})();
