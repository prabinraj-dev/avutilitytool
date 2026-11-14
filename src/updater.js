const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const { resolveFeed, describeFeed } = require('./update-source');

const STARTUP_DELAY_MS = 8 * 1000;
const CHECK_INTERVAL_MS = 60 * 60 * 1000; // re-check hourly while the app is open

function bundledRepo() {
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, 'update-config.json'), 'utf8')).repo || '';
  } catch (e) {
    return '';
  }
}

// Fully automatic updates: check at start and hourly, download in the background,
// install when the app is closed, or right away if the user clicks "Restart now".
class UpdateManager {
  constructor({ store, send }) {
    this.store = store;
    this.send = send; // (channel, payload) => void, pushes status to the UI
    this.state = { state: 'idle', version: app.getVersion() };
    this.logPath = path.join(app.getPath('userData'), 'updater.log');
    this.autoUpdater = null;
    this.timer = null;
    this.busy = false;
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
    autoUpdater.autoDownload = true; // no click needed: new versions download by themselves
    autoUpdater.autoInstallOnAppQuit = true; // and install when the app is closed
    autoUpdater.allowPrerelease = false;
    autoUpdater.logger = {
      info: (m) => this.log(`info: ${m}`), warn: (m) => this.log(`warn: ${m}`), error: (m) => this.log(`error: ${m}`), debug: () => {},
    };

    autoUpdater.on('checking-for-update', () => this.setState({ state: 'checking', message: '' }));
    autoUpdater.on('update-available', (info) => this.setState({ state: 'downloading', newVersion: info.version, percent: 0, message: '' }));
    autoUpdater.on('update-not-available', () => this.setState({ state: 'none', newVersion: null, message: '', checkedAt: Date.now() }));
    autoUpdater.on('download-progress', (p) => this.setState({ state: 'downloading', percent: Math.round(p.percent || 0), message: '' }));
    autoUpdater.on('update-downloaded', (info) => this.setState({ state: 'downloaded', newVersion: info.version, percent: 100, message: '', checkedAt: Date.now() }));
    autoUpdater.on('error', (err) => this.setState({ state: 'error', message: (err && err.message ? err.message : String(err)).split('\n')[0].slice(0, 200) }));

    this.autoUpdater = autoUpdater;
    return autoUpdater;
  }

  bundledRepo() { return bundledRepo(); }

  feed() {
    return resolveFeed(this.store.getSettings().updateUrl, bundledRepo());
  }

  async check() {
    if (!app.isPackaged) {
      this.setState({ state: 'unavailable', message: 'Updates only work in the installed app, not in development mode.' });
      return this.state;
    }
    // A downloaded update is waiting for a restart: nothing more to fetch.
    if (this.state.state === 'downloaded' || this.state.state === 'downloading') return this.state;
    if (this.busy) return this.state;

    const feed = this.feed();
    if (!feed) {
      this.setState({ state: 'unavailable', message: 'No update source is set. Enter your GitHub repository (owner/repo) in Settings.' });
      return this.state;
    }
    this.busy = true;
    try {
      const updater = this.getUpdater();
      updater.setFeedURL(feed);
      this.log(`checking ${describeFeed(feed)}`);
      await updater.checkForUpdates();
    } catch (err) {
      this.setState({ state: 'error', message: (err && err.message ? err.message : String(err)).split('\n')[0].slice(0, 200) });
    } finally {
      this.busy = false;
    }
    return this.state;
  }

  // Kept for the manual "Download" path if a download was interrupted.
  async download() {
    try {
      await this.getUpdater().downloadUpdate();
    } catch (err) {
      this.setState({ state: 'error', message: (err && err.message ? err.message : String(err)).split('\n')[0].slice(0, 200) });
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
      this.check();
    };
    setTimeout(run, STARTUP_DELAY_MS);
    this.timer = setInterval(run, CHECK_INTERVAL_MS);
    if (this.timer.unref) this.timer.unref();
  }

  // Backwards-compatible name used by main.js.
  scheduleStartupCheck() { this.scheduleChecks(); }
}

module.exports = { UpdateManager };
