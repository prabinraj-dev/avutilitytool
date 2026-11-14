const {
  app, BrowserWindow, session, nativeTheme,
} = require('electron');
const path = require('path');
const { Store } = require('./src/store');
const { HeartbeatManager } = require('./src/net/heartbeat');
const { UpdateManager } = require('./src/updater');
const { registerIpcHandlers } = require('./src/ipc');

const THEME_BG = { dark: '#0d1423', light: '#f2f6fd' };
// Allow camera / microphone / speaker-selection for the Device Test tab.
const ALLOWED_PERMISSIONS = new Set(['media', 'audioCapture', 'videoCapture', 'speaker-selection']);

let mainWindow = null;

function send(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
}

function applyTheme(theme) {
  const applied = theme === 'light' ? 'light' : 'dark';
  nativeTheme.themeSource = applied;
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setBackgroundColor(THEME_BG[applied]);
  return applied;
}

function createWindow(theme) {
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 840,
    minWidth: 1000,
    minHeight: 640,
    title: 'AV Control Utility',
    backgroundColor: THEME_BG[theme] || THEME_BG.dark,
    icon: path.join(__dirname, 'renderer', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.on('closed', () => { mainWindow = null; });
}

app.setAppUserModelId('com.avcontrol.utility');

// One running copy at a time (two copies would fight over the data file).
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => callback(ALLOWED_PERMISSIONS.has(permission)));
    session.defaultSession.setPermissionCheckHandler((_wc, permission) => ALLOWED_PERMISSIONS.has(permission));

    const store = new Store(app.getPath('userData'));
    const heartbeat = new HeartbeatManager();
    const updater = new UpdateManager({ store, send });

    const settings = store.getSettings();
    heartbeat.configure({
      intervalMs: settings.heartbeatInterval,
      method: settings.heartbeatMethod,
      getDevices: () => store.listDevices(),
    });

    const theme = applyTheme(settings.theme);
    registerIpcHandlers({
      send, store, heartbeat, updater, applyTheme,
    });
    createWindow(theme);
    heartbeat.start();
    updater.scheduleStartupCheck();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow(applyTheme(store.getSettings().theme));
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
