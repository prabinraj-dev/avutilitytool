const { ipcMain, app } = require('electron');
const { sendTcp } = require('./net/tcp');
const { sendUdp } = require('./net/udp');
const { scanRange, localNetworks } = require('./net/discovery');
const { buildFrame, toHexView, toAsciiView } = require('./net/encode');

async function transmit(device, params) {
  const frame = buildFrame(params);
  const sender = device.protocol === 'udp' ? sendUdp : sendTcp;
  const result = await sender({ ip: device.ip, port: device.port, data: frame });
  return {
    ...result,
    sentHex: toHexView(frame),
    sentAscii: toAsciiView(frame),
    responseHex: toHexView(result.response),
    responseAscii: toAsciiView(result.response),
    timestamp: Date.now(),
  };
}

// Only these settings can be changed from the renderer.
const EDITABLE_SETTINGS = ['autoCheckUpdates']; // the update source is built in, not editable

const { LinkManager } = require('./link');
const fs = require('fs');
const path = require('path');
const { net, shell } = require('electron');
const { getDetails, mergeCommands } = require('./probe');
const { createLibrary, prepareCommands, countCommands, OfflineError } = require('./probe/library');

// Where the online protocol library lives (the repo built into the app; not shown in the UI).
function libraryBaseUrl() {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'update-config.json'), 'utf8'));
    if (/^[\w.-]+\/[\w.-]+$/.test(cfg.repo || '')) return `https://raw.githubusercontent.com/${cfg.repo}/${cfg.libraryBranch || 'AV-Code'}/protocols/`;
  } catch (e) { /* not configured */ }
  return '';
}

