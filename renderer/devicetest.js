(function deviceTestTab() {
  const $ = (id) => document.getElementById(id);
  const SELECTION_KEY = 'avcs.deviceTest.selection';
  const KIND_LABEL = { videoinput: 'camera', audioinput: 'microphone', audiooutput: 'speaker' };
  const METER_SEGMENTS = 24;
  const CHIME = [523.25, 659.25, 783.99]; // C5 E5 G5

  const state = {
    ready: false,
    devices: { videoinput: [], audioinput: [], audiooutput: [] },
    camStream: null,
    camId: null,
    micStream: null,
    micId: null,
    micCtx: null,
    micRaf: null,
    micHeard: false,
    recording: false,
    playing: false,
    toneCtx: null,
    playbackUrl: null,
    toastTimer: null,
  };

  // ---------- small helpers ----------
  const onTab = () => $('tab-devicetest').classList.contains('active');
  const isVirtual = (id) => id === 'default' || id === 'communications';

  function loadSelection() {
    try { return JSON.parse(localStorage.getItem(SELECTION_KEY)) || {}; } catch (e) { return {}; }
  }

  function saveSelection() {
    try {
      localStorage.setItem(SELECTION_KEY, JSON.stringify({
        camera: $('dtCamera').value, mic: $('dtMic').value, speaker: $('dtSpeaker').value,
      }));
    } catch (e) { /* storage unavailable -- selection just won't persist */ }
  }

  function setStatus(id, level, text) {
    const el = $(id);
    el.className = `badge badge-${level}`;
    el.querySelector('span').textContent = text;
  }

  function friendlyError(err, what) {
    switch (err && err.name) {
      case 'NotAllowedError':
      case 'SecurityError':
        return `Blocked \u2014 allow ${what} access in Windows Settings \u203A Privacy`;
      case 'NotFoundError':
      case 'OverconstrainedError':
        return 'Device not found';
      case 'NotReadableError':
      case 'AbortError':
        return 'In use by another app';
      default:
        return (err && err.message) || 'Could not start';
    }
  }

  function stopStream(stream) {
    if (stream) stream.getTracks().forEach((t) => t.stop());
  }

  function showToast(text, { action } = {}) {
    $('toastText').textContent = text;
    const btn = $('toastAction');
    btn.classList.toggle('hidden', !(action && !onTab()));
    $('toast').classList.remove('hidden');
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(() => $('toast').classList.add('hidden'), 7000);
  }

  // ---------- device enumeration ----------
  // Device labels are blank until the page has been granted media access once,
  // so grab (and immediately release) a stream to unlock them.
  async function unlockLabels() {
    const attempts = [{ audio: true, video: true }, { audio: true }, { video: true }];
    // eslint-disable-next-line no-restricted-syntax
    for (const constraints of attempts) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        stopStream(stream);
        return true;
      } catch (e) { /* try the next, narrower request */ }
    }
    return false;
  }

  async function enumerate() {
    const list = await navigator.mediaDevices.enumerateDevices();
    const next = { videoinput: [], audioinput: [], audiooutput: [] };
    list.forEach((d) => { if (next[d.kind]) next[d.kind].push(d); });
    return next;
  }

  function fillSelect(select, devices, noun, wantedId) {
    select.innerHTML = '';
    if (!devices.length) {
      const o = document.createElement('option');
      o.value = '';
      o.textContent = `No ${noun} detected`;
      select.appendChild(o);
      select.disabled = true;
      return;
    }
    select.disabled = false;
    devices.forEach((d, i) => {
      const o = document.createElement('option');
      o.value = d.deviceId;
      o.textContent = d.label || `${noun} ${i + 1}`;
      select.appendChild(o);
    });
    if (devices.some((d) => d.deviceId === wantedId)) select.value = wantedId;
  }

  async function refreshDevices() {
    const prev = state.devices;
    const next = await enumerate();
    const saved = loadSelection();
    const keep = state.ready
      ? { camera: $('dtCamera').value, mic: $('dtMic').value, speaker: $('dtSpeaker').value }
      : saved;

    state.devices = next;
    fillSelect($('dtCamera'), next.videoinput, 'camera', keep.camera);
    fillSelect($('dtMic'), next.audioinput, 'microphone', keep.mic);
    fillSelect($('dtSpeaker'), next.audiooutput, 'speaker', keep.speaker);

    const added = [];
    const removed = [];
    if (state.ready) {
      Object.keys(next).forEach((kind) => {
        const prevIds = new Set(prev[kind].map((d) => d.deviceId));
        const nextIds = new Set(next[kind].map((d) => d.deviceId));
        next[kind].filter((d) => !prevIds.has(d.deviceId) && !isVirtual(d.deviceId)).forEach((device) => added.push({ kind, device }));
        prev[kind].filter((d) => !nextIds.has(d.deviceId) && !isVirtual(d.deviceId)).forEach((device) => removed.push({ kind, device }));
      });
    }
    return { added, removed };
  }

  function describe(changes) {
    const seen = new Set();
    const parts = [];
    changes.forEach(({ kind, device }) => {
      const text = `${device.label || KIND_LABEL[kind]} (${KIND_LABEL[kind]})`;
      if (!seen.has(text)) { seen.add(text); parts.push(text); }
    });
    return parts.slice(0, 3).join(', ') + (parts.length > 3 ? ` +${parts.length - 3} more` : '');
  }

  function selectFor(kind) {
    return { videoinput: $('dtCamera'), audioinput: $('dtMic'), audiooutput: $('dtSpeaker') }[kind];
  }

  async function handleDeviceChange() {
    const { added, removed } = await refreshDevices();

    if ($('dtAutoSwitch').checked) {
      added.forEach(({ kind, device }) => { selectFor(kind).value = device.deviceId; });
    }
    saveSelection();

    if (added.length) showToast(`Connected: ${describe(added)}`, { action: true });
    else if (removed.length) showToast(`Disconnected: ${describe(removed)}`);

    if (onTab()) {
      if ($('dtCamera').value !== state.camId) await startCamera();
      if ($('dtMic').value !== state.micId) await startMic();
    }
  }

  // ---------- camera ----------
  function stopCamera() {
    stopStream(state.camStream);
    state.camStream = null;
    state.camId = null;
    $('dtVideo').srcObject = null;
    $('dtVideoEmpty').classList.remove('hidden');
    $('dtCamInfo').textContent = '\u2014';
    $('dtCamToggle').textContent = 'Start camera';
  }

  async function startCamera() {
    stopCamera();
    const id = $('dtCamera').value;
    if (!id) {
      $('dtVideoEmpty').textContent = 'Plug in a USB camera';
      setStatus('dtCamStatus', 'warn', 'No camera detected');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { deviceId: { exact: id }, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      state.camStream = stream;
      state.camId = id;
      const track = stream.getVideoTracks()[0];
      track.addEventListener('ended', () => {
        if (state.camStream === stream) {
          stopCamera();
          setStatus('dtCamStatus', 'warn', 'Camera disconnected');
        }
      });
      $('dtVideo').srcObject = stream;
      $('dtVideoEmpty').classList.add('hidden');
      const s = track.getSettings();
      $('dtCamInfo').textContent = `${s.width || '?'}\u00D7${s.height || '?'} @ ${Math.round(s.frameRate || 0)} fps`;
      $('dtCamToggle').textContent = 'Stop camera';
      setStatus('dtCamStatus', 'ok', 'Working');
      saveSelection();
    } catch (err) {
      $('dtVideoEmpty').textContent = 'No camera preview';
      setStatus('dtCamStatus', 'error', friendlyError(err, 'camera'));
    }
  }

  // ---------- microphone ----------
  function buildMeter() {
    const meter = $('dtMeter');
    meter.innerHTML = '';
    for (let i = 0; i < METER_SEGMENTS; i += 1) {
      const seg = document.createElement('i');
      seg.className = i < 16 ? 'seg-g' : (i < 21 ? 'seg-a' : 'seg-r');
      meter.appendChild(seg);
    }
  }

  function paintMeter(level) {
    const lit = Math.round(level * METER_SEGMENTS);
    const segs = $('dtMeter').children;
    for (let i = 0; i < segs.length; i += 1) segs[i].classList.toggle('on', i < lit);
  }

  function stopMic() {
    cancelAnimationFrame(state.micRaf);
    stopStream(state.micStream);
    if (state.micCtx) state.micCtx.close().catch(() => {});
    state.micStream = null;
    state.micCtx = null;
    state.micId = null;
    paintMeter(0);
  }

  async function startMic() {
    stopMic();
    const id = $('dtMic').value;
    if (!id) {
      setStatus('dtMicStatus', 'warn', 'No microphone detected');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: { exact: id }, echoCancellation: false, noiseSuppression: false, autoGainControl: false,
        },
        video: false,
      });
      state.micStream = stream;
      state.micId = id;
      state.micHeard = false;

      const ctx = new AudioContext();
      state.micCtx = ctx;
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      ctx.createMediaStreamSource(stream).connect(analyser);
      const data = new Uint8Array(analyser.fftSize);
      const startedAt = performance.now();
      let warned = false;

      setStatus('dtMicStatus', 'idle', 'Listening\u2026');

      const tick = () => {
        analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i += 1) {
          const v = (data[i] - 128) / 128;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / data.length);
        const db = 20 * Math.log10(Math.max(rms, 1e-5));
        paintMeter(Math.min(1, Math.max(0, (db + 60) / 60)));

        if (rms > 0.02 && !state.micHeard) {
          state.micHeard = true;
          setStatus('dtMicStatus', 'ok', 'Picking up sound');
        } else if (!state.micHeard && !warned && performance.now() - startedAt > 6000) {
          warned = true;
          setStatus('dtMicStatus', 'warn', 'Quiet \u2014 speak, or check mute / volume');
        }
        state.micRaf = requestAnimationFrame(tick);
      };
      tick();
      saveSelection();
    } catch (err) {
      setStatus('dtMicStatus', 'error', friendlyError(err, 'microphone'));
    }
  }

  async function applySink(el) {
    const id = $('dtSpeaker').value;
    if (!id || typeof el.setSinkId !== 'function') return true;
    try {
      await el.setSinkId(id);
      return true;
    } catch (e) {
      setStatus('dtSpkStatus', 'error', 'Could not use this speaker');
      return false;
    }
  }

  async function recordAndPlayBack() {
    if (state.recording) return;
    if (!state.micStream) await startMic();
    if (!state.micStream) return;

    const btn = $('dtRecord');
    state.recording = true;
    btn.disabled = true;

    const chunks = [];
    const recorder = new MediaRecorder(state.micStream);
    recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };

    let remaining = 5;
    btn.textContent = `Recording\u2026 ${remaining}s`;
    const countdown = setInterval(() => {
      remaining -= 1;
      if (remaining > 0) btn.textContent = `Recording\u2026 ${remaining}s`;
    }, 1000);

    const finish = () => {
      state.recording = false;
      btn.disabled = false;
      btn.textContent = 'Record 5 s & play back';
    };

    recorder.onstop = async () => {
      clearInterval(countdown);
      if (state.playbackUrl) URL.revokeObjectURL(state.playbackUrl);
      state.playbackUrl = URL.createObjectURL(new Blob(chunks, { type: recorder.mimeType || 'audio/webm' }));
      const audio = $('dtPlayback');
      audio.src = state.playbackUrl;
      btn.textContent = 'Playing back\u2026';
      await applySink(audio);
      audio.onended = finish;
      audio.onerror = finish;
      try { await audio.play(); } catch (e) { finish(); }
    };

    recorder.start();
    setTimeout(() => { if (recorder.state !== 'inactive') recorder.stop(); }, 5000);
  }

  // ---------- speaker ----------
  function setSpeakerButtons(disabled) {
    ['dtPlayTone', 'dtPlayLeft', 'dtPlayRight'].forEach((id) => { $(id).disabled = disabled; });
  }

  function cleanupTone() {
    const el = $('dtTone');
    el.pause();
    el.srcObject = null;
    if (state.toneCtx) state.toneCtx.close().catch(() => {});
    state.toneCtx = null;
    state.playing = false;
    setSpeakerButtons(false);
  }

  async function playChime(pan) {
    if (state.playing) return;
    if (!$('dtSpeaker').value) {
      setStatus('dtSpkStatus', 'warn', 'No speaker detected');
      return;
    }
    state.playing = true;
    setSpeakerButtons(true);

    const ctx = new AudioContext();
    state.toneCtx = ctx;
    const dest = ctx.createMediaStreamDestination();
    const master = ctx.createGain();
    master.gain.value = Number($('dtVolume').value) / 100;
    const panner = ctx.createStereoPanner();
    panner.pan.value = pan;
    master.connect(panner);
    panner.connect(dest);

    const start = ctx.currentTime + 0.05;
    CHIME.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const env = ctx.createGain();
      const t = start + i * 0.3;
      env.gain.setValueAtTime(0.0001, t);
      env.gain.linearRampToValueAtTime(1, t + 0.03);
      env.gain.exponentialRampToValueAtTime(0.001, t + 0.28);
      osc.connect(env);
      env.connect(master);
      osc.start(t);
      osc.stop(t + 0.3);
    });

    const el = $('dtTone');
    el.srcObject = dest.stream;
    if (!(await applySink(el))) { cleanupTone(); return; }
    try {
      await el.play();
    } catch (e) {
      setStatus('dtSpkStatus', 'error', 'Playback failed');
      cleanupTone();
      return;
    }
    setStatus('dtSpkStatus', 'idle', 'Playing\u2026');

    setTimeout(() => {
      cleanupTone();
      setStatus('dtSpkStatus', 'idle', 'Test sound played');
    }, (CHIME.length * 0.3 + 0.25) * 1000);
  }

  // ---------- tab lifecycle ----------
  function leaveTab() {
    stopCamera();
    stopMic();
    $('dtPlayback').pause();
    if (state.playing) cleanupTone();
    setStatus('dtCamStatus', 'idle', 'Not started');
    setStatus('dtMicStatus', 'idle', 'Not started');
  }

  async function enterTab() {
    if (!state.ready) return;
    await refreshDevices();
    await startCamera();
    await startMic();
  }

  async function init() {
    if (!navigator.mediaDevices) {
      document.querySelector('#tab-devicetest .tab-sub').textContent = 'Media devices are not available in this environment.';
      return;
    }
    buildMeter();

    $('dtCamera').addEventListener('change', () => { saveSelection(); if (onTab()) startCamera(); });
    $('dtMic').addEventListener('change', () => { saveSelection(); if (onTab()) startMic(); });
    $('dtSpeaker').addEventListener('change', () => {
      saveSelection();
      setStatus('dtSpkStatus', 'idle', 'Not tested');
    });

    $('dtCamToggle').addEventListener('click', () => {
      if (state.camStream) { stopCamera(); setStatus('dtCamStatus', 'idle', 'Stopped'); } else startCamera();
    });
    $('dtRecord').addEventListener('click', recordAndPlayBack);
    $('dtPlayTone').addEventListener('click', () => playChime(0));
    $('dtPlayLeft').addEventListener('click', () => playChime(-1));
    $('dtPlayRight').addEventListener('click', () => playChime(1));
    $('dtRescan').addEventListener('click', async () => {
      await unlockLabels();
      await refreshDevices();
      if (onTab()) { await startCamera(); await startMic(); }
    });
    $('toastAction').addEventListener('click', () => {
      $('toast').classList.add('hidden');
      switchTab('devicetest');
    });

    document.addEventListener('tabchange', (e) => {
      if (e.detail.tabId === 'devicetest') enterTab(); else leaveTab();
    });

    await unlockLabels();
    await refreshDevices();
    state.ready = true;
    navigator.mediaDevices.addEventListener('devicechange', handleDeviceChange);
  }

  window.DeviceTestTab = { init };
}());
