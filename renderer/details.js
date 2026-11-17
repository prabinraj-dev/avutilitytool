// "Get details": asks a device (by IP) what it is and shows the answer in a window.
(function deviceDetails() {
  const $ = (id) => document.getElementById(id);

  const FIELD_LABELS = {
    manufacturer: 'Manufacturer', model: 'Model', serial: 'Serial number', firmware: 'Firmware', partNumber: 'Part number',
    mac: 'MAC address', name: 'Device name', hostname: 'Host name', power: 'Power', input: 'Input', volume: 'Volume', mute: 'Mute',
    class: 'PJLink class', info: 'Other info', access: 'Logged in as', authentication: 'Authentication', displayId: 'Display ID',
    designName: 'Design name', designCode: 'Design code', state: 'State', status: 'Status', emulator: 'Emulator', redundant: 'Redundant',
    versionInfo: 'Version info', tsid: 'TSID', setId: 'Set ID', deviceType: 'Device type', lampHours: 'Lamp hours',
  };
  const FIELD_ORDER = Object.keys(FIELD_LABELS);

  let current = null; // { ip, port, deviceId, result }
  let stepText = '';

  const kv = (rows) => `<dl class="kv">${rows.filter(([, v]) => v !== '' && v != null).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join('')}</dl>`;

  function close() {
    current = null;
    $('modalRoot').innerHTML = '';
    document.removeEventListener('keydown', onEsc);
  }
  function onEsc(e) { if (e.key === 'Escape') close(); }

  function shell(bodyHtml) {
    $('modalRoot').innerHTML = `
      <div class="modal-backdrop">
        <div class="modal details-modal" role="dialog" aria-label="Device details">
          <div class="modal-header">
            <h2>Device details — <span class="mono">${esc(current.ip)}</span></h2>
            <button type="button" class="modal-close btn btn-ghost btn-sm">Close</button>
          </div>
          <div class="modal-body" id="detailsBody">${bodyHtml}</div>
        </div>
      </div>`;
    const root = $('modalRoot');
    root.querySelector('.modal-close').addEventListener('click', close);
    root.querySelector('.modal-backdrop').addEventListener('mousedown', (e) => { if (e.target.classList.contains('modal-backdrop')) close(); });
  }

  function loginHtml(hint, failed) {
    return `
      <p class="dt-hint">${failed ? '<strong>That login was not accepted.</strong> ' : ''}This device needs a login to show more. ${esc(hint || '')} It is used for this check only and is not saved.</p>
      <form class="details-login">
        <label>User name<input type="text" name="username" autocomplete="off" spellcheck="false" placeholder="leave empty if not needed" /></label>
        <label>Password<input type="password" name="password" autocomplete="off" /></label>
        <button type="submit" class="btn btn-primary">Log in &amp; retry</button>
      </form>`;
  }

  function matchHtml(m, i) {
    const rows = FIELD_ORDER.filter((k) => m.fields[k] !== undefined).map((k) => [FIELD_LABELS[k], esc(m.fields[k])]);
    Object.keys(m.fields).filter((k) => !FIELD_ORDER.includes(k)).forEach((k) => rows.push([k, esc(m.fields[k])]));
    rows.push(['Control port', `<span class="mono">${esc(m.port)}</span> (${esc(String(m.protocol).toUpperCase())})`]);
    return `
      <div class="details-match">
        <h4><span>Recognised as: ${esc(m.name)}</span>${m.needsLogin ? '<span class="badge badge-warn"><i></i><span>Login needed</span></span>' : '<span class="badge badge-ok"><i></i><span>Identified</span></span>'}</h4>
        ${kv(rows)}
        ${m.needsLogin ? loginHtml(m.loginHint, m.loginFailed) : ''}
        <div class="details-lookup" id="detailsLookup${i}"><p class="dt-hint">Looking up control commands online\u2026</p></div>
        <div class="details-actions">
          <button type="button" class="btn btn-ghost btn-sm toggle-raw" data-index="${i}">Show device replies</button>
        </div>
        <pre class="details-raw hidden" id="detailsRaw${i}">${esc(m.raw.join('\n'))}</pre>
      </div>`;
  }

  function renderResult(result) {
    current.result = result;
    if (!result.reachable) {
      shell(`<p class="set-line">No answer from <span class="mono">${esc(result.ip)}</span>. Check the address, the cable or Wi-Fi, and that this PC is on the same network.</p>
        <div class="details-actions"><button type="button" class="btn btn-secondary" id="detailsRetry">Try again</button></div>`);
      $('detailsRetry').addEventListener('click', () => run({}));
      return;
    }
    const ports = result.openPorts.map((p) => `<span class="mono">${esc(p.port)}</span>${p.service ? ` ${esc(p.service)}` : ''}`).join(', ');
    const web = result.web.map((w) => `port ${esc(w.port)}: ${esc(w.title || w.server || `HTTP ${w.status}`)}${w.needsLogin ? ' (login required)' : ''}`).join('<br>');
    const summary = kv([
      ['IP address', `<span class="mono">${esc(result.ip)}</span>`],
      ['MAC address', result.mac ? `<span class="mono">${esc(result.mac)}</span>` : 'Not available (the device is on another subnet, or did not report it)'],
      ['Manufacturer', esc(result.vendor)],
      ['Host name', esc(result.hostname)],
      ['Open ports', ports || 'None of the common AV control ports are open'],
      ['Web page', web],
    ]);
    const none = result.matches.length ? '' : `
      <div class="details-match">
        <h4><span>Device type not recognised</span></h4>
        <p class="dt-hint">The device did not answer any of the built-in identity checks, so its model and serial number could not be read. You can still control it: add it as a device and enter its commands on the Control page, or test them in the Command Console.</p>
        <div class="details-lookup" id="detailsLookupNone"></div>
        ${result.needsLogin ? loginHtml('Its web page asks for a user name and password.', false) : ''}
      </div>`;
    shell(`${summary}${result.matches.map(matchHtml).join('')}${none}
      <div class="details-actions"><button type="button" class="btn btn-secondary btn-sm" id="detailsRetry">Check again</button><span class="dt-hint" id="detailsNote"></span></div>`);

    $('detailsRetry').addEventListener('click', () => run({}));
    document.querySelectorAll('#detailsBody .details-login').forEach((form) => {
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        run({ username: form.elements.username.value, password: form.elements.password.value });
      });
    });
    document.querySelectorAll('#detailsBody .toggle-raw').forEach((btn) => {
      btn.addEventListener('click', () => {
        const pre = $(`detailsRaw${btn.dataset.index}`);
        pre.classList.toggle('hidden');
        btn.textContent = pre.classList.contains('hidden') ? 'Show device replies' : 'Hide device replies';
      });
    });
    result.matches.forEach((m, i) => lookupFor(m, $(`detailsLookup${i}`)));
    if (!result.matches.length) {
      const text = [result.vendor, (result.web[0] || {}).title].filter(Boolean).join(' ');
      if (text) lookupFor({ fields: { manufacturer: result.vendor }, searchText: text, unrecognised: true }, $('detailsLookupNone'));
    }
  }

  // Asks the online protocol library for this device's commands and shows the outcome.
  async function lookupFor(m, el) {
    if (!el) return;
    const request = current;
    const r = await window.api.probe.lookup({
      profileId: m.profileId, manufacturer: m.fields.manufacturer, model: m.fields.model, context: m.context,
    });
    if (current !== request || !el.isConnected) return;
    const searchText = m.searchText || [m.fields.manufacturer, m.fields.model].filter(Boolean).join(' ') || m.name;
    const searchBtn = `<button type="button" class="btn btn-secondary btn-sm search-web">Search the web for its control protocol</button>`;
    if (!r.online) {
      el.innerHTML = '<p class="details-offline"><strong>No internet connection.</strong> Control commands are looked up online, so they can\u2019t be loaded right now. The details above were read directly from the device.</p>';
      return;
    }
    if (r.found && r.count) {
      const device = current.deviceId ? AppState.devices.find((d) => d.id === current.deviceId) : null;
      const label = device ? `Load ${r.count} commands into Control buttons` : `Add as device and load ${r.count} commands`;
      el.innerHTML = `${r.note ? `<p class="dt-hint"><strong>Control commands:</strong> ${esc(r.note)}</p>` : ''}
        <div class="details-actions"><button type="button" class="btn btn-primary load-commands">${esc(label)}</button>${searchBtn}</div>`;
      el.querySelector('.load-commands').addEventListener('click', (e) => loadCommands(m, e.currentTarget, r.port));
    } else {
      const why = r.found ? (r.note || 'This device has no fixed command list.') : (r.error || `${m.unrecognised ? 'This device' : 'This model'} is not in the protocol library yet.`);
      el.innerHTML = `<p class="dt-hint">${esc(why)} You can look up its control protocol on the web and enter the commands on the Control page.</p>
        <div class="details-actions">${!m.unrecognised && !(current.deviceId && AppState.devices.some((d) => d.id === current.deviceId)) ? '<button type="button" class="btn btn-secondary btn-sm add-only">Add as device</button>' : ''}${searchBtn}</div>`;
      const add = el.querySelector('.add-only');
      if (add) add.addEventListener('click', (e) => addOnly(m, e.currentTarget));
    }
    el.querySelector('.search-web').addEventListener('click', () => window.api.probe.searchWeb(searchText));
  }

  async function ensureDevice(m, port) {
    let deviceId = current.deviceId;
    if (!deviceId || !AppState.devices.some((d) => d.id === deviceId)) {
      const created = await window.api.devices.add({
        name: m.fields.name || m.fields.model || m.fields.hostname || m.name,
        ip: current.ip,
        port: port || m.port,
        protocol: m.protocol,
        room: '',
      });
      deviceId = created.id;
      current.deviceId = deviceId;
    }
    return deviceId;
  }

  async function addOnly(m, btn) {
    btn.disabled = true;
    await ensureDevice(m);
    await refreshDevices();
    btn.textContent = 'Added';
  }

  async function loadCommands(match, btn, port) {
    btn.disabled = true;
    const deviceId = await ensureDevice(match, port);
    const res = await window.api.probe.applyCommands({
      deviceId, profileId: match.profileId, manufacturer: match.fields.manufacturer, model: match.fields.model, context: match.context, port: match.port,
    });
    await refreshDevices();
    document.dispatchEvent(new CustomEvent('mappingchanged', { detail: { deviceId } }));
    const note = $('detailsNote');
    if (!note) return;
    if (!res.success) { note.textContent = res.error || 'Could not load the commands.'; btn.disabled = false; return; }
    note.textContent = `${res.added} command${res.added === 1 ? '' : 's'} added to this device\u2019s Control buttons`
      + `${res.portChanged ? `, and its control port was set to ${res.port}` : ''}. Buttons you had already set up were left as they were.`;
    btn.textContent = 'Commands loaded';
  }

  async function run({ username = '', password = '' }) {
    if (!current) return;
    const request = current;
    stepText = 'Checking the network…';
    shell(`<p class="details-busy" id="detailsStep">${esc(stepText)}</p>`);
    const res = await window.api.probe.details({ ip: request.ip, port: request.port, username, password });
    if (current !== request) return; // window was closed or reused
    if (!res.success) {
      shell(`<p class="set-line">${esc(res.error || 'Could not check this device.')}</p>`);
      return;
    }
    renderResult(res.result);
  }

  function open({ ip, port, deviceId }) {
    current = { ip: String(ip || '').trim(), port, deviceId: deviceId || null };
    if (!current.deviceId) {
      const known = AppState.devices.find((d) => d.ip === current.ip);
      if (known) { current.deviceId = known.id; current.port = known.port; }
    }
    document.addEventListener('keydown', onEsc);
    run({});
  }

  window.addEventListener('DOMContentLoaded', () => {
    $('detailsForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const ip = $('detailsIp').value.trim();
      if (ip) open({ ip });
    });
    window.api.probe.onProgress((p) => {
      stepText = p.step || stepText;
      const el = $('detailsStep');
      if (el) el.textContent = stepText;
    });
  });

  window.DeviceDetails = { open };
}());
