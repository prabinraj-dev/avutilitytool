// "Get details": asks a device (by IP) what it is and shows the answer in a window.
(function deviceDetails() {
  const $ = (id) => document.getElementById(id);

  const FIELD_LABELS = {
    manufacturer: 'Manufacturer', model: 'Model', serial: 'Serial number', firmware: 'Firmware', partNumber: 'Part number',
    mac: 'MAC address', name: 'Device name', hostname: 'Host name', power: 'Power', input: 'Input', volume: 'Volume', mute: 'Mute',
    class: 'PJLink class', info: 'Other info', access: 'Logged in as', authentication: 'Authentication', displayId: 'Display ID',
    designName: 'Design name', designCode: 'Design code', state: 'State', status: 'Status', emulator: 'Emulator', redundant: 'Redundant',
    versionInfo: 'Version info', tsid: 'TSID',
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
    const device = current.deviceId ? AppState.devices.find((d) => d.id === current.deviceId) : null;
    const loadLabel = device ? `Load ${m.commandCount} commands into Control buttons` : `Add as device and load ${m.commandCount} commands`;
    return `
      <div class="details-match">
        <h4><span>Recognised as: ${esc(m.name)}</span>${m.needsLogin ? '<span class="badge badge-warn"><i></i><span>Login needed</span></span>' : '<span class="badge badge-ok"><i></i><span>Identified</span></span>'}</h4>
        ${kv(rows)}
        ${m.needsLogin ? loginHtml(m.loginHint, m.loginFailed) : ''}
        ${m.commandNote ? `<p class="dt-hint"><strong>Control commands:</strong> ${esc(m.commandNote)}</p>` : ''}
        <div class="details-actions">
          ${m.commandCount ? `<button type="button" class="btn btn-primary load-commands" data-index="${i}">${esc(loadLabel)}</button>` : ''}
          ${!device && !m.commandCount ? `<button type="button" class="btn btn-secondary load-commands" data-index="${i}">Add as device</button>` : ''}
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
        <p class="dt-hint">The device did not answer any of the built-in identity checks, so its serial number and command list could not be read. You can still control it: add it as a device and enter its commands on the Control page, or test them in the Command Console.</p>
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
    document.querySelectorAll('#detailsBody .load-commands').forEach((btn) => {
      btn.addEventListener('click', () => loadCommands(result.matches[Number(btn.dataset.index)], btn));
    });
  }

  async function loadCommands(match, btn) {
    btn.disabled = true;
    let deviceId = current.deviceId;
    if (!deviceId || !AppState.devices.some((d) => d.id === deviceId)) {
      const created = await window.api.devices.add({
        name: match.fields.name || match.fields.model || match.fields.hostname || match.name,
        ip: current.ip,
        port: match.port,
        protocol: match.protocol,
        room: '',
      });
      deviceId = created.id;
      current.deviceId = deviceId;
    }
    const res = await window.api.probe.applyCommands({ deviceId, profileId: match.profileId, context: match.context, port: match.port });
    await refreshDevices();
    document.dispatchEvent(new CustomEvent('mappingchanged', { detail: { deviceId } }));
    const note = $('detailsNote');
    if (!note) return;
    if (!res.success) { note.textContent = res.error || 'Could not load the commands.'; btn.disabled = false; return; }
    note.textContent = `${res.added} command${res.added === 1 ? '' : 's'} added to this device’s Control buttons`
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
