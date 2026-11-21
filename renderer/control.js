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

  const DEFAULT_LABELS = { powerOn: 'Power on', powerOff: 'Power off', mute: 'Mute' };
  const RENAMEABLE = Object.keys(DEFAULT_LABELS);
  const DEFAULT_SOURCES = ['HDMI 1', 'HDMI 2', 'HDMI 3', 'PC', 'Wireless Display', 'USB-C'];
  const DEFAULT_CUSTOM_COUNT = 12;

  const defaultMapping = () => ({
    powerOn: { label: DEFAULT_LABELS.powerOn, ...emptyCommand() },
    powerOff: { label: DEFAULT_LABELS.powerOff, ...emptyCommand() },
    volumeUp: emptyCommand(),
    volumeDown: emptyCommand(),
    mute: { label: DEFAULT_LABELS.mute, ...emptyCommand() },
    volumeSet: emptyCommand(),
    sources: DEFAULT_SOURCES.map((label) => ({ label, ...emptyCommand() })),
    custom: Array.from({ length: DEFAULT_CUSTOM_COUNT }, (_, i) => ({ label: `Button ${i + 1}`, ...emptyCommand() })),
  });

  // Mappings saved by older versions lack newer keys -- fill in anything missing.
  function normalizeMapping(saved) {
    const out = defaultMapping();
    if (!saved) return out;
    SINGLE_KEYS.forEach((k) => { out[k] = { ...out[k], ...(saved[k] || {}) }; });
    RENAMEABLE.forEach((k) => { if (!out[k].label || !out[k].label.trim()) out[k].label = DEFAULT_LABELS[k]; });
    if (Array.isArray(saved.sources)) {
      out.sources = saved.sources.map((s) => ({ label: 'Source', ...emptyCommand(), ...s }));
    }
    if (Array.isArray(saved.custom)) {
      out.custom = saved.custom.map((s) => ({ label: 'Button', ...emptyCommand(), ...s }));
    }
    return out;
  }

  let currentDeviceId = null;
  let currentMapping = defaultMapping();
  let deviceSignature = '';
  let editMode = false;

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
    if (!hasCommand(command)) { showFeedback('No command saved for this button yet', true); return; }
    const result = await window.api.control.trigger(currentDeviceId, command);
    if (result.success) showFeedback(successLabel, false);
    else showFeedback(result.error || 'Send failed', true);
  }

  // A button either sends its command or, in edit mode / when it has no command yet,
  // opens its editor. Right-click always opens the editor.
  // ref: { kind: 'key', key } | { kind: 'sources' | 'custom', index }
  function getCommand(ref) {
    return ref.kind === 'key' ? currentMapping[ref.key] : currentMapping[ref.kind][ref.index];
  }

  function activate(ref, successLabel) {
    if (!currentDeviceId) { showFeedback('Select a device first', true); return; }
    const command = getCommand(ref);
    if (editMode || !hasCommand(command)) { openButtonEditor(ref); return; }
    sendCommand(command, successLabel);
  }

  // ---------- button colours ----------
  const COLORS = [
    ['', 'Default'], ['#2f6df0', 'Blue'], ['#0ea5e9', 'Sky'], ['#14b8a6', 'Teal'], ['#22a35a', 'Green'], ['#eab308', 'Yellow'],
    ['#f97316', 'Orange'], ['#dc2626', 'Red'], ['#db2777', 'Pink'], ['#7c3aed', 'Purple'], ['#64748b', 'Grey'], ['#111827', 'Black'],
  ];
  const validColor = (c) => (/^#[0-9a-f]{6}$/i.test(String(c || '')) ? String(c).toLowerCase() : '');
  // Black or white text, whichever reads better on the chosen colour.
  function textOn(hex) {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    return (1.05) / (lum + 0.05) >= (lum + 0.05) / 0.05 ? '#ffffff' : '#0b1220';
  }
  function colorStyle(command) {
    const c = validColor(command && command.color);
    return c ? `--btn-color:${c};--btn-text:${textOn(c)}` : '';
  }
  function applyColor(el, command) {
    const style = colorStyle(command);
    el.classList.toggle('has-color', !!style);
    el.style.cssText = style;
  }

  // ---------- rendering ----------
  function renderList(kind, wrapId, emptyText, feedback) {
    const wrap = $(wrapId);
    const enabled = !!currentDeviceId;
    const items = currentMapping[kind];
    const buttons = items.map((s, i) => `
      <button type="button" class="btn btn-source ${hasCommand(s) ? '' : 'is-unmapped'} ${colorStyle(s) ? 'has-color' : ''}" style="${colorStyle(s)}" data-index="${i}" title="Right-click to edit" ${enabled ? '' : 'disabled'}>${esc(s.label)}</button>
    `).join('');
    const add = `<button type="button" class="btn btn-ghost btn-add" ${enabled ? '' : 'disabled'}>+ Add button</button>`;
    wrap.innerHTML = (items.length ? buttons : `<p class="empty-hint">${emptyText}</p>`) + add;
    wrap.querySelectorAll('.btn-source').forEach((btn) => {
      const ref = { kind, index: Number(btn.dataset.index) };
      btn.addEventListener('click', () => activate(ref, feedback(currentMapping[kind][ref.index].label)));
      btn.addEventListener('contextmenu', (e) => { e.preventDefault(); if (currentDeviceId) openButtonEditor(ref); });
    });
    wrap.querySelector('.btn-add').addEventListener('click', async () => {
      const label = kind === 'sources' ? `Source ${items.length + 1}` : `Button ${items.length + 1}`;
      items.push({ label, ...emptyCommand() });
      await saveMapping();
      openButtonEditor({ kind, index: items.length - 1 });
    });
  }

  function renderControls() {
    const enabled = !!currentDeviceId;
    Object.entries(BUTTONS).forEach(([id, key]) => {
      const btn = $(id);
      btn.disabled = !enabled;
      btn.classList.toggle('is-unmapped', !hasCommand(currentMapping[key]));
      if (RENAMEABLE.includes(key)) btn.textContent = currentMapping[key].label || DEFAULT_LABELS[key];
      applyColor(btn, currentMapping[key]);
    });
    $('volSlider').disabled = !enabled;
    $('volSlider').classList.toggle('is-unmapped', !hasCommand(currentMapping.volumeSet));
    $('openMappingBtn').disabled = !enabled;
    $('editModeBtn').disabled = !enabled;
    $('editModeBtn').setAttribute('aria-pressed', String(editMode));
    $('editModeBtn').textContent = editMode ? 'Done editing' : 'Edit buttons';
    $('tab-control').classList.toggle('is-editing', editMode);
    $('controlEmpty').classList.toggle('hidden', enabled);
    renderList('sources', 'sourceButtons', 'No sources yet.', (label) => `Switched to ${label}`);
    renderList('custom', 'customButtons', 'No custom buttons yet.', (label) => `${label} sent`);
  }

  async function saveMapping() {
    if (!currentDeviceId) return;
    await window.api.mappings.set(currentDeviceId, currentMapping);
    renderControls();
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
    return `<h3>${title}</h3>${keys.map((k) => `
      ${RENAMEABLE.includes(k) ? `<label class="mapping-name">Button name (${esc(KEY_LABELS[k])})<input type="text" name="${k}_label" value="${esc(draft[k].label || '')}" /></label>` : ''}
      ${commandFields(k, draft[k], `<span class="mapping-label">${esc(KEY_LABELS[k])}</span>`)}`).join('')}`;
  }

  function listHtml(draft, kind, title, noun) {
    return `<h3>${title} <button type="button" class="btn btn-ghost btn-sm add-row" data-kind="${kind}">+ Add ${noun}</button></h3>
      ${draft[kind].map((s, i) => `
        <div class="mapping-row-wrap">
          <label>Button name<input type="text" name="${kind}_${i}_label" value="${esc(s.label)}" /></label>
          ${commandFields(`${kind}_${i}`, s)}
          <button type="button" class="btn btn-ghost btn-sm remove-row" data-kind="${kind}" data-index="${i}">Remove ${noun}</button>
        </div>`).join('')}`;
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
            ${listHtml(draft, 'sources', 'Sources', 'source')}
            ${listHtml(draft, 'custom', 'Custom buttons', 'button')}
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
    SINGLE_KEYS.forEach((k) => {
      draft[k] = { ...draft[k], ...readCommand(form, k) };
      if (RENAMEABLE.includes(k)) draft[k].label = form.elements[`${k}_label`].value.trim() || DEFAULT_LABELS[k];
    });
    ['sources', 'custom'].forEach((kind) => {
      draft[kind].forEach((s, i) => {
        s.label = form.elements[`${kind}_${i}_label`].value.trim() || `${kind === 'sources' ? 'Source' : 'Button'} ${i + 1}`;
        Object.assign(s, readCommand(form, `${kind}_${i}`));
      });
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

    root.querySelectorAll('.add-row').forEach((btn) => {
      btn.addEventListener('click', () => {
        collect(form, draft);
        const kind = btn.dataset.kind;
        draft[kind].push({ label: kind === 'sources' ? 'New source' : 'New button', ...emptyCommand() });
        openMappingModal(draft);
      });
    });
    root.querySelectorAll('.remove-row').forEach((btn) => {
      btn.addEventListener('click', () => {
        collect(form, draft);
        draft[btn.dataset.kind].splice(Number(btn.dataset.index), 1);
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

  // ---------- single-button editor (name + command, saved for the selected device) ----------
  function colorPickerHtml(current) {
    const swatches = COLORS.map(([c, name]) => `<button type="button" class="swatch${c ? '' : ' swatch-default'}" data-color="${c}" title="${name}" aria-label="${name}" aria-pressed="${String(c === current)}"${c ? ` style="background:${c}"` : ''}></button>`).join('');
    return `
      <div class="color-field">
        <span class="color-label">Button colour</span>
        <div class="swatches">${swatches}<label class="swatch-custom" title="Pick any colour"><input type="color" id="colorCustom" value="${current || '#2f6df0'}" aria-label="Custom colour" /><span>Custom</span></label></div>
        <div class="color-preview-row"><span class="dt-hint">Preview</span><button type="button" class="btn btn-source color-preview" id="colorPreview" tabindex="-1"></button></div>
      </div>`;
  }

  function openButtonEditor(ref) {
    if (!currentDeviceId) { showFeedback('Select a device first', true); return; }
    const deviceId = currentDeviceId;
    const command = getCommand(ref);
    const isList = ref.kind !== 'key';
    const canRename = isList || RENAMEABLE.includes(ref.key);
    const device = AppState.devices.find((d) => d.id === deviceId);
    const title = canRename ? (command.label || 'Button') : KEY_LABELS[ref.key];
    const canColor = !(ref.kind === 'key' && ref.key === 'volumeSet');
    const root = $('modalRoot');
    root.innerHTML = `
      <div class="modal-backdrop">
        <div class="modal modal-narrow" role="dialog" aria-label="Edit button">
          <div class="modal-header">
            <h2>Edit button \u2014 ${esc(title)}</h2>
            <button type="button" class="modal-close btn btn-ghost btn-sm">Close</button>
          </div>
          <form id="buttonForm" class="modal-body">
            <p class="dt-hint">Saved for <strong>${esc(device ? device.name : 'this device')}</strong> only. Other devices keep their own names and commands.</p>
            ${canRename ? `<label>Button name<input type="text" name="btn_label" value="${esc(command.label || '')}" maxlength="40" /></label>` : ''}
            ${canColor ? colorPickerHtml(validColor(command.color)) : ''}
            ${commandFields('btn', command)}
            ${ref.kind === 'key' && ref.key === 'volumeSet' ? '<p class="dt-hint">Use <span class="mono">{value}</span> where the slider value (0\u2013100) should go.</p>' : ''}
            <div class="modal-actions modal-actions-split">
              ${isList ? '<button type="button" class="btn btn-ghost" id="buttonRemove">Remove button</button>' : '<span></span>'}
              <button type="submit" class="btn btn-primary">Save</button>
            </div>
          </form>
        </div>
      </div>`;
    document.addEventListener('keydown', onEsc);
    const form = root.querySelector('#buttonForm');
    root.querySelector('.modal-close').addEventListener('click', closeModal);
    root.querySelector('.modal-backdrop').addEventListener('mousedown', (e) => {
      if (e.target.classList.contains('modal-backdrop')) closeModal();
    });
    const first = form.elements.btn_label || form.elements.btn_payload;
    first.focus(); first.select();

    // colour picker: swatches + custom colour, with a live preview of the button
    let chosenColor = canColor ? validColor(command.color) : '';
    const preview = root.querySelector('#colorPreview');
    const showChoice = () => {
      if (!canColor) return;
      root.querySelectorAll('.swatch').forEach((sw) => sw.setAttribute('aria-pressed', String(sw.dataset.color === chosenColor)));
      const name = form.elements.btn_label ? form.elements.btn_label.value.trim() : title;
      preview.textContent = name || title;
      applyColor(preview, { color: chosenColor });
      if (chosenColor) root.querySelector('#colorCustom').value = chosenColor;
    };
    if (canColor) {
      root.querySelectorAll('.swatch').forEach((sw) => sw.addEventListener('click', () => { chosenColor = sw.dataset.color; showChoice(); }));
      root.querySelector('#colorCustom').addEventListener('input', (e) => { chosenColor = validColor(e.target.value); showChoice(); });
      if (form.elements.btn_label) form.elements.btn_label.addEventListener('input', showChoice);
      showChoice();
    }

    if (isList) {
      root.querySelector('#buttonRemove').addEventListener('click', async () => {
        if (deviceId !== currentDeviceId) { closeModal(); return; }
        currentMapping[ref.kind].splice(ref.index, 1);
        await saveMapping();
        closeModal();
        showFeedback('Button removed', false);
      });
    }
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (deviceId !== currentDeviceId) { closeModal(); return; }
      const target = getCommand(ref);
      Object.assign(target, readCommand(form, 'btn'));
      if (canColor) {
        if (chosenColor) target.color = chosenColor; else delete target.color;
      }
      if (canRename) {
        const fallback = isList ? (ref.kind === 'sources' ? `Source ${ref.index + 1}` : `Button ${ref.index + 1}`) : DEFAULT_LABELS[ref.key];
        target.label = form.elements.btn_label.value.trim() || fallback;
      }
      await saveMapping();
      closeModal();
      showFeedback(`Saved for ${device ? device.name : 'this device'}`, false);
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

    // Commands loaded from "Get details" on the Devices page
    document.addEventListener('mappingchanged', (e) => { if (e.detail.deviceId === currentDeviceId) loadMapping(currentDeviceId); });

    $('editModeBtn').addEventListener('click', () => { editMode = !editMode; renderControls(); });

    Object.entries(BUTTONS).forEach(([id, key]) => {
      const ref = { kind: 'key', key };
      const feedback = () => (RENAMEABLE.includes(key) ? `${currentMapping[key].label} sent` : FEEDBACK[key]);
      $(id).addEventListener('click', () => activate(ref, feedback()));
      $(id).addEventListener('contextmenu', (e) => { e.preventDefault(); if (currentDeviceId) openButtonEditor(ref); });
    });
    $('volSlider').addEventListener('contextmenu', (e) => { e.preventDefault(); if (currentDeviceId) openButtonEditor({ kind: 'key', key: 'volumeSet' }); });

    const slider = $('volSlider');
    slider.addEventListener('change', () => {
      const cmd = currentMapping.volumeSet;
      if (editMode || !hasCommand(cmd)) { if (currentDeviceId) openButtonEditor({ kind: 'key', key: 'volumeSet' }); return; }
      sendCommand({ ...cmd, payload: cmd.payload.replace(/\{value\}/g, slider.value) }, `Volume set to ${slider.value}`);
    });
  }

  window.ControlTab = { init };
}());
