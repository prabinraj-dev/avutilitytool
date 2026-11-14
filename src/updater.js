const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const { resolveFeed, describeFeed } = require('./update-source');
const { notesToText, friendlyError } = require('./update-notes');

const STARTUP_DELAY_MS = 8 * 1000;
const CHECK_INTERVAL_MS = 60 * 60 * 1000; // re-check hourly while the app is open

function bundledRepo() {
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, 'update-config.json'), 'utf8')).repo || '';
  } catch (e) {
    return '';
  }
}

// Checks for updates at start and hourly. When one is found the UI shows the version and
// what changed and asks for confirmation; only after the user agrees does it download,
// install and restart. The update source is built into the app and never shown.
class UpdateManager {
  constructor({ store, send }) {
    this.store = store;
    this.send = send; // (channel, payload) => void, pushes status to the UI
    this.state = { state: 'idle', version: app.getVersion() };
    this.logPath = path.join(app.getPath('userData'), 'updater.log');
    this.autoUpdater = null;
    this.timer = null;
    this.busy = false;
    this.installAfterDownload = false;
  }

  log(message) {
    try {
      fs.appendFileSync(this.logPath, `${new Date().toISOString()}  ${message}\n`);
    } catch (e) { /* logging must never break the app */ }
  }

  setState(patch) {
    this.state = { ...this.state, ...patch, version: app.getVersion() };
    this.log(`state=${this.state.state}${this.state.message ? ` (${this.state.message})` : ''}${this.state.newVersion ? ` new=${this.state.newVersion}` : ''}`);
    this.send('updater:status', this.state);
  }

  // Lazy-load electron-updater so a problem in it can never stop the app starting.
  getUpdater() {
    if (this.autoUpdater) return this.autoUpdater;
    // eslint-disable-next-line global-require
    const { autoUpdater } = require('electron-updater');
    autoUpdater.autoDownload = false; // wait for the user's confirmation
    autoUpdater.autoInstallOnAppQuit = false;
    autoUpdater.allowPrerelease = false;
    autoUpdater.logger = {
      info: (m) => this.log(`info: ${m}`), warn: (m) => this.log(`warn: ${m}`), error: (m) => this.log(`error: ${m}`), debug: () => {},
    };

    autoUpdater.on('checking-for-update', () => this.setState({ state: 'checking', message: '' }));
    autoUpdater.on('update-available', (info) => this.setState({
      state: 'available', newVersion: info.version, notes: notesToText(info.releaseNotes), percent: 0, message: '', checkedAt: Date.now(),
    }));
    autoUpdater.on('update-not-available', () => this.setState({ state: 'none', newVersion: null, message: '', checkedAt: Date.now() }));
    autoUpdater.on('download-progress', (p) => this.setState({ state: 'downloading', percent: Math.round(p.percent || 0), message: '' }));
    autoUpdater.on('update-downloaded', (info) => {
      this.setState({ state: 'downloaded', newVersion: info.version, percent: 100, message: '', checkedAt: Date.now() });
      // The user already said yes to this update, so finish the job and restart.
      if (this.installAfterDownload) setTimeout(() => this.install(), 1500);
    });
    autoUpdater.on('error', (err) => {
      this.installAfterDownload = false;
      this.log(`error detail: ${err && err.message ? err.message.split('\n')[0] : err}`);
      this.setState({ state: 'error', message: friendlyError(err) });
    });

    this.autoUpdater = autoUpdater;
    return autoUpdater;
  }

  bundledRepo() { return bundledRepo(); }

  feed() {
    return resolveFeed('', bundledRepo()); // built-in source only; not user-editable
  }

  async check({ manual = false } = {}) {
    if (!app.isPackaged) {
      this.setState({ state: 'unavailable', manual, message: 'Updates only work in the installed app, not in development mode.' });
      return this.state;
    }
    if (['downloading', 'downloaded'].includes(this.state.state) || this.busy) return this.state;
    // Already found and waiting for an answer: show it again on a manual check, no network needed.
    if (this.state.state === 'available') {
      this.setState({ manual });
      return this.state;
    }

    const feed = this.feed();
    if (!feed) {
      this.setState({ state: 'unavailable', manual, message: 'Updates are not set up in this build.' });
      return this.state;
    }
    this.busy = true;
    this.state = { ...this.state, manual }; // carried into the status events below
    try {
      const updater = this.getUpdater();
      updater.setFeedURL(feed);
      this.log(`checking ${describeFeed(feed)}`);
      await updater.checkForUpdates();
    } catch (err) {
      this.setState({ state: 'error', manual, message: friendlyError(err) });
    } finally {
      this.busy = false;
    }
    return this.state;
  }

  // Called when the user confirms "Update now": download, then install and restart.
  async download() {
    if (this.state.state !== 'available') return this.state;
    this.installAfterDownload = true;
    this.setState({ state: 'downloading', percent: 0, message: '' });
    try {
      await this.getUpdater().downloadUpdate();
    } catch (err) {
      this.installAfterDownload = false;
      this.setState({ state: 'error', message: friendlyError(err) });
    }
    return this.state;
  }

  // Silent install, then relaunch the app automatically.
  install() {
    this.log('quitAndInstall requested');
    this.getUpdater().quitAndInstall(true, true);
  }

  // Background checks: shortly after launch, then every hour while the app is open.
  scheduleChecks() {
    if (!app.isPackaged || this.timer) return;
    const run = () => {
      const settings = this.store.getSettings();
      if (settings.autoCheckUpdates === false || !this.feed()) return;
      this.check({ manual: false });
    };
    setTimeout(run, STARTUP_DELAY_MS);
    this.timer = setInterval(run, CHECK_INTERVAL_MS);
    if (this.timer.unref) this.timer.unref();
  }

  // Backwards-compatible name used by main.js.
  scheduleStartupCheck() { this.scheduleChecks(); }
}

module.exports = { UpdateManager };