function registerIpcHandlers({
  send, store, heartbeat, updater, applyTheme,
}) {
  // --- Theme (sync read so the page can paint in the right theme immediately) ---
  ipcMain.on('theme:getSync', (event) => {
    // eslint-disable-next-line no-param-reassign
    event.returnValue = store.getSettings().theme === 'light' ? 'light' : 'dark';
  });
  ipcMain.handle('theme:set', (_e, theme) => {
    const applied = applyTheme(theme);
    store.setSettings({ theme: applied });
    return applied;
  });

  // --- Devices -------------------------------------------------------
  ipcMain.handle('devices:list', () => store.listDevices());
  ipcMain.handle('devices:add', (_e, device) => store.addDevice(device));
  ipcMain.handle('devices:update', (_e, { id, patch }) => store.updateDevice(id, patch));
  ipcMain.handle('devices:remove', (_e, id) => {
    store.removeDevice(id);
    return true;
  });

  // --- Discovery -------------------------------------------------------
  let activeScan = null;
  ipcMain.handle('discovery:localNetworks', () => localNetworks());
  ipcMain.handle('discovery:cancel', () => {
    if (activeScan) activeScan.cancelled = true;
    return true;
  });
  ipcMain.handle('discovery:scan', async (_e, { target, ports }) => {
    if (activeScan) throw new Error('A scan is already running');
    const token = { cancelled: false };
    activeScan = token;
    try {
      return await scanRange({
        target,
        ports,
        shouldCancel: () => token.cancelled,
        onProgress: (progress) => send('discovery:progress', progress),
        onFound: (result) => send('discovery:found', result),
      });
    } finally {
      activeScan = null;
    }
  });

  // --- Heartbeat -------------------------------------------------------
  ipcMain.handle('heartbeat:start', () => { heartbeat.start(); return true; });
  ipcMain.handle('heartbeat:stop', () => { heartbeat.stop(); return true; });
  ipcMain.handle('heartbeat:configure', (_e, { intervalMs, method }) => {
    heartbeat.configure({ intervalMs, method });
    store.setSettings({ heartbeatInterval: heartbeat.intervalMs, heartbeatMethod: heartbeat.method });
    return { intervalMs: heartbeat.intervalMs, method: heartbeat.method };
  });
  heartbeat.on('status', ({ id, status, lastSeen }) => {
    store.updateDevice(id, { status, lastSeen });
    send('devices:statusUpdate', { id, status, lastSeen });
  });

  // --- Manual command console -------------------------------------------------------
  ipcMain.handle('console:send', async (_e, params) => {
    const device = store.listDevices().find((d) => d.id === params.deviceId);
    if (!device) return { success: false, error: 'Device not found' };
    try {
      return await transmit(device, params);
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // --- Live connection (TCP client / UDP / Serial) for the console -------------------
  const link = new LinkManager({ emit: send });
  app.once('before-quit', () => { link.close(); });
  ipcMain.handle('link:open', (_e, cfg) => link.open(cfg || {}));
  ipcMain.handle('link:close', () => link.close());
  ipcMain.handle('link:status', () => link.status);
  ipcMain.handle('link:serialList', () => link.listSerial());
  ipcMain.handle('link:setLine', (_e, { line, on }) => link.setLine(line, on));
  ipcMain.handle('link:send', async (_e, params) => {
    try {
      return await link.send(buildFrame(params || {}));
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // --- Get details: identify a device by IP (login is used for this request only, never stored) ---
  ipcMain.handle('probe:details', async (_e, { ip, port, username, password }) => {
    try {
      const result = await getDetails({
        ip: String(ip || '').trim(),
        port,
        creds: { username: username || '', password: password || '' },
        onProgress: (progress) => send('probe:progress', progress),
      });
      return { success: true, result };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });
  // Looks up a device's control commands in the online protocol library.
  const library = createLibrary({
    baseUrl: libraryBaseUrl(),
    fetchText: async (url) => {
      const res = await net.fetch(url, { cache: 'no-store' });
      return { status: res.status, text: await res.text() };
    },
  });
  const lookupCommands = async ({ profileId, manufacturer, model, context }) => {
    if (!libraryBaseUrl()) return { online: true, found: false };
    try {
      const entry = await library.lookup({ profileId, manufacturer, model });
      if (!entry) return { online: true, found: false };
      const commands = prepareCommands(entry.commands, context);
      return {
        online: true, found: true, entry, commands, count: countCommands(commands),
      };
    } catch (err) {
      if (err instanceof OfflineError) return { online: false, found: false };
      return { online: true, found: false, error: err.message };
    }
  };
  ipcMain.handle('probe:lookup', async (_e, params) => {
    const r = await lookupCommands(params || {});
    return {
      online: r.online, found: r.found, error: r.error || '', count: r.count || 0,
      note: r.found ? r.entry.note : '', port: r.found ? r.entry.port : null, matchedModel: r.found ? r.entry.matchedModel : '',
    };
  });
  // Loads the looked-up commands into that device's Control buttons.
  ipcMain.handle('probe:applyCommands', async (_e, {
    deviceId, profileId, manufacturer, model, context, port,
  }) => {
    try {
      const device = store.listDevices().find((d) => d.id === deviceId);
      if (!device) return { success: false, error: 'Device not found' };
      const r = await lookupCommands({ profileId, manufacturer, model, context });
      if (!r.online) return { success: false, error: 'No internet connection. Connect to the internet and try again.' };
      if (!r.found) return { success: false, error: r.error || 'No commands for this device in the protocol library yet.' };
      const { mapping, added } = mergeCommands(store.getMapping(deviceId), r.commands);
      store.setMapping(deviceId, mapping);
      const usePort = Number(r.entry.port) || Number(port) || device.port;
      const protocol = r.entry.protocol === 'udp' ? 'udp' : 'tcp';
      let portChanged = false;
      if (Number(device.port) !== usePort || device.protocol !== protocol) {
        store.updateDevice(deviceId, { port: usePort, protocol });
        portChanged = true;
      }
      return {
        success: true, added, portChanged, port: usePort,
      };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });
  // Opens a web search for the device's control protocol in the user's browser.
  ipcMain.handle('probe:searchWeb', (_e, { text }) => {
    const q = String(text || '').replace(/[^\w .+\-/]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
    if (!q) return false;
    shell.openExternal(`https://www.google.com/search?q=${encodeURIComponent(`${q} RS232 LAN control protocol commands`)}`);
    return true;
  });

  // --- Command mapping matrix -------------------------------------------------------
  ipcMain.handle('mappings:get', (_e, deviceId) => store.getMapping(deviceId));
  ipcMain.handle('mappings:set', (_e, { deviceId, mapping }) => store.setMapping(deviceId, mapping));

  // --- Control page (reuses the same transmit pipeline as the console) -------------
  ipcMain.handle('control:trigger', async (_e, { deviceId, command }) => {
    const device = store.listDevices().find((d) => d.id === deviceId);
    if (!device) return { success: false, error: 'Device not found' };
    if (!command || !command.payload) return { success: false, error: 'No command mapped to this button yet \u2014 open "Edit command mapping"' };
    try {
      return await transmit(device, command);
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // --- Settings / app info -------------------------------------------------------
  ipcMain.handle('settings:get', () => store.getSettings());
  ipcMain.handle('settings:set', (_e, patch) => {
    const clean = {};
    EDITABLE_SETTINGS.forEach((key) => { if (key in patch) clean[key] = patch[key]; });
    return store.setSettings(clean);
  });
  ipcMain.handle('app:info', () => ({ version: app.getVersion(), packaged: app.isPackaged, name: app.getName()}));

  // --- Updates -------------------------------------------------------
  ipcMain.handle('updater:status', () => updater.state);
  ipcMain.handle('updater:check', () => updater.check({ manual: true }));
  ipcMain.handle('updater:download', () => updater.download());
  ipcMain.handle('updater:install', () => { updater.install(); return true; });
}

module.exports = { registerIpcHandlers };
