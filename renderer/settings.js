(function settingsTab() {
  const $ = (id) => document.getElementById(id);

  const BADGES = {
    idle: ['idle', 'Not checked'],
    checking: ['idle', 'Checking\u2026'],
    none: ['ok', 'Up to date'],
    available: ['warn', 'Update available'],
    downloading: ['idle', 'Downloading update\u2026'],
    downloaded: ['ok', 'Ready to install'],
    error: ['error', 'Check failed'],
    unavailable: ['warn', 'Not available'],
  };

  function setBadge(level, text) {
    const el = $('updStatus');
    el.className = `badge badge-${level}`;
    el.querySelector('span').textContent = text;
  }

  let bannerDismissed = false;

  function render(st) {
    const state = st.state || 'idle';
    const [level, text] = BADGES[state] || BADGES.idle;
    setBadge(level, state === 'downloading' ? `Downloading ${st.percent || 0}%` : text);

    const busy = state === 'checking' || state === 'downloading';
    $('updCheckBtn').disabled = busy;
    // Downloads start by themselves; the button only appears if one needs retrying.
    $('updDownloadBtn').classList.toggle('hidden', state !== 'available');
    $('updInstallBtn').classList.toggle('hidden', state !== 'downloaded');

    $('updProgressTrack').classList.toggle('hidden', state !== 'downloading');
    $('updProgressFill').style.width = `${st.percent || 0}%`;

    const showNew = (state === 'available' || state === 'downloaded' || state === 'downloading') && st.newVersion;
    $('updNewWrap').classList.toggle('hidden', !showNew);
    $('updNew').textContent = st.newVersion || '';

    const messages = {
      none: 'You\u2019re on the latest version.',
      available: `Version ${st.newVersion} is available.`,
      downloading: `Downloading version ${st.newVersion || ''} in the background\u2026`,
      downloaded: `Version ${st.newVersion} is downloaded. It installs when you close the app, or restart now \u2014 your devices and mappings are kept.`,
      checking: 'Contacting the update server\u2026',
    };
    $('updMessage').textContent = st.message || messages[state] || '';

    if (st.checkedAt) $('updLast').textContent = new Date(st.checkedAt).toLocaleString();

    // Banner so a ready update is noticed from any tab.
    const banner = $('updateBanner');
    const showBanner = state === 'downloaded' && !bannerDismissed;
    banner.classList.toggle('hidden', !showBanner);
    if (showBanner) $('updateBannerText').textContent = `Version ${st.newVersion} is ready to install.`;

    // Sidebar hint so an available update is noticed from any tab.
    const chip = $('updateChip');
    const chipText = { available: `Update ${st.newVersion || ''} available`, downloaded: 'Restart to update' }[state];
    chip.classList.toggle('hidden', !chipText);
    if (chipText) chip.textContent = chipText;
  }

  async function saveUrl() {
    await window.api.settings.set({ updateUrl: $('updUrl').value.trim() });
  }

  async function init() {
    const info = await window.api.app.info();
    $('appVersion').textContent = `v${info.version}`;
    $('updVersion').textContent = info.version;

    const settings = await window.api.settings.get();
    $('updUrl').value = settings.updateUrl || '';
    if (info.bundledRepo) $('updUrl').placeholder = `${info.bundledRepo} (built in)`;
    $('updAuto').checked = settings.autoCheckUpdates !== false;

    $('updUrl').addEventListener('change', saveUrl);
    $('updAuto').addEventListener('change', () => window.api.settings.set({ autoCheckUpdates: $('updAuto').checked }));

    $('updCheckBtn').addEventListener('click', async () => {
      await saveUrl();
      render({ state: 'checking' });
      render(await window.api.updater.check());
    });
    $('updDownloadBtn').addEventListener('click', async () => {
      render({ state: 'downloading', percent: 0 });
      await window.api.updater.download();
    });
    $('updInstallBtn').addEventListener('click', () => window.api.updater.install());
    $('updateBannerRestart').addEventListener('click', () => window.api.updater.install());
    $('updateBannerLater').addEventListener('click', () => { bannerDismissed = true; $('updateBanner').classList.add('hidden'); });
    $('updateChip').addEventListener('click', () => switchTab('settings'));

    window.api.updater.onStatus(render);
    render(await window.api.updater.status());
  }

  window.SettingsTab = { init };
}());
