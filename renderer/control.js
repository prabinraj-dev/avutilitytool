(function controlTab() {
  const $ = (id) => document.getElementById(id);

  const emptyCommand = () => ({
    payload: '', encoding: 'ascii', delimiter: 'crlf', delimiterCustom: '', delimiterEncoding: 'text',
  });
  const SINGLE_KEYS = ['powerOn', 'powerOff', 'volumeUp', 'volumeDown', 'mute', 'volumeSet'];
  const KEY_LABELS = {
    powerOn: 'Power on',
    powerOff: 'Power off',
    volumeUp: 'Volume up',
    volumeDown: 'Volume down',
    mute: 'Mute toggle',
    volumeSet: 'Volume set from slider \u2014 use {value} in the payload',
  };
  // static button id -> mapping key
  const BUTTONS = {
    powerOnBtn: 'powerOn', powerOffBtn: 'powerOff', volUpBtn: 'volumeUp', volDownBtn: 'volumeDown', muteBtn: 'mute',
  };
  const FEEDBACK = {
    powerOn: 'Power on sent', powerOff: 'Power off sent', volumeUp: 'Volume up sent', volumeDown: 'Volume down sent', mute: 'Mute sent',
  };

  const defaultMapping = () => ({
    powerOn: emptyCommand(),
    powerOff: emptyCommand(),
    volumeUp: emptyCommand(),
    volumeDown: emptyCommand(),
    mute: emptyCommand(),
    volumeSet: emptyCommand(),
    sources: ['HDMI 1', 'HDMI 2', 'PC', 'Wireless Display'].map((label) => ({ label, ...emptyCommand() })),
  });

  // Mappings saved by older versions lack the power keys -- fill in anything missing.
  function normalizeMapping(saved) {
    const out = defaultMapping();
    if (!saved) return out;
    SINGLE_KEYS.forEach((k) => { out[k] = { ...emptyCommand(), ...(saved[k] || {}) }; });
    if (Array.isArray(saved.sources)) {
      out.sources = saved.sources.map((s) => ({ label: 'Source', ...emptyCommand(), ...s }));
    }
    return out;
  }

  let currentDeviceId = null;
  let currentMapping = defaultMapping();
  let deviceSignature = '';

  const hasCommand = (cmd) => !!(cmd && cmd.payload && cmd.payload.trim());

  function showFeedback(message, isError) {
    const el = $('controlFeedback');
    el.textContent = message;
    el.className = `control-feedback ${isError ? 'is-error' : 'is-ok'} show`;
    clearTimeout(showFeedback.timer);
    showFeedback.timer = setTimeout(() => el.classList.remove('show'), 2600);
  }

  async function sendCommand(command, successLabel) {
    if (!currentDeviceId) { showFeedback('Select a device first', true); return; }
    if (!hasCommand(command)) { showFeedback('No command mapped to this button yet \u2014 open \u201CEdit command mapping\u201D', true); return; }
    const result = await window.api.control.trigger(currentDeviceId, command);
    if (result.success) showFeedback(successLabel, false);
    else showFeedback(result.error || 'Send failed', true);
  }

  // ---------- rendering ----------
  function renderSourceButtons() {
    const wrap = $('sourceButtons');
    const enabled = !!currentDeviceId;
    if (!currentMapping.sources.length) {
      wrap.innerHTML = '<p class="empty-hint">No sources yet. Use \u201CEdit command mapping\u201D to add some.</p>';
      return;
    }
    wrap.innerHTML = currentMapping.sources.map((s, i) => `
      <button type="button" class="btn btn-source ${hasCommand(s) ? '' : 'is-unmapped'}" data-index="${i}" ${enabled ? '' : 'disabled'}>${esc(s.label)}</button>
    `).join('');
    wrap.querySelectorAll('.btn-source').forEach((btn) => {
      btn.addEventListener('click', () => {
        const source = currentMapping.sources[Number(btn.dataset.index)];
        sendCommand(source, `Switched to ${source.label}`);
      });
    });
  }

  function renderControls() {
    const enabled = !!currentDeviceId;
    Object.entries(BUTTONS).forEach(([id, key]) => {
      const btn = $(id);
      btn.disabled = !enabled;
      btn.classList.toggle('is-unmapped', !hasCommand(currentMapping[key]));
    });
    $('volSlider').disabled = !enabled;
    $('volSlider').classList.toggle('is-unmapped', !hasCommand(currentMapping.volumeSet));
    $('openMappingBtn').disabled = !enabled;
    $('controlEmpty').classList.toggle('hidden', enabled);
    renderSourceButtons();
  }

  function updateStatusBadge(devices) {
    const badge = $('controlStatus');
    const device = devices.find((d) => d.id === currentDeviceId);
    const levels = {
      online: ['ok', 'Online'], unresponsive: ['warn', 'Unresponsive'], offline: ['error', 'Offline'],
    };
    const [level, text] = !device ? ['idle', 'No device'] : (levels[device.status] || ['idle', 'Checking\u2026']);
    badge.className = `badge badge-${level}`;
    badge.querySelector('span').textContent = text;
  }

  // ---------- device list + mapping loading ----------
  async function loadMapping(deviceId) {
    currentDeviceId = deviceId;
    currentMapping = defaultMapping();
    renderControls(); // show the layout immediately
    if (!deviceId) return;
    const saved = await window.api.mappings.get(deviceId);
    if (deviceId !== currentDeviceId) return; // user switched while loading
    currentMapping = normalizeMapping(saved);
    renderControls();
  }

  function syncDevices(devices) {
    const select = $('controlDevice');
    // Only rebuild the dropdown when the list really changed, so a heartbeat
    // status tick never closes a dropdown the user has open.
    const signature = devices.map((d) => `${d.id}|${d.name}|${d.ip}|${d.port}`).join(';');
    if (signature !== deviceSignature) {
      deviceSignature = signature;
      select.innerHTML = '';
      if (!devices.length) {
        select.innerHTML = '<option value="">No devices yet</option>';
        select.disabled = true;
      } else {
        select.disabled = false;
        devices.forEach((d) => {
          const o = document.createElement('option');
          o.value = d.id;
          o.textContent = `${d.name} (${d.ip}:${d.port})`;
          select.appendChild(o);
        });
        if (devices.some((d) => d.id === currentDeviceId)) select.value = currentDeviceId;
      }
    }
    const id = select.value || null;
    if (id !== currentDeviceId) loadMapping(id);
    updateStatusBadge(devices);
  }

  // ---------- mapping editor ----------
  function commandFields(prefix, command, labelHtml) {
    const opt = (value, label, current) => `<option value="${value}" ${current === value ? 'selected' : ''}>${label}</option>`;
    return `
      <div class="mapping-row">
        ${labelHtml || ''}
        <label>Payload<input type="text" name="${prefix}_payload" value="${esc(command.payload)}" /></label>
        <label>Encoding
          <select name="${prefix}_encoding">
            ${opt('ascii', 'ASCII', command.encoding)}${opt('utf8', 'UTF-8', command.encoding)}${opt('hex', 'Hex', command.encoding)}
          </select>
        </label>
        <label>Delimiter
          <select name="${prefix}_delimiter">
            ${opt('none', 'None', command.delimiter)}${opt('cr', 'CR', command.delimiter)}${opt('lf', 'LF', command.delimiter)}${opt('crlf', 'CRLF', command.delimiter)}${opt('custom', 'Custom', command.delimiter)}
          </select>
        </label>
        <label>Custom delimiter<input type="text" name="${prefix}_delimiterCustom" value="${esc(command.delimiterCustom)}" /></label>
        <label>Custom is
          <select name="${prefix}_delimiterEncoding">
            ${opt('text', 'Text', command.delimiterEncoding)}${opt('hex', 'Hex', command.delimiterEncoding)}
          </select>
        </label>
      </div>`;
  }

  function groupHtml(draft, keys, title) {
    return `<h3>${title}</h3>${keys.map((k) => commandFields(k, draft[k], `<span class="mapping-label">${esc(KEY_LABELS[k])}</span>`)).join('')}`;
  }

  function buildModalHtml(draft) {
    return `
      <div class="modal-backdrop">
        <div class="modal" role="dialog" aria-label="Command mapping">
          <div class="modal-header">
            <h2>Command mapping</h2>
            <button type="button" class="modal-close btn btn-ghost btn-sm">Close</button>
          </div>
          <form id="mappingForm" class="modal-body">
            ${groupHtml(draft, ['powerOn', 'powerOff'], 'Power')}
            ${groupHtml(draft, ['volumeUp', 'volumeDown', 'mute', 'volumeSet'], 'Volume &amp; mute')}
            <h3>Sources <button type="button" id="addSourceRow" class="btn btn-ghost btn-sm">+ Add source</button></h3>
            ${draft.sources.map((s, i) => `
              <div class="mapping-row-wrap">
                <label>Button label<input type="text" name="source_${i}_label" value="${esc(s.label)}" /></label>
                ${commandFields(`source_${i}`, s)}
                <button type="button" class="btn btn-ghost btn-sm remove-source" data-index="${i}">Remove source</button>
              </div>`).join('')}
            <div class="modal-actions"><button type="submit" class="btn btn-primary">Save mapping</button></div>
          </form>
        </div>
      </div>`;
  }

  function readCommand(form, prefix) {
    return {
      payload: form.elements[`${prefix}_payload`].value,
      encoding: form.elements[`${prefix}_encoding`].value,
      delimiter: form.elements[`${prefix}_delimiter`].value,
      delimiterCustom: form.elements[`${prefix}_delimiterCustom`].value,
      delimiterEncoding: form.elements[`${prefix}_delimiterEncoding`].value,
    };
  }

  // Copies what's typed in the form into the draft (so adding/removing a row
  // never throws away edits you haven't saved yet).
  function collect(form, draft) {
    SINGLE_KEYS.forEach((k) => { draft[k] = readCommand(form, k); });
    draft.sources.forEach((s, i) => {
      s.label = form.elements[`source_${i}_label`].value || `Source ${i + 1}`;
      Object.assign(s, readCommand(form, `source_${i}`));
    });
  }

  function closeModal() {
    $('modalRoot').innerHTML = '';
    document.removeEventListener('keydown', onEsc);
  }
  function onEsc(e) { if (e.key === 'Escape') closeModal(); }

  function openMappingModal(existingDraft) {
    if (!currentDeviceId) { showFeedback('Select a device first', true); return; }
    const draft = existingDraft || JSON.parse(JSON.stringify(currentMapping));
    const root = $('modalRoot');
    root.innerHTML = buildModalHtml(draft);
    document.addEventListener('keydown', onEsc);

    const form = root.querySelector('#mappingForm');
    root.querySelector('.modal-close').addEventListener('click', closeModal);
    root.querySelector('.modal-backdrop').addEventListener('mousedown', (e) => {
      if (e.target.classList.contains('modal-backdrop')) closeModal();
    });

    root.querySelector('#addSourceRow').addEventListener('click', () => {
      collect(form, draft);
      draft.sources.push({ label: 'New source', ...emptyCommand() });
      openMappingModal(draft);
    });
    root.querySelectorAll('.remove-source').forEach((btn) => {
      btn.addEventListener('click', () => {
        collect(form, draft);
        draft.sources.splice(Number(btn.dataset.index), 1);
        openMappingModal(draft);
      });
    });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      collect(form, draft);
      await window.api.mappings.set(currentDeviceId, draft);
      currentMapping = draft;
      renderControls();
      closeModal();
      showFeedback('Mapping saved', false);
    });
  }

  // ---------- init ----------
  function init() {
    AppState.onDevicesChange(syncDevices);
    syncDevices(AppState.devices);
    renderControls();

    $('controlDevice').addEventListener('change', () => {
      loadMapping($('controlDevice').value || null);
      updateStatusBadge(AppState.devices);
    });
    $('openMappingBtn').addEventListener('click', () => openMappingModal());

    Object.entries(BUTTONS).forEach(([id, key]) => {
      $(id).addEventListener('click', () => sendCommand(currentMapping[key], FEEDBACK[key]));
    });

    const slider = $('volSlider');
    slider.addEventListener('change', () => {
      const cmd = currentMapping.volumeSet;
      if (!hasCommand(cmd)) { showFeedback('No volume-set command mapped yet', true); return; }
      sendCommand({ ...cmd, payload: cmd.payload.replace(/\{value\}/g, slider.value) }, `Volume set to ${slider.value}`);
    });
  }

  window.ControlTab = { init };
}());
