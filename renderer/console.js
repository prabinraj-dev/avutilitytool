(function consoleTab() {
  const $ = (id) => document.getElementById(id);
  const PREF_KEY = 'avcs.console';

  const state = {
    mode: 'tcp',
    open: false,
    busy: false,
    serialPorts: [],
  };

  // ---------- remembered settings (per-viewer convenience only) ----------
  function loadPrefs() {
    try { return JSON.parse(localStorage.getItem(PREF_KEY)) || {}; } catch (e) { return {}; }
  }
  function savePrefs() {
    const prefs = {
      mode: state.mode,
      ip: $('linkIp').value,
      port: $('linkPort').value,
      localPort: $('linkLocalPort').value,
      broadcast: $('linkBroadcast').checked,
      baud: $('serialBaud').value,
      data: $('serialData').value,
      parity: $('serialParity').value,
      stop: $('serialStop').value,
      flow: $('serialFlow').value,
      serialPath: $('serialPath').value,
      delimiter: $('consoleDelimiter').value,
      delimiterCustom: $('consoleDelimiterCustom').value,
      delimiterEncoding: $('consoleDelimiterEncoding').value,
      lines: Array.from(document.querySelectorAll('.send-line')).map((row) => ({
        text: row.querySelector('.send-input').value,
        hex: row.querySelector('.send-hex').checked,
      })),
    };
    try { localStorage.setItem(PREF_KEY, JSON.stringify(prefs)); } catch (e) { /* not persisted */ }
  }

  // ---------- log ----------
  function appendLog({
    direction, hex, ascii, timestamp, error, from, text,
  }) {
    const log = $('consoleLog');
    const entry = document.createElement('div');
    const time = new Date(timestamp || Date.now()).toLocaleTimeString([], { hour12: false });
    const dir = { out: '→ TX', in: '← RX', sys: '•' }[direction] || '';
    entry.className = `log-entry log-${direction}${error ? ' log-error' : ''}`;
    if (direction === 'sys') {
      entry.innerHTML = `<span class="log-time">${time}</span><span class="log-dir">${dir}</span><span class="log-hex">${esc(text)}</span>`;
    } else if (error) {
      entry.innerHTML = `<span class="log-time">${time}</span><span class="log-dir">${dir}</span><span class="log-error-text">${esc(error)}</span>`;
    } else {
      entry.innerHTML = `<span class="log-time">${time}</span><span class="log-dir">${dir}</span>`
        + `<span class="log-hex">${esc(hex) || '(empty)'}</span><span class="log-ascii">${esc(ascii)}</span>`
        + (from ? `<span class="log-from">from ${esc(from)}</span>` : '');
    }
    log.appendChild(entry);
    while (log.childElementCount > 2000) log.removeChild(log.firstChild); // keep the page light
    if ($('autoScroll').checked) log.scrollTop = log.scrollHeight;
  }

  // ---------- device / port dropdown ----------
  let dropdownSignature = '';
  function renderDeviceSelect() {
    const select = $('consoleDevice');
    const devices = AppState.devices;
    const signature = JSON.stringify([devices.map((d) => [d.id, d.name, d.ip, d.port, d.protocol]), state.serialPorts]);
    if (signature === dropdownSignature) return; // don't close an open dropdown on heartbeat ticks
    dropdownSignature = signature;

    const previous = select.value;
    const deviceOptions = devices.map((d) => `<option value="dev:${esc(d.id)}">${esc(d.name)} — ${esc(d.protocol.toUpperCase())} ${esc(d.ip)}:${esc(d.port)}</option>`).join('');
    const serialOptions = state.serialPorts.map((p) => `<option value="ser:${esc(p.path)}">${esc(p.path)}${p.description ? ` — ${esc(p.description)}` : ''}</option>`).join('');
    select.innerHTML = '<option value="manual">Manual entry…</option>'
      + (deviceOptions ? `<optgroup label="Saved devices (TCP / UDP)">${deviceOptions}</optgroup>` : '')
      + (serialOptions ? `<optgroup label="Serial ports (USB / COM)">${serialOptions}</optgroup>` : '');
    if ([...select.options].some((o) => o.value === previous)) select.value = previous;
  }

  function fillSerialPaths() {
    const select = $('serialPath');
    const previous = select.value || loadPrefs().serialPath;
    select.innerHTML = state.serialPorts.length
      ? state.serialPorts.map((p) => `<option value="${esc(p.path)}">${esc(p.path)}${p.description ? ` — ${esc(p.description)}` : ''}</option>`).join('')
      : '<option value="">No COM ports found</option>';
    if (state.serialPorts.some((p) => p.path === previous)) select.value = previous;
  }

  async function rescan() {
    state.serialPorts = await window.api.link.serialList();
    fillSerialPaths();
    renderDeviceSelect();
  }

  function applyDeviceChoice(value) {
    if (value.startsWith('dev:')) {
      const device = AppState.devices.find((d) => d.id === value.slice(4));
      if (!device) return;
      setMode(device.protocol === 'udp' ? 'udp' : 'tcp');
      $('linkIp').value = device.ip;
      $('linkPort').value = device.port;
    } else if (value.startsWith('ser:')) {
      setMode('serial');
      $('serialPath').value = value.slice(4);
    }
    savePrefs();
  }

  // ---------- mode (TCP / UDP / Serial) ----------
  function setMode(mode) {
    state.mode = mode;
    document.querySelectorAll('#linkModes .seg-btn').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === mode)));
    document.querySelectorAll('#tab-console .link-group').forEach((group) => {
      group.classList.toggle('hidden', !group.dataset.for.split(' ').includes(mode));
    });
    $('linkBroadcast').closest('label').classList.toggle('hidden', mode !== 'udp');
    if (mode === 'udp' && !$('linkPort').value) $('linkPort').placeholder = '5001';
    updateHint();
  }

  function updateHint() {
    const hints = {
      tcp: 'Opens a TCP connection and keeps it open, so replies and unsolicited messages from the device show up as they arrive.',
      udp: 'Sends datagrams to the module IP and port, and listens on the local port for replies.',
      serial: 'Opens the COM port with the settings above. Close it here before using it in another program.',
    };
    $('linkHint').textContent = state.open ? '' : hints[state.mode];
  }

  // ---------- connect / disconnect ----------
  function currentConfig() {
    if (state.mode === 'serial') {
      return {
        kind: 'serial',
        path: $('serialPath').value,
        baudRate: $('serialBaud').value,
        dataBits: $('serialData').value,
        parity: $('serialParity').value,
        stopBits: $('serialStop').value,
        handshake: $('serialFlow').value,
      };
    }
    return {
      kind: state.mode,
      ip: $('linkIp').value.trim(),
      port: $('linkPort').value,
      localPort: $('linkLocalPort').value,
      broadcast: state.mode === 'udp' && $('linkBroadcast').checked,
    };
  }

  const BADGE = {
    open: ['ok', 'Connected'],
    opening: ['idle', 'Connecting…'],
    closed: ['idle', 'Disconnected'],
  };

  function renderStatus(st) {
    const wasOpen = state.open;
    state.open = st.state === 'open';
    state.busy = st.state === 'opening';
    const [level, text] = BADGE[st.state] || BADGE.closed;
    const badge = $('linkBadge');
    badge.className = `badge badge-${st.error && st.state === 'closed' ? 'error' : level}`;
    badge.querySelector('span').textContent = st.error && st.state === 'closed' ? 'Failed' : text;
    badge.title = st.label || st.error || '';

    $('linkToggleBtn').textContent = state.open ? 'Disconnect' : (state.busy ? 'Connecting…' : 'Connect');
    $('linkToggleBtn').disabled = state.busy;
    $('linkToggleBtn').classList.toggle('btn-primary', !state.open);
    $('linkToggleBtn').classList.toggle('btn-secondary', state.open);
    $('linkFields').disabled = state.open || state.busy;
    $('consoleDevice').disabled = state.open || state.busy;
    $('consoleRescan').disabled = state.open || state.busy;
    document.querySelectorAll('#linkModes .seg-btn').forEach((b) => { b.disabled = state.open || state.busy; });
    document.querySelectorAll('.send-btn').forEach((b) => { b.disabled = !state.open; });
    $('lineDtr').disabled = !(state.open && st.kind === 'serial');
    $('lineRts').disabled = !(state.open && st.kind === 'serial');
    if (!state.open) { $('lineDtr').checked = false; $('lineRts').checked = false; }

    const lines = st.lines || {};
    ['cd', 'ri', 'dsr', 'cts'].forEach((k) => {
      document.querySelector(`[data-led="${k}"]`).classList.toggle('on', !!lines[k]);
    });
    updateHint();

    if (state.open && !wasOpen) appendLog({ direction: 'sys', text: `Connected — ${st.label}` });
    if (!state.open && wasOpen) appendLog({ direction: 'sys', text: st.error ? `Disconnected — ${st.error}` : 'Disconnected' });
    if (!state.open && !wasOpen && st.error) appendLog({ direction: 'sys', text: `Could not connect — ${st.error}` });
  }

  async function toggleConnection() {
    if (state.busy) return;
    if (state.open) {
      await window.api.link.close();
      return;
    }
    savePrefs();
    await window.api.link.open(currentConfig()); // status events update the UI
  }

  // ---------- sending ----------
  async function sendLine(row) {
    const text = row.querySelector('.send-input').value;
    if (!text.trim()) return;
    const isHex = row.querySelector('.send-hex').checked;
    const params = {
      payload: text,
      encoding: isHex ? 'hex' : 'ascii',
      delimiter: isHex ? 'none' : $('consoleDelimiter').value,
      delimiterCustom: $('consoleDelimiterCustom').value,
      delimiterEncoding: $('consoleDelimiterEncoding').value,
    };
    const result = await window.api.link.send(params);
    appendLog({
      direction: 'out',
      hex: result.sentHex,
      ascii: result.sentAscii,
      timestamp: result.timestamp,
      error: result.success ? null : result.error,
    });
    savePrefs();
  }

  function init() {
    const prefs = loadPrefs();

    // restore remembered values
    if (prefs.ip != null) $('linkIp').value = prefs.ip;
    if (prefs.port != null) $('linkPort').value = prefs.port;
    if (prefs.localPort != null) $('linkLocalPort').value = prefs.localPort;
    $('linkBroadcast').checked = !!prefs.broadcast;
    [['serialBaud', 'baud'], ['serialData', 'data'], ['serialParity', 'parity'], ['serialStop', 'stop'], ['serialFlow', 'flow'],
      ['consoleDelimiter', 'delimiter'], ['consoleDelimiterEncoding', 'delimiterEncoding']].forEach(([id, key]) => {
      if (prefs[key] != null && [...$(id).options].some((o) => o.value === String(prefs[key]))) $(id).value = prefs[key];
    });
    if (prefs.delimiterCustom != null) $('consoleDelimiterCustom').value = prefs.delimiterCustom;
    $('customDelimiterRow').classList.toggle('hidden', $('consoleDelimiter').value !== 'custom');
    document.querySelectorAll('.send-line').forEach((row, i) => {
      const saved = (prefs.lines || [])[i];
      if (saved) { row.querySelector('.send-input').value = saved.text || ''; row.querySelector('.send-hex').checked = !!saved.hex; }
    });
    setMode(['tcp', 'udp', 'serial'].includes(prefs.mode) ? prefs.mode : 'tcp');

    // device dropdown (saved devices + detected COM ports)
    renderDeviceSelect();
    AppState.onDevicesChange(renderDeviceSelect);
    rescan();
    $('consoleDevice').addEventListener('change', (e) => applyDeviceChoice(e.target.value));
    $('consoleRescan').addEventListener('click', rescan);

    // plug / unplug of USB serial adapters: look again while this tab is showing
    setInterval(() => {
      if (!$('tab-console').classList.contains('active') || state.open || state.busy) return;
      rescan();
    }, 3000);
    document.addEventListener('tabchange', (e) => { if (e.detail.tabId === 'console') rescan(); });

    document.querySelectorAll('#linkModes .seg-btn').forEach((btn) => {
      btn.addEventListener('click', () => { setMode(btn.dataset.mode); $('consoleDevice').value = 'manual'; savePrefs(); });
    });
    ['linkIp', 'linkPort', 'linkLocalPort', 'linkBroadcast', 'serialPath', 'serialBaud', 'serialData', 'serialParity', 'serialStop', 'serialFlow']
      .forEach((id) => $(id).addEventListener('change', savePrefs));

    $('linkToggleBtn').addEventListener('click', toggleConnection);
    $('lineDtr').addEventListener('change', (e) => window.api.link.setLine('dtr', e.target.checked));
    $('lineRts').addEventListener('change', (e) => window.api.link.setLine('rts', e.target.checked));

    $('consoleDelimiter').addEventListener('change', (e) => {
      $('customDelimiterRow').classList.toggle('hidden', e.target.value !== 'custom');
      savePrefs();
    });
    $('consoleDelimiterCustom').addEventListener('change', savePrefs);
    $('consoleDelimiterEncoding').addEventListener('change', savePrefs);

    $('clearLogBtn').addEventListener('click', () => { $('consoleLog').innerHTML = ''; });

    document.querySelectorAll('.send-line').forEach((row) => {
      row.querySelector('.send-btn').addEventListener('click', () => sendLine(row));
      row.querySelector('.send-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') sendLine(row); });
      row.querySelector('.send-input').addEventListener('change', savePrefs);
      row.querySelector('.send-hex').addEventListener('change', savePrefs);
    });

    window.api.link.onData((d) => appendLog(d));
    window.api.link.onStatus(renderStatus);
    window.api.link.status().then(renderStatus);
  }

  window.ConsoleTab = { init };
}());
