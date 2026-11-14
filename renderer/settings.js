(function settingsTab() {
  const $ = (id) => document.getElementById(id);

  const BADGES = {
    idle: ['idle', 'Not checked'],
    checking: ['idle', 'Checking…'],
    none: ['ok', 'Up to date'],
    available: ['warn', 'Update available'],
    downloading: ['idle', 'Updating…'],
    downloaded: ['ok', 'Installing…'],
    error: ['error', 'Update failed'],
    unavailable: ['warn', 'Not available'],
  };

  let promptedVersion = null; // so the hourly background check doesn't nag about the same version
  let dialogOpen = false;

  function setBadge(level, text) {
    const el = $('updStatus');
    el.className = `badge badge-${level}`;
    el.querySelector('span').textContent = text;
  }

  // ---------- confirmation dialog ----------
  function openDialog(st) {
    dialogOpen = true;
    $('updateDialog').classList.remove('hidden');
    renderDialog(st);
  }

  function closeDialog() {
    dialogOpen = false;
    $('updateDialog').classList.add('hidden');
  }

  function renderDialog(st) {
    const state = st.state;
    const working = state === 'downloading' || state === 'downloaded';
    $('updDlgTitle').textContent = working ? 'Updating…' : 'Update available';
    $('updDlgVersions').innerHTML = `Version <strong class="mono">${esc(st.newVersion || '')}</strong> is available. You have <strong class="mono">${esc(st.version || '')}</strong>.`;
    const notes = (st.notes || '').trim();
    $('updDlgNotes').textContent = notes || 'No release notes were provided for this version.';

    $('updDlgTrack').classList.toggle('hidden', !working);
    $('updDlgFill').style.width = `${state === 'downloaded' ? 100 : st.percent || 0}%`;
    $('updDlgQuestion').classList.toggle('hidden', working || state === 'error');
    $('updDlgYes').classList.toggle('hidden', working || state === 'error');
    $('updDlgLater').classList.toggle('hidden', working);
    $('updDlgLater').textContent = state === 'error' ? 'Close' : 'Later';

    const messages = {
      downloading: `Downloading… ${st.percent || 0}%`,
      downloaded: 'Download complete. Restarting to finish the update…',
      error: st.message || 'The update could not be completed.',
    };
    $('updDlgMessage').textContent = messages[state] || '';
  }

  // ---------- settings card + sidebar chip ----------
  function render(st) {
    const state = st.state || 'idle';
    const [level, text] = BADGES[state] || BADGES.idle;
    setBadge(level, state === 'downloading' ? `Updating ${st.percent || 0}%` : text);

    const busy = ['checking', 'downloading', 'downloaded'].includes(state);
    $('updCheckBtn').disabled = busy;
    $('updDownloadBtn').classList.toggle('hidden', state !== 'available');
    $('updInstallBtn').classList.add('hidden');
    $('updProgressTrack').classList.add('hidden');

    const showNew = (state === 'available' || state === 'downloading' || state === 'downloaded') && st.newVersion;
    $('updNewWrap').classList.toggle('hidden', !showNew);
    $('updNew').textContent = st.newVersion || '';

    const messages = {
      none: `You’re on the latest version (${st.version}).`,
      available: `Version ${st.newVersion} is available.`,
      downloading: 'Downloading the update…',
      downloaded: 'Installing the update…',
      checking: 'Checking for updates…',
    };
    // Background failures stay quiet; a failure after the user clicked Check is shown.
    $('updMessage').textContent = state === 'error' && !st.manual ? '' : (st.message || messages[state] || '');

    if (st.checkedAt) $('updLast').textContent = new Date(st.checkedAt).toLocaleString();

    const chip = $('updateChip');
    const showChip = state === 'available';
    chip.classList.toggle('hidden', !showChip);
    if (showChip) chip.textContent = `Update ${st.newVersion || ''} available`;

    // Ask for confirmation when an update is found: always after a manual check,
    // and once per version for background checks.
    if (state === 'available' && !dialogOpen && (st.manual || promptedVersion !== st.newVersion)) {
      promptedVersion = st.newVersion;
      openDialog(st);
    } else if (dialogOpen) {
      if (['available', 'downloading', 'downloaded', 'error'].includes(state)) renderDialog(st);
      else closeDialog();
    }
  }

  async function init() {
    const info = await window.api.app.info();
    $('appVersion').textContent = `v${info.version}`;
    $('updVersion').textContent = info.version;

    const settings = await window.api.settings.get();
    $('updAuto').checked = settings.autoCheckUpdates !== false;
    $('updAuto').addEventListener('change', () => window.api.settings.set({ autoCheckUpdates: $('updAuto').checked }));

    $('updCheckBtn').addEventListener('click', async () => {
      render({ state: 'checking', version: info.version });
      render(await window.api.updater.check());
    });
    $('updDownloadBtn').addEventListener('click', async () => openDialog(await window.api.updater.status()));
    $('updateChip').addEventListener('click', async () => openDialog(await window.api.updater.status()));
    $('updDlgYes').addEventListener('click', () => { window.api.updater.download(); });
    $('updDlgLater').addEventListener('click', closeDialog);

    window.api.updater.onStatus(render);
    render(await window.api.updater.status());
  }

  window.SettingsTab = { init };
}());
