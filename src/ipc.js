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
const { getDetails, mergeCommands } = require('./probe');

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
  // Loads a recognised device type's ready-made commands into that device's Control buttons.
  ipcMain.handle('probe:applyCommands', (_e, { deviceId, profileId, context, port }) => {
    try {
      const device = store.listDevices().find((d) => d.id === deviceId);
      if (!device) return { success: false, error: 'Device not found' };
      const { mapping, added, profile } = mergeCommands(store.getMapping(deviceId), profileId, context);
      store.setMapping(deviceId, mapping);
      let portChanged = false;
      if (Number(port) && (Number(device.port) !== Number(port) || device.protocol !== profile.protocol)) {
        store.updateDevice(deviceId, { port: Number(port), protocol: profile.protocol });
        portChanged = true;
      }
      return { success: true, added, portChanged, port: Number(port) || device.port };
    } catch (err) {
      return { success: false, error: err.message };
    }
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
