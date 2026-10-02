// === MULTI-TIMELINE MODULE ===
(() => {
  'use strict';

  const byId = (id) => document.getElementById(id);
  const root = byId('multi-timeline');
  if (!root) return;

  const bridge = () => window.filmLabTimelineBridge || {};
  const view = byId('mtl-scroll');
  const canvas = byId('mtl-canvas');
  const ruler = byId('mtl-ruler');
  const pool = byId('mtl-media-pool');
  const mainTrack = byId('mtl-main-track');
  const overlayTrack = byId('mtl-overlay-track');
  const audioTrack = byId('mtl-audio-track');
  const playhead = byId('mtl-playhead');
  const emptyHint = byId('mtl-empty');
  const transitionMenu = byId('mtl-transition-popover');
  const contextMenu = byId('mtl-context-menu');
  const state = {
    clips: [], media: new Map(), selected: null, contextClip: null, contextTime: 0,
    projectDuration: 0, pixelsPerSecond: 18, zoom: 1, timelineTime: 0,
    activeMain: null, transportPlaying: false, inGap: false, pendingMain: null, switchToken: 0, switchingSource: false,
    lastTick: 0, raf: 0, undo: [], redo: [], initialized: false,
    firstMediaId: null, lastOverlaySignature: '',
  };
  let boundVideoElement = null;
  let activePointer = null;
  let clipSequence = 1;
  let mediaSequence = 1;
  let overlayLayer = null;

  const uid = (prefix) => `${prefix}-${Date.now().toString(36)}-${(clipSequence++).toString(36)}`;
  const mainClips = () => state.clips.filter((clip) => clip.track === 'main').sort((a, b) => a.start - b.start);
  const overlayClips = () => state.clips.filter((clip) => clip.track === 'overlay').sort((a, b) => a.start - b.start);
  const clipDuration = (clip) => Math.max(0.05, clip.trimEnd - clip.trimStart);
  const clipEnd = (clip) => clip.start + clipDuration(clip);
  const safeTime = (time) => Math.max(0, Number.isFinite(time) ? time : 0);
  const makeSnapshot = () => ({ clips: state.clips.map((clip) => ({ ...clip })), selected: state.selected?.id || null, timelineTime: state.timelineTime });

  function remember() {
    state.undo.push(makeSnapshot());
    if (state.undo.length > 60) state.undo.shift();
    state.redo.length = 0;
    updateHistoryButtons();
  }
  function updateHistoryButtons() {
    root.querySelector('[data-mtl-action="undo"]').disabled = !state.undo.length;
    root.querySelector('[data-mtl-action="redo"]').disabled = !state.redo.length;
  }
  function restoreSnapshot(snapshot, destination) {
    if (!snapshot) return;
    destination.push(makeSnapshot());
    state.clips = snapshot.clips.map((clip) => ({ ...clip }));
    state.selected = state.clips.find((clip) => clip.id === snapshot.selected) || null;
    state.timelineTime = snapshot.timelineTime;
    state.activeMain = null;
    state.inGap = false;
    updateHistoryButtons();
    render();
    seekTo(state.timelineTime, false);
  }
  function undo() { restoreSnapshot(state.undo.pop(), state.redo); }
  function redo() { restoreSnapshot(state.redo.pop(), state.undo); }

  function getProjectEnd() {
    return Math.max(0, ...state.clips.map(clipEnd), state.timelineTime);
  }
  function getTimelinePixels() {
    return Math.max(240, view.clientWidth - 58, state.projectDuration * state.pixelsPerSecond);
  }
  function refreshLayout() {
    state.projectDuration = Math.max(0.25, getProjectEnd());
    const contentWidth = getTimelinePixels();
    canvas.style.width = `${58 + contentWidth}px`;
    canvas.style.minWidth = `${58 + contentWidth}px`;
    ruler.style.width = `${contentWidth}px`;
    const step = state.pixelsPerSecond;
    const majorStep = step < 8 ? 10 : step < 14 ? 5 : 2;
    const frag = document.createDocumentFragment();
    for (let sec = 0; sec <= state.projectDuration + 0.001; sec += majorStep) {
      const tick = document.createElement('div');
      tick.className = 'mtl-ruler-tick';
      tick.style.left = `${sec * step}px`;
      const label = document.createElement('span');
      label.textContent = formatTime(sec);
      tick.appendChild(label);
      frag.appendChild(tick);
    }
    ruler.replaceChildren(frag);
    byId('mtl-zoom-label').textContent = `${state.zoom.toFixed(1)}×`;
    byId('mtl-timecode').textContent = `${formatTime(state.timelineTime)} / ${formatTime(state.projectDuration)}`;
    updatePlayhead();
  }
  function formatTime(seconds) {
    seconds = Math.max(0, seconds || 0);
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    const tenths = Math.floor((seconds % 1) * 10);
    return `${mins}:${String(secs).padStart(2, '0')}.${tenths}`;
  }
  function updatePlayhead() {
    playhead.style.left = `${58 + state.timelineTime * state.pixelsPerSecond}px`;
    byId('mtl-timecode').textContent = `${formatTime(state.timelineTime)} / ${formatTime(state.projectDuration)}`;
    const active = state.clips.find((clip) => state.timelineTime >= clip.start && state.timelineTime < clipEnd(clip));
    byId('mtl-selection-status').textContent = state.selected ? `${state.selected.track.toUpperCase()} · ${formatTime(clipDuration(state.selected))}` : active ? `${active.track.toUpperCase()} PLAYING` : 'Select a clip';
  }
  function renderGaps() {
    mainTrack.querySelectorAll('.mtl-gap,.mtl-transition').forEach((node) => node.remove());
    const clips = mainClips();
    for (let i = 0; i < clips.length - 1; i++) {
      const clip = clips[i];
      const next = clips[i + 1];
      const end = clipEnd(clip);
      if (next.start > end + 0.025) {
        const gap = document.createElement('div');
        gap.className = 'mtl-gap';
        gap.style.left = `${end * state.pixelsPerSecond}px`;
        gap.style.width = `${(next.start - end) * state.pixelsPerSecond}px`;
        mainTrack.appendChild(gap);
      }
      const transition = document.createElement('button');
      transition.type = 'button';
      transition.className = 'mtl-transition';
      transition.textContent = clip.transition && clip.transition !== 'none' ? '◆' : '+';
      transition.title = `Transition after ${state.media.get(clip.mediaId)?.name || 'clip'}`;
      transition.style.left = `${next.start * state.pixelsPerSecond}px`;
      transition.dataset.transitionFor = clip.id;
      mainTrack.appendChild(transition);
      transition.addEventListener('click', (event) => {
        event.stopPropagation();
        state.selected = clip;
        renderSelection();
        showTransitionMenu(event, clip);
      });
    }
  }
  function renderTrackClips(trackName, element) {
    element.querySelectorAll('.mtl-clip').forEach((node) => node.remove());
    for (const clip of state.clips.filter((item) => item.track === trackName)) {
      const media = state.media.get(clip.mediaId);
      if (!media) continue;
      const node = document.createElement('div');
      node.className = `mtl-clip${state.selected?.id === clip.id ? ' mtl-selected' : ''}`;
      node.dataset.clipId = clip.id;
      node.draggable = false;
      node.style.left = `${clip.start * state.pixelsPerSecond}px`;
      node.style.width = `${Math.max(18, clipDuration(clip) * state.pixelsPerSecond)}px`;
      node.title = `${media.name} · ${formatTime(clipDuration(clip))}`;
      if (media.thumbnail) {
        const thumb = document.createElement('img');
        thumb.alt = '';
        thumb.src = media.thumbnail;
        node.appendChild(thumb);
      }
      const label = document.createElement('span');
      label.className = 'mtl-clip-name';
      label.textContent = media.name;
      node.appendChild(label);
      const left = document.createElement('button');
      left.type = 'button'; left.className = 'mtl-trim-handle mtl-trim-left'; left.setAttribute('aria-label', 'Trim clip start');
      const right = document.createElement('button');
      right.type = 'button'; right.className = 'mtl-trim-handle mtl-trim-right'; right.setAttribute('aria-label', 'Trim clip end');
      node.append(left, right);
      node.addEventListener('pointerdown', onClipPointerDown);
      node.addEventListener('contextmenu', onClipContextMenu);
      node.addEventListener('click', (event) => {
        if (event.target.closest('.mtl-trim-handle')) return;
        state.selected = clip;
        renderSelection();
      });
      element.appendChild(node);
    }
  }
  function renderSelection() {
    canvas.querySelectorAll('.mtl-clip').forEach((node) => node.classList.toggle('mtl-selected', node.dataset.clipId === state.selected?.id));
    updatePlayhead();
  }
  function renderAudio() {
    audioTrack.replaceChildren();
    const videos = mainClips().filter((clip) => state.media.get(clip.mediaId)?.type === 'video');
    if (!videos.length) return;
    const oldWave = byId('audioWaveform');
    const sourceBars = oldWave?.querySelectorAll('.audioWaveBar,.waveBar,.timeline-wave-bar,.audioBar') || [];
    for (const clip of videos) {
      const wave = document.createElement('div');
      wave.className = 'mtl-wave';
      wave.style.left = `${clip.start * state.pixelsPerSecond}px`;
      wave.style.width = `${clipDuration(clip) * state.pixelsPerSecond}px`;
      if (sourceBars.length) {
        for (const old of sourceBars) {
          const bar = document.createElement('i');
          bar.style.height = old.style.height || old.style.getPropertyValue('--wave-height') || '35%';
          wave.appendChild(bar);
        }
      } else {
        for (let i = 0; i < 90; i++) {
          const bar = document.createElement('i');
          const noise = Math.abs(Math.sin(i * 12.9898) * Math.cos(i * 78.233));
          bar.style.height = `${10 + noise * 78}%`;
          wave.appendChild(bar);
        }
      }
      audioTrack.appendChild(wave);
    }
  }
  function render() {
    refreshLayout();
    renderTrackClips('main', mainTrack);
    renderTrackClips('overlay', overlayTrack);
    renderGaps();
    renderAudio();
    emptyHint.hidden = state.clips.length > 0;
    updateHistoryButtons();
    renderSelection();
    renderOverlayPreview();
  }

  function getMediaThumbnail(media, videoElement = null) {
    try {
      const source = videoElement;
      if (!source || source.readyState < 2 || !source.videoWidth) return '';
      const thumb = document.createElement('canvas');
      const scale = Math.min(1, 180 / Math.max(source.videoWidth, source.videoHeight));
      thumb.width = Math.max(1, Math.round(source.videoWidth * scale));
      thumb.height = Math.max(1, Math.round(source.videoHeight * scale));
      thumb.getContext('2d').drawImage(source, 0, 0, thumb.width, thumb.height);
      return thumb.toDataURL('image/jpeg', 0.72);
    } catch (error) { return ''; }
  }
  function addMediaCard(media) {
    const card = document.createElement('button');
    card.type = 'button'; card.className = 'mtl-media-card'; card.draggable = true;
    card.dataset.mediaId = media.id; card.setAttribute('aria-pressed', 'false');
    if (media.thumbnail) {
      const img = document.createElement('img'); img.alt = ''; img.src = media.thumbnail; card.appendChild(img);
    }
    const title = document.createElement('span'); title.textContent = media.name; card.appendChild(title);
    card.addEventListener('click', () => {
      pool.querySelectorAll('.mtl-media-card').forEach((node) => node.setAttribute('aria-pressed', String(node === card)));
    });
    card.addEventListener('dblclick', () => addClipFromMedia(media.id, media.type === 'image' ? 'overlay' : 'main'));
    card.addEventListener('dragstart', (event) => {
      event.dataTransfer.setData('application/x-film-lab-media', media.id);
      event.dataTransfer.setData('text/plain', media.id);
      event.dataTransfer.effectAllowed = 'copy';
    });
    pool.appendChild(card);
  }
  function addFirstMedia(file, src, duration, videoElement) {
    const media = {
      id: `first-${mediaSequence++}`, file, src, type: 'video', duration,
      name: file?.name || 'Main video', thumbnail: '', videoElement,
      external: false,
    };
    media.thumbnail = getMediaThumbnail(media, videoElement) || '';
    state.media.set(media.id, media);
    state.firstMediaId = media.id;
    addMediaCard(media);
    const trim = bridge().trim || { start: 0, end: Math.min(duration, 60) };
    const end = Math.min(duration, Math.max(0.05, trim.end || duration));
    const firstClip = { id: uid('clip'), mediaId: media.id, track: 'main', start: 0, trimStart: Math.max(0, trim.start || 0), trimEnd: end, transition: 'none' };
    state.clips.unshift(firstClip);
    state.selected = firstClip;
    root.hidden = false;
    state.initialized = true;
    state.timelineTime = firstClip.start;
    render();
  }
  function adoptFirstVideo(file, videoElement, src, duration, trim) {
    root.hidden = false;
    const oldMain = mainClips();
    const oldFirst = oldMain.find((clip) => state.media.get(clip.mediaId)?.external === false);
    const mainBridge = bridge();
    if (state.firstMediaId && oldFirst && state.media.get(oldFirst.mediaId)?.src === src) {
      return;
    }
    // A newly uploaded primary video starts a fresh project; release any additional media from the prior one.
    for (const media of state.media.values()) if (media.external) URL.revokeObjectURL(media.src);
    state.clips = [];
    state.firstMediaId = null;
    state.undo.length = 0; state.redo.length = 0;
    pool.querySelectorAll('.mtl-media-card').forEach((card) => card.remove());
    state.media.clear();
    const t = trim || mainBridge.trim || { start: 0, end: Math.min(duration, 60) };
    addFirstMedia(file, src, duration, videoElement);
    if (boundVideoElement !== videoElement) {
      if (boundVideoElement) {
        boundVideoElement.removeEventListener('timeupdate', handleVideoTimeUpdate, true);
        boundVideoElement.removeEventListener('play', handlePlay);
        boundVideoElement.removeEventListener('pause', handlePause);
        boundVideoElement.removeEventListener('ended', onVideoEnded);
      }
      boundVideoElement = videoElement;
      boundVideoElement.addEventListener('timeupdate', handleVideoTimeUpdate, true);
      boundVideoElement.addEventListener('play', handlePlay);
      boundVideoElement.addEventListener('pause', handlePause);
      boundVideoElement.addEventListener('ended', onVideoEnded);
    }
    state.clips[0].trimStart = Math.max(0, Math.min(duration - 0.05, Number(t.start) || 0));
    state.clips[0].trimEnd = Math.max(state.clips[0].trimStart + 0.05, Math.min(duration, Number(t.end) || duration));
    state.clips[0].start = 0;
    state.selected = state.clips[0];
    state.activeMain = state.clips[0];
    state.transportPlaying = !videoElement.paused;
    render();
    if (state.transportPlaying) ensureTick();
  }
  async function addExternalMedia(file) {
    if (!file || (!file.type.startsWith('image/') && !file.type.startsWith('video/'))) return null;
    const src = URL.createObjectURL(file);
    try {
      let media;
      if (file.type.startsWith('image/')) {
        const img = new Image();
        img.decoding = 'async'; img.src = src;
        await (img.decode ? img.decode() : new Promise((resolve, reject) => { img.onload = resolve; img.onerror = reject; }));
        media = { id: `media-${mediaSequence++}`, file, src, type: 'image', duration: 5, name: file.name || 'Photo', thumbnail: src, imageElement: img, external: true };
      } else {
        const video = document.createElement('video');
        video.muted = true; video.playsInline = true; video.preload = 'auto'; video.src = src;
        await new Promise((resolve, reject) => {
          const timer = setTimeout(() => finish(new Error('Video metadata timed out')), 20000);
          const finish = (error) => { clearTimeout(timer); video.removeEventListener('loadedmetadata', ready); video.removeEventListener('error', fail); error ? reject(error) : resolve(); };
          const ready = () => finish(); const fail = () => finish(new Error('Could not read this video'));
          video.addEventListener('loadedmetadata', ready, { once: true }); video.addEventListener('error', fail, { once: true }); video.load();
        });
        if (!(video.duration > 0 && video.videoWidth > 0)) throw new Error('This video has no readable frames');
        try { await new Promise((resolve) => { if (video.readyState >= 2) return resolve(); video.addEventListener('loadeddata', resolve, { once: true }); setTimeout(resolve, 5000); }); } catch (error) {}
        media = { id: `media-${mediaSequence++}`, file, src, type: 'video', duration: video.duration, name: file.name || 'Video', thumbnail: getMediaThumbnail(null, video), videoElement: video, external: true };
      }
      state.media.set(media.id, media);
      addMediaCard(media);
      return media;
    } catch (error) {
      URL.revokeObjectURL(src);
      console.warn('Multi-timeline media import failed', error);
      window.dispatchEvent(new CustomEvent('film-lab-toast', { detail: `${file.name || 'Media'} could not be opened` }));
      return null;
    }
  }
  function resolveMainStart(desired, duration, excludedId = null) {
    const others = mainClips().filter((clip) => clip.id !== excludedId);
    const candidates = [safeTime(desired), 0, ...others.flatMap((clip) => [Math.max(0, clip.start - duration), clipEnd(clip)])];
    const valid = candidates.filter((candidate) => others.every((clip) => candidate + duration <= clip.start + 0.015 || candidate >= clipEnd(clip) - 0.015));
    return valid.sort((a, b) => Math.abs(a - desired) - Math.abs(b - desired))[0] ?? Math.max(0, ...others.map(clipEnd));
  }
  function addClipFromMedia(mediaId, trackName, at = null) {
    const media = state.media.get(mediaId);
    if (!media) return null;
    if (trackName === 'main' && media.type !== 'video') trackName = 'overlay';
    const duration = media.type === 'image' ? 5 : Math.max(0.05, Math.min(media.duration, 60));
    let start = at === null ? (trackName === 'main' ? Math.max(0, ...mainClips().map(clipEnd)) : 0) : safeTime(at);
    if (trackName === 'main') start = resolveMainStart(start, duration);
    remember();
    const clip = { id: uid('clip'), mediaId, track: trackName, start, trimStart: 0, trimEnd: duration, transition: 'none' };
    state.clips.push(clip);
    state.selected = clip;
    render();
    return clip;
  }
  async function addFilesToPool(files) {
    for (const file of Array.from(files || [])) {
      const media = await addExternalMedia(file);
      if (media && media.type === 'video' && state.clips.length === 0) addClipFromMedia(media.id, 'main');
    }
    render();
  }

  function showTransitionMenu(event, clip) {
    transitionMenu.hidden = false;
    transitionMenu.style.left = `${Math.min(event.offsetX || 80, Math.max(0, canvas.clientWidth - 175))}px`;
    transitionMenu.style.top = '8px';
    transitionMenu.querySelectorAll('[data-mtl-transition]').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.mtlTransition === clip.transition)));
    transitionMenu.dataset.clipId = clip.id;
  }
  function hideMenus() { transitionMenu.hidden = true; contextMenu.hidden = true; }
  function onClipContextMenu(event) {
    if (bridge().exporting) return;
    event.preventDefault();
    const node = event.currentTarget;
    const clip = state.clips.find((item) => item.id === node.dataset.clipId);
    if (!clip) return;
    state.selected = clip; state.contextClip = clip;
    state.contextTime = Math.max(clip.start, Math.min(clipEnd(clip), pointerTime(event.clientX)));
    contextMenu.hidden = false;
    contextMenu.style.left = `${Math.min(event.clientX - canvas.getBoundingClientRect().left, canvas.clientWidth - 160)}px`;
    contextMenu.style.top = `${Math.max(4, event.clientY - canvas.getBoundingClientRect().top)}px`;
    renderSelection();
  }
  function pointerTime(clientX) {
    const rect = canvas.getBoundingClientRect();
    return Math.max(0, (clientX - rect.left - 58) / state.pixelsPerSecond);
  }
  function onClipPointerDown(event) {
    if (bridge().exporting || event.button !== 0 || event.target.closest('.mtl-transition')) return;
    const node = event.currentTarget;
    const clip = state.clips.find((item) => item.id === node.dataset.clipId);
    if (!clip) return;
    event.stopPropagation();
    state.selected = clip; renderSelection();
    const edge = event.target.closest('.mtl-trim-left') ? 'left' : event.target.closest('.mtl-trim-right') ? 'right' : 'move';
    activePointer = { id: event.pointerId, clip, edge, node, startX: event.clientX, initialStart: clip.start, initialTrimStart: clip.trimStart, initialTrimEnd: clip.trimEnd, historySaved: false };
    node.setPointerCapture(event.pointerId);
    node.addEventListener('pointermove', onClipPointerMove);
    node.addEventListener('pointerup', onClipPointerEnd, { once: true });
    node.addEventListener('pointercancel', onClipPointerEnd, { once: true });
  }
  function onClipPointerMove(event) {
    if (bridge().exporting || !activePointer || event.pointerId !== activePointer.id) return;
    const drag = activePointer;
    const delta = (event.clientX - drag.startX) / state.pixelsPerSecond;
    if (!drag.historySaved && Math.abs(delta) > 0.02) { remember(); drag.historySaved = true; }
    const min = 0.05;
    if (drag.edge === 'move') {
      drag.clip.start = safeTime(drag.initialStart + delta);
    } else if (drag.edge === 'left') {
      const bounded = Math.max(-Math.min(drag.initialTrimStart, drag.initialStart), Math.min(drag.initialTrimEnd - drag.initialTrimStart - min, delta));
      drag.clip.start = safeTime(drag.initialStart + bounded);
      drag.clip.trimStart = drag.initialTrimStart + bounded;
    } else {
      const maxDuration = Math.min(state.media.get(drag.clip.mediaId)?.duration || Infinity, drag.initialTrimStart + 60);
      drag.clip.trimEnd = Math.max(drag.initialTrimStart + min, Math.min(maxDuration, drag.initialTrimEnd + delta));
    }
    const media = state.media.get(drag.clip.mediaId);
    drag.node.style.left = `${drag.clip.start * state.pixelsPerSecond}px`;
    drag.node.style.width = `${Math.max(18, clipDuration(drag.clip) * state.pixelsPerSecond)}px`;
    drag.node.title = `${media?.name || 'Clip'} · ${formatTime(clipDuration(drag.clip))}`;
    refreshLayout(); renderGaps(); renderAudio(); renderSelection();
  }
  function onClipPointerEnd(event) {
    if (!activePointer || event.pointerId !== activePointer.id) return;
    const drag = activePointer; activePointer = null;
    if (drag.edge === 'move' && drag.clip.track === 'main') drag.clip.start = resolveMainStart(drag.clip.start, clipDuration(drag.clip), drag.clip.id);
    drag.clip.start = Math.round(drag.clip.start * 100) / 100;
    drag.clip.trimStart = Math.round(drag.clip.trimStart * 100) / 100;
    drag.clip.trimEnd = Math.round(drag.clip.trimEnd * 100) / 100;
    drag.clip.trimEnd = Math.max(drag.clip.trimStart + 0.05, drag.clip.trimEnd);
    event.currentTarget.removeEventListener('pointermove', onClipPointerMove);
    render();
    const media = state.media.get(drag.clip.mediaId);
    if (drag.clip.track === 'main' && media?.src === bridge().sourceUrl) bridge().setTimelineTrim?.(drag.clip.trimStart, drag.clip.trimEnd);
  }

  function deleteSelected() {
    if (!state.selected) return;
    const removed = state.selected;
    const index = state.clips.findIndex((clip) => clip.id === removed.id);
    if (index < 0) return;
    remember(); state.clips.splice(index, 1); state.selected = null; render();
    if (state.activeMain?.id === removed.id) {
      state.transportPlaying = false; state.activeMain = null; bridge().pause?.();
      if (mainClips().length) seekTo(removed.start, false);
    }
    if (!mainClips().length) { state.transportPlaying = false; state.activeMain = null; state.timelineTime = 0; bridge().pause?.(); render(); }
  }
  function duplicateSelected() {
    if (!state.selected) return;
    remember();
    const copy = { ...state.selected, id: uid('clip'), start: clipEnd(state.selected) };
    if (copy.track === 'main') copy.start = resolveMainStart(copy.start, clipDuration(copy));
    state.clips.push(copy); state.selected = copy; render();
  }
  function splitClip(clip, at) {
    if (!clip || at <= clip.start + 0.05 || at >= clipEnd(clip) - 0.05) return;
    const media = state.media.get(clip.mediaId);
    remember();
    const sourceSplit = clip.trimStart + (at - clip.start);
    const right = { ...clip, id: uid('clip'), start: at, trimStart: sourceSplit, transition: 'none' };
    clip.trimEnd = sourceSplit;
    clip.transition = 'none';
    state.clips.push(right); state.selected = right;
    render();
    if (media?.type === 'image') return;
  }
  function handleContextAction(action) {
    const clip = state.contextClip;
    hideMenus();
    if (!clip) return;
    state.selected = clip;
    if (action === 'delete') deleteSelected();
    else if (action === 'duplicate') duplicateSelected();
    else if (action === 'split') splitClip(clip, state.contextTime);
  }
  function snapPointerToTime(event) {
    const target = event.target.closest('.mtl-track-content');
    if (!target) return;
    const at = pointerTime(event.clientX);
    state.timelineTime = Math.min(state.projectDuration, at);
    updatePlayhead();
    if (event.type === 'click' && event.target.closest('.mtl-clip')) return;
    seekTo(state.timelineTime, false);
  }
  function addDropHandlers(track, trackName) {
    track.addEventListener('dragover', (event) => { if (!bridge().exporting) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; } });
    track.addEventListener('drop', async (event) => {
      if (bridge().exporting) return;
      event.preventDefault(); event.stopPropagation();
      const at = pointerTime(event.clientX);
      const id = event.dataTransfer.getData('application/x-film-lab-media') || event.dataTransfer.getData('text/plain');
      const files = event.dataTransfer.files;
      if (files?.length) {
        for (const file of files) {
          const media = await addExternalMedia(file);
          if (media) addClipFromMedia(media.id, trackName, at);
        }
      } else if (id && state.media.has(id)) addClipFromMedia(id, trackName, at);
    });
  }
  addDropHandlers(mainTrack, 'main');
  addDropHandlers(overlayTrack, 'overlay');
  let scrubPointer = null;
  function beginScrub(event) {
    if (bridge().exporting || event.button !== 0 || event.target.closest('.mtl-clip,.mtl-transition,[data-mtl-action]')) return;
    if (!event.target.closest('.mtl-track-content') && !event.target.closest('#mtl-ruler-scroll')) return;
    event.preventDefault();
    scrubPointer = event.pointerId;
    try { view.setPointerCapture(event.pointerId); } catch (error) {}
    state.transportPlaying = false;
    bridge().pause?.();
    seekTo(pointerTime(event.clientX), false);
  }
  view.addEventListener('pointerdown', beginScrub);
  byId('mtl-ruler-scroll').addEventListener('pointerdown', beginScrub);
  view.addEventListener('pointermove', (event) => { if (scrubPointer === event.pointerId) seekTo(pointerTime(event.clientX), false); });
  view.addEventListener('pointerup', (event) => { if (scrubPointer === event.pointerId) scrubPointer = null; });
  view.addEventListener('pointercancel', (event) => { if (scrubPointer === event.pointerId) scrubPointer = null; });
  byId('mtl-ruler-scroll').addEventListener('pointermove', (event) => { if (scrubPointer === event.pointerId) seekTo(pointerTime(event.clientX), false); });
  byId('mtl-ruler-scroll').addEventListener('pointerup', (event) => { if (scrubPointer === event.pointerId) scrubPointer = null; });
  view.addEventListener('scroll', () => { byId('mtl-ruler-scroll').scrollLeft = view.scrollLeft; });
  byId('mtl-ruler-scroll').addEventListener('wheel', (event) => { view.scrollLeft += event.deltaX || event.deltaY; }, { passive: true });
  view.addEventListener('click', (event) => { if (event.target === view || event.target === canvas) { state.timelineTime = Math.min(state.projectDuration, pointerTime(event.clientX)); seekTo(state.timelineTime, false); } });

  byId('mtl-add-clip').addEventListener('click', () => byId('mtl-file-input').click());
  byId('mtl-file-input').addEventListener('change', async (event) => { await addFilesToPool(event.target.files); event.target.value = ''; });
  root.querySelector('.mtl-media-heading').addEventListener('dragover', (event) => { event.preventDefault(); });
  root.querySelector('.mtl-media-heading').addEventListener('drop', async (event) => { event.preventDefault(); event.stopPropagation(); await addFilesToPool(event.dataTransfer.files); });
  root.addEventListener('click', (event) => {
    if (bridge().exporting) return;
    const action = event.target.closest('[data-mtl-action]')?.dataset.mtlAction;
    if (action) {
      if (action === 'undo') undo();
      else if (action === 'redo') redo();
      else if (action === 'delete') deleteSelected();
      else if (action === 'cut') splitClip(state.selected, state.timelineTime);
      else if (action === 'zoom-in' || action === 'zoom-out') {
        state.zoom = Math.max(0.5, Math.min(4, state.zoom + (action === 'zoom-in' ? 0.25 : -0.25)));
        state.pixelsPerSecond = 18 * state.zoom; render();
      }
    }
    const transition = event.target.closest('[data-mtl-transition]');
    if (transition) {
      const clip = state.clips.find((item) => item.id === transitionMenu.dataset.clipId);
      if (clip) { remember(); clip.transition = transition.dataset.mtlTransition; render(); }
      hideMenus();
    }
    const context = event.target.closest('[data-mtl-context]');
    if (context) handleContextAction(context.dataset.mtlContext);
    if (!event.target.closest('#mtl-context-menu,#mtl-transition-popover,.mtl-transition')) hideMenus();
  });
  document.addEventListener('pointerdown', (event) => { if (!root.contains(event.target)) hideMenus(); });

  function getMainAt(time) {
    return mainClips().find((clip) => time >= clip.start - 0.0001 && time < clipEnd(clip) - 0.0001) || null;
  }
  async function switchToMain(clip, timelineTime, autoplay = false) {
    if (!clip) return;
    const media = state.media.get(clip.mediaId);
    if (!media || media.type !== 'video') return;
    const switchToken = ++state.switchToken;
    state.activeMain = clip;
    state.inGap = false; state.pendingMain = null; state.switchingSource = true;
    state.timelineTime = Math.max(clip.start, Math.min(clipEnd(clip) - 0.001, timelineTime));
    try {
      await bridge().ensureVideoSource?.(media.src);
      if (switchToken !== state.switchToken || state.activeMain?.id !== clip.id) return;
      state.switchingSource = false;
      bridge().setTimelineTrim?.(clip.trimStart, clip.trimEnd);
      const video = bridge().videoElement;
      if (!video) return;
      const sourceTime = clip.trimStart + (state.timelineTime - clip.start);
      if (Math.abs(video.currentTime - sourceTime) > 0.035) video.currentTime = sourceTime;
      if (autoplay && state.transportPlaying && video.paused) bridge().play?.();
    } catch (error) {
      if (switchToken === state.switchToken) { state.switchingSource = false; state.transportPlaying = false; updateTransportButton(); }
      console.warn('Could not switch timeline clip', error);
    }
    updatePlayhead(); renderOverlayPreview();
  }
  function setGapAt(time, autoplay) {
    state.switchToken++; state.switchingSource = false;
    state.timelineTime = Math.max(0, time);
    state.activeMain = null; state.inGap = true;
    const next = mainClips().find((clip) => clip.start > time + 0.001) || null;
    state.pendingMain = next;
    if (bridge().videoElement && !bridge().videoElement.paused) bridge().pause?.();
    if (!autoplay) state.transportPlaying = false;
    updateTransportButton(); updatePlayhead(); renderOverlayPreview();
  }
  function seekTo(time, autoplay = false) {
    const at = Math.max(0, Math.min(getProjectEnd(), time));
    state.timelineTime = at;
    const clip = getMainAt(at);
    if (clip) switchToMain(clip, at, autoplay);
    else setGapAt(at, autoplay);
    updatePlayhead(); renderOverlayPreview();
  }
  function advanceFrom(clip) {
    const next = mainClips().find((item) => item.start >= clipEnd(clip) - 0.025 && item.id !== clip.id);
    const end = clipEnd(clip);
    if (!next) {
      state.transportPlaying = false;
      state.timelineTime = end;
      bridge().pause?.();
      updateTransportButton(); updatePlayhead();
      return;
    }
    if (next.start > end + 0.025) {
      state.timelineTime = end; state.pendingMain = next; state.inGap = true; state.activeMain = null;
      bridge().pause?.();
      state.lastTick = performance.now();
    } else {
      switchToMain(next, next.start, true);
    }
  }
  function handleVideoTimeUpdate() {
    const video = bridge().videoElement;
    if (!video || bridge().exporting || !state.initialized || !state.activeMain) return;
    const clip = state.activeMain;
    const time = clip.start + (video.currentTime - clip.trimStart);
    state.timelineTime = Math.max(clip.start, Math.min(clipEnd(clip), time));
    if (video.currentTime >= clip.trimEnd - 0.025) advanceFrom(clip);
    updatePlayhead(); renderOverlayPreview();
  }
  function ensureTick() { if (!state.raf) state.raf = requestAnimationFrame(tick); }
  function tick(now) {
    state.raf = 0;
    if (state.transportPlaying && state.inGap) {
      const delta = state.lastTick ? Math.max(0, Math.min(0.12, (now - state.lastTick) / 1000)) : 0;
      state.lastTick = now;
      state.timelineTime += delta * (bridge().videoElement?.playbackRate || 1);
      if (state.pendingMain && state.timelineTime >= state.pendingMain.start) switchToMain(state.pendingMain, state.pendingMain.start, true);
      else if (!state.pendingMain || state.timelineTime >= state.projectDuration) state.transportPlaying = false;
      updateTransportButton(); updatePlayhead(); renderOverlayPreview();
    } else if (state.transportPlaying && state.activeMain && bridge().videoElement?.paused) {
      // Sync a transport pause initiated by the existing video playback button.
      state.transportPlaying = false;
      updateTransportButton();
    }
    if (state.transportPlaying) ensureTick();
  }
  function updateTransportButton() {
    const button = byId('videoPlayBtn');
    if (!button || document.body.dataset.mode !== 'video') return;
    button.textContent = state.transportPlaying ? 'Ⅱ' : '▶';
    button.setAttribute('aria-label', state.transportPlaying ? 'Pause video' : 'Play video');
  }
  function handlePlay() { state.transportPlaying = true; state.inGap = false; state.lastTick = performance.now(); updateTransportButton(); ensureTick(); }
  function handlePause() {
    if (state.switchingSource) return;
    if (!state.inGap) state.transportPlaying = false;
    updateTransportButton();
  }
  function play() {
    if (state.timelineTime >= state.projectDuration - 0.02) state.timelineTime = 0;
    state.transportPlaying = true; updateTransportButton(); ensureTick();
    const clip = getMainAt(state.timelineTime) || mainClips().find((item) => item.start >= state.timelineTime - 0.02);
    if (clip) { state.transportPlaying = true; seekTo(Math.max(clip.start, state.timelineTime), true); }
    else if (mainClips().length) { state.transportPlaying = true; setGapAt(state.timelineTime, true); state.lastTick = performance.now(); }
  }
  function pause() {
    state.switchToken++; state.switchingSource = false;
    state.transportPlaying = false; state.inGap = false;
    if (bridge().videoElement && !bridge().videoElement.paused) bridge().pause?.();
    updateTransportButton();
  }
  byId('videoPlayBtn')?.addEventListener('click', (event) => {
    if (!state.initialized || bridge().exporting || document.body.dataset.mode !== 'video') return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (state.transportPlaying) pause(); else play();
  }, { capture: true });

  function getOverlaysAt(time) {
    return overlayClips().filter((clip) => time >= clip.start && time < clipEnd(clip)).map((clip) => {
      const media = state.media.get(clip.mediaId);
      return media ? { clipId: clip.id, src: media.src, type: media.type, name: media.name, element: media.imageElement || media.videoElement, time: clip.trimStart + (time - clip.start) } : null;
    }).filter(Boolean);
  }
  function setupPreviewLayer() {
    const stage = byId('canvasWrap');
    if (!stage || overlayLayer) return;
    overlayLayer = document.createElement('div');
    overlayLayer.className = 'mtl-preview-overlay'; overlayLayer.hidden = true;
    stage.appendChild(overlayLayer);
  }
  function renderOverlayPreview() {
    setupPreviewLayer();
    if (!overlayLayer) return;
    const active = getOverlaysAt(state.timelineTime);
    const inGap = state.initialized && !getMainAt(state.timelineTime) && state.timelineTime < state.projectDuration;
    const overlaySignature = active.map((item) => item.type === 'video' ? `${item.clipId}:${Math.floor(item.time * 10)}` : item.clipId).join('|');
    const signature = `${inGap ? 'gap:' : ''}${overlaySignature}`;
    if (signature === state.lastOverlaySignature) return;
    state.lastOverlaySignature = signature;
    overlayLayer.querySelectorAll('video').forEach((video) => { video.pause(); video.hidden = true; });
    overlayLayer.replaceChildren();
    overlayLayer.hidden = active.length === 0 && !inGap;
    overlayLayer.style.backgroundColor = inGap ? '#000' : 'transparent';
    for (const item of active) {
      const media = state.media.get(state.clips.find((clip) => clip.id === item.clipId)?.mediaId);
      if (item.type === 'image' && media?.imageElement) {
        const img = document.createElement('img'); img.src = item.src; img.alt = media.name; overlayLayer.appendChild(img);
      } else if (item.type === 'video' && media?.videoElement) {
        const vid = media.videoElement; vid.classList.add('mtl-preview-media'); vid.muted = true; vid.playsInline = true; vid.hidden = false;
        if (Math.abs(vid.currentTime - item.time) > 0.12) { try { vid.currentTime = item.time; } catch (error) {} }
        vid.play().catch(() => {}); overlayLayer.appendChild(vid);
      }
    }
  }
  async function renderOverlays(outputCanvas, time, plan = null) {
    const overlayTime = plan?.toOriginalTime ? plan.toOriginalTime(time) : time;
    const active = getOverlaysAt(overlayTime);
    if (!active.length) return outputCanvas;
    const ctx = outputCanvas.getContext('2d');
    for (const item of active) {
      const media = state.media.get(state.clips.find((clip) => clip.id === item.clipId)?.mediaId);
      if (!media) continue;
      let element = media.imageElement;
      if (media.type === 'video' && media.videoElement) {
        element = media.videoElement;
        try {
          if (Math.abs(element.currentTime - item.time) > 0.02) await seekMediaElement(element, item.time);
        } catch (error) { continue; }
      }
      if (element?.readyState >= 2 || element instanceof HTMLImageElement && element.complete) {
        try {
          const sourceWidth = element.videoWidth || element.naturalWidth || outputCanvas.width;
          const sourceHeight = element.videoHeight || element.naturalHeight || outputCanvas.height;
          const scale = Math.min(outputCanvas.width / sourceWidth, outputCanvas.height / sourceHeight);
          const width = sourceWidth * scale, height = sourceHeight * scale;
          ctx.drawImage(element, (outputCanvas.width - width) / 2, (outputCanvas.height - height) / 2, width, height);
        } catch (error) {}
      }
    }
    return outputCanvas;
  }
  function seekMediaElement(element, time) {
    return new Promise((resolve, reject) => {
      if (Math.abs(element.currentTime - time) < 0.01 && element.readyState >= 2) return resolve();
      const timer = setTimeout(() => finish(new Error('Overlay frame seek timed out')), 8000);
      const finish = (error) => { clearTimeout(timer); element.removeEventListener('seeked', ready); error ? reject(error) : resolve(); };
      const ready = () => finish();
      element.addEventListener('seeked', ready, { once: true });
      element.pause(); element.currentTime = Math.max(0, Math.min(time, (element.duration || time + 0.05) - 0.001));
    });
  }

  function mapOutputTime(outputTime, plan) {
    const t = Math.max(0, Math.min(plan.duration, outputTime));
    const segments = plan.segments;
    const current = segments.find((segment) => t >= segment.start && t < segment.end) || segments[segments.length - 1];
    if (!current) return { sourceTime: 0, blackAlpha: 1, clipIndex: -1, gap: true };
    if (current.gap || current.blackFrame) return { sourceTime: 0, blackAlpha: 1, clipIndex: current.index, gap: true, blackFrame: true };
    const local = Math.max(0, Math.min(current.end - current.start, t - current.start));
    let blackAlpha = 0;
    const transitionSeconds = Math.min(0.5, Math.max(0.05, current.end - current.start), current.next ? Math.max(0.05, current.next.end - current.next.start) : 0.5);
    if (current.transition === 'dissolve' && current.next && t >= current.end - transitionSeconds) {
      const amount = Math.max(0, Math.min(1, (t - (current.end - transitionSeconds)) / transitionSeconds));
      return { sourceTime: current.trimStart + local, source: current.source, blendTime: current.next.trimStart + amount * Math.min(transitionSeconds, current.next.end - current.next.start), blendSource: current.next.source, blend: amount, clipIndex: current.index, blackAlpha: 0 };
    }
    if (current.transition === 'fade-to-black' && t >= current.end - transitionSeconds) blackAlpha = (t - (current.end - transitionSeconds)) / transitionSeconds;
    const previous = segments[current.index - 1];
    if (previous?.transition === 'fade-from-black' && t < current.start + transitionSeconds) blackAlpha = Math.max(blackAlpha, 1 - (t - current.start) / transitionSeconds);
    if (current.blackFrame || current.gap) blackAlpha = 1;
    return { sourceTime: current.trimStart + local, source: current.source, clipIndex: current.index, blackAlpha: Math.max(0, Math.min(1, blackAlpha)), gap: false };
  }
  function getExportPlan(clips = state.clips) {
    const ordered = clips.filter((clip) => clip.track === 'main').slice().sort((a, b) => a.start - b.start);
    if (!ordered.length) return null;
    const originalEnd = Math.max(...clips.map(clipEnd));
    const segments = [];
    let cumulativeDissolve = 0, previousClip = null, previousSegment = null;
    for (const clip of ordered) {
      const media = state.media.get(clip.mediaId);
      if (!media || media.type !== 'video') continue;
      const duration = clipDuration(clip);
      const originalGap = previousClip ? clip.start - clipEnd(previousClip) : clip.start;
      const adjacent = previousClip && originalGap <= 0.025;
      const dissolve = adjacent && previousClip.transition === 'dissolve'
        ? Math.min(0.5, clipDuration(previousClip), duration)
        : 0;
      if (dissolve) cumulativeDissolve += dissolve;
      const start = Math.max(0, clip.start - cumulativeDissolve);
      if (start > (previousSegment?.end || 0) + 0.025) {
        const gapStart = previousSegment?.end || 0;
        segments.push({ start: gapStart, end: start, originalStart: previousClip ? clipEnd(previousClip) : 0, gap: true, blackFrame: true, transition: 'none', index: segments.length });
      }
      const segment = { id: clip.id, clipId: clip.id, mediaId: clip.mediaId, source: media.src, start, end: start + duration, originalStart: clip.start, trimStart: clip.trimStart, trimEnd: clip.trimEnd, transition: clip.transition || 'none', index: segments.length };
      if (dissolve && previousSegment) previousSegment.next = segment;
      segments.push(segment);
      previousClip = clip; previousSegment = segment;
    }
    const duration = Math.max(0.05, originalEnd - cumulativeDissolve);
    if (duration > (previousSegment?.end || 0) + 0.025) {
      segments.push({ start: previousSegment?.end || 0, end: duration, originalStart: previousClip ? clipEnd(previousClip) : 0, gap: true, blackFrame: true, transition: 'none', index: segments.length });
    }
    segments.forEach((segment, index) => { segment.index = index; });
    const toOriginalTime = (outputTime) => {
      const time = Math.max(0, Math.min(duration, outputTime));
      const segment = segments.find((item) => time >= item.start && time < item.end) || segments[segments.length - 1];
      return segment ? segment.originalStart + Math.max(0, time - segment.start) : time;
    };
    return { multiClip: true, duration, transitionSeconds: 0.5, segments, toOriginalTime, overlaysAt: (time) => getOverlaysAt(toOriginalTime(time)) };
  }

  function onVideoEnded() {
    if (state.activeMain) advanceFrom(state.activeMain);
  }
  document.addEventListener('keydown', (event) => {
    if (event.code !== 'Space' || event.repeat || !state.initialized || bridge().exporting) return;
    const target = event.target;
    if (target?.closest('input,textarea,select,[contenteditable="true"],[role="dialog"]')) return;
    if (document.body.dataset.mode !== 'video') return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (state.transportPlaying) pause(); else play();
  }, { capture: true });
  window.addEventListener('resize', () => { if (!root.hidden) render(); });
  function buildExportFrames(clips = state.clips) { return getExportPlan(clips); }
  window.multiTimeline = {
    adoptFirstVideo,
    addMedia: addExternalMedia,
    addClip: addClipFromMedia,
    get clips() { return state.clips.map((clip) => ({ ...clip })); },
    getExportPlan,
    buildExportFrames,
    mapOutputTime,
    renderOverlays,
    seekTo,
    play,
    pause,
    isReady: () => state.initialized,
    hasEdits: () => state.clips.length > 1 || overlayClips().length > 0 || state.clips.some((clip) => clip.start !== 0 || clip.transition !== 'none'),
  };
  window.addEventListener('beforeunload', () => {
    for (const media of state.media.values()) if (media.external) URL.revokeObjectURL(media.src);
  });
})();
