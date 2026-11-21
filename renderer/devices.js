(function devicesTab() {
  const $ = (id) => document.getElementById(id);
  let scanning = false;
  let lastScan = null;

  function statusDotClass(status) {
    return { online: 'dot-online', offline: 'dot-offline', unresponsive: 'dot-unresponsive' }[status] || 'dot-unknown';
  }

  function cleanError(err) {
    return String((err && err.message) || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
  }

  // ---------- known devices table ----------
  function renderDeviceTable(devices) {
    const body = $('deviceTableBody');
    $('deviceCount').textContent = devices.length;

    if (!devices.length) {
      body.innerHTML = '<tr><td colspan="7" class="scan-empty">No devices yet \u2014 add one above or run a scan.</td></tr>';
      return;
    }

    body.innerHTML = devices.map((d) => `
      <tr data-id="${esc(d.id)}">
        <td><span class="status-dot ${statusDotClass(d.status)}"></span>${esc(d.status || 'unknown')}</td>
        <td>${esc(d.name)}</td>
        <td class="mono">${esc(d.ip)}:${esc(d.port)}</td>
        <td>${esc(String(d.protocol).toUpperCase())}</td>
        <td>${esc(d.room) || '\u2014'}</td>
        <td>${d.lastSeen ? esc(new Date(d.lastSeen).toLocaleTimeString()) : '\u2014'}</td>
        <td class="row-actions"><button class="btn btn-secondary btn-sm details-device" data-id="${esc(d.id)}">Get details</button><button class="btn btn-ghost btn-sm remove-device" data-id="${esc(d.id)}">Remove</button></td>
      </tr>
    `).join('');

    body.querySelectorAll('.details-device').forEach((btn) => {
      btn.addEventListener('click', () => {
        const device = AppState.devices.find((d) => d.id === btn.dataset.id);
        if (device && window.DeviceDetails) window.DeviceDetails.open({ ip: device.ip, port: device.port, deviceId: device.id });
      });
    });
    body.querySelectorAll('.remove-device').forEach((btn) => {
      btn.addEventListener('click', async () => {
        await window.api.devices.remove(btn.dataset.id);
        await refreshDevices();
        if (lastScan) renderScanResults(lastScan);
      });
    });
  }

  // ---------- discovery results ----------
  const isKnown = (ip, port) => AppState.devices.some((d) => d.ip === ip && Number(d.port) === Number(port));
  const hasAnyPort = (ip) => AppState.devices.some((d) => d.ip === ip);

  function prefillAddForm({ ip, name }) {
    const panel = $('addDevicePanel');
    setPanelCollapsed(panel, false);
    const form = $('addDeviceForm');
    form.elements.ip.value = ip;
    form.elements.name.value = name || ip;
    panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    form.elements.port.focus();
  }

  async function addFromScan(result, port) {
    await window.api.devices.add({
      name: result.hostname ? result.hostname.split('.')[0] : result.ip,
      ip: result.ip,
      port,
      protocol: 'tcp',
      room: '',
    });
    await refreshDevices();
    renderScanResults(lastScan);
  }

  function renderScanResults(scan) {
    const list = $('scanResults');
    const summary = $('scanSummary');
    const { results } = scan;

    const n = results.length;
    const portsText = scan.usedDefaultPorts
      ? `${scan.portsUsed.length} common AV ports`
      : `${scan.portsUsed.length} port${scan.portsUsed.length === 1 ? '' : 's'}`;
    summary.textContent = scan.live
      ? `Found ${n} device${n === 1 ? '' : 's'} so far\u2026`
      : `${scan.cancelled ? 'Stopped early \u2014 ' : ''}Found ${n} device${n === 1 ? '' : 's'} \u00B7 checked ${scan.scannedHosts} of ${scan.totalHosts} addresses \u00B7 ${portsText}`;
    summary.classList.remove('hidden');

    if (!n && scan.live) { list.innerHTML = ''; return; }
    if (!n) {
      list.innerHTML = '<li class="scan-empty">Nothing answered. A device that blocks ping and uses a port outside the list won\u2019t show up \u2014 try entering its port above, or add it manually.</li>';
      return;
    }

    list.innerHTML = results.map((r, i) => {
      const sub = [r.hostname, r.mac].filter(Boolean).map(esc).join(' \u00B7 ') || 'No hostname';
      const chips = [
        r.alive ? '<span class="chip chip-ping">Replies to ping</span>' : '',
        ...r.openPorts.map((p) => `
          <button type="button" class="chip add-port" data-i="${i}" data-port="${p.port}" ${isKnown(r.ip, p.port) ? 'disabled' : ''} title="Add this device using port ${p.port}">
            ${p.port}${p.service ? ` ${esc(p.service)}` : ''}
          </button>`),
      ].join('');
      let action;
      if (r.openPorts.length) {
        const allKnown = r.openPorts.every((p) => isKnown(r.ip, p.port));
        action = `<button type="button" class="btn btn-ghost btn-sm add-first" data-i="${i}" ${allKnown ? 'disabled' : ''}>${allKnown ? 'Added' : 'Add'}</button>`;
      } else {
        action = hasAnyPort(r.ip)
          ? '<button type="button" class="btn btn-ghost btn-sm" disabled>Added</button>'
          : `<button type="button" class="btn btn-ghost btn-sm add-manual" data-i="${i}">Add\u2026</button>`;
      }
      return `
        <li class="scan-result-item">
          <div class="scan-main"><span class="mono scan-ip">${esc(r.ip)}</span><span class="scan-sub">${sub}</span></div>
          <div class="scan-chips">${chips}</div>
          <div class="scan-actions">${action}</div>
        </li>`;
    }).join('');

    list.querySelectorAll('.add-port').forEach((btn) => {
      btn.addEventListener('click', () => addFromScan(results[Number(btn.dataset.i)], Number(btn.dataset.port)));
    });
    list.querySelectorAll('.add-first').forEach((btn) => {
      btn.addEventListener('click', () => {
        const r = results[Number(btn.dataset.i)];
        const next = r.openPorts.find((p) => !isKnown(r.ip, p.port));
        if (next) addFromScan(r, next.port);
      });
    });
    list.querySelectorAll('.add-manual').forEach((btn) => {
      btn.addEventListener('click', () => {
        const r = results[Number(btn.dataset.i)];
        prefillAddForm({ ip: r.ip, name: r.hostname ? r.hostname.split('.')[0] : r.ip });
      });
    });
  }

  function setScanning(on) {
    scanning = on;
    $('scanBtn').disabled = on;
    $('cancelScanBtn').classList.toggle('hidden', !on);
    $('scanProgress').classList.toggle('hidden', !on);
  }

  async function runScan(form) {
    if (scanning) return;
    let target = form.elements.target.value.trim();

    // Nothing typed? Scan the network this PC is on.
    if (!target) {
      const nets = await window.api.discovery.localNetworks();
      if (nets.length) {
        target = nets[0].cidr;
        form.elements.target.value = target;
      }
    }

    setScanning(true);
    $('progressFill').style.width = '0%';
    $('progressLabel').textContent = 'Starting\u2026';
    $('scanSummary').classList.add('hidden');
    $('scanResults').innerHTML = '';

    const unsubscribe = window.api.discovery.onProgress(({ scanned, total, found }) => {
      $('progressFill').style.width = `${total ? Math.round((scanned / total) * 100) : 0}%`;
      $('progressLabel').textContent = `Scanned ${scanned} / ${total} addresses \u00B7 ${found} found`;
    });
    // Devices appear in the list as soon as they answer, not only when the sweep ends.
    const live = new Map();
    let drawQueued = false;
    const unsubscribeFound = window.api.discovery.onFound((r) => {
      live.set(r.ip, r);
      if (drawQueued) return;
      drawQueued = true;
      requestAnimationFrame(() => {
        drawQueued = false;
        if (!scanning) return;
        const results = [...live.values()].sort((a, b) => a.ip.split('.').reduce((x, o) => x * 256 + Number(o), 0) - b.ip.split('.').reduce((x, o) => x * 256 + Number(o), 0));
        lastScan = { results, live: true, portsUsed: [], scannedHosts: 0, totalHosts: 0 };
        renderScanResults(lastScan);
      });
    });

    try {
      lastScan = await window.api.discovery.scan({ target, ports: form.elements.ports.value });
      renderScanResults(lastScan);
    } catch (err) {
      lastScan = null;
      $('scanResults').innerHTML = `<li class="scan-empty">${esc(cleanError(err))}</li>`;
    } finally {
      unsubscribe();
      unsubscribeFound();
      setScanning(false);
    }
  }

  async function renderNetworkChips() {
    const nets = await window.api.discovery.localNetworks();
    const row = $('networkChips');
    if (!nets.length) { row.innerHTML = ''; return; }
    row.innerHTML = `<span class="chip-label">This PC is on:</span>${nets.map((n) => `<button type="button" class="chip use-network" data-cidr="${esc(n.cidr)}" title="${esc(n.name)} \u2014 ${esc(n.address)}">${esc(n.cidr)}</button>`).join('')}`;
    row.querySelectorAll('.use-network').forEach((btn) => {
      btn.addEventListener('click', () => { $('discoveryForm').elements.target.value = btn.dataset.cidr; });
    });
    if (!$('discoveryForm').elements.target.value) $('discoveryForm').elements.target.value = nets[0].cidr;
  }

  function init() {
    AppState.onDevicesChange(renderDeviceTable);
    renderDeviceTable(AppState.devices);
    renderNetworkChips();

    $('addDeviceForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const form = e.target;
      await window.api.devices.add({
        name: form.elements.name.value.trim(),
        ip: form.elements.ip.value.trim(),
        port: form.elements.port.value,
        protocol: form.elements.protocol.value,
        room: form.elements.room.value.trim(),
      });
      form.reset();
      await refreshDevices();
      if (lastScan) renderScanResults(lastScan);
    });

    $('discoveryForm').addEventListener('submit', (e) => {
      e.preventDefault();
      runScan(e.target);
    });
    $('cancelScanBtn').addEventListener('click', () => {
      $('progressLabel').textContent = 'Stopping\u2026';
      window.api.discovery.cancel();
    });
  }

  window.DevicesTab = { init };
}());
