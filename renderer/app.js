// Escapes text before it goes into an innerHTML template.
function esc(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function switchTab(tabId) {
  document.querySelectorAll('.nav-item').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.tab === tabId);
  });
  document.querySelectorAll('.tab').forEach((section) => {
    section.classList.toggle('active', section.id === `tab-${tabId}`);
  });
  document.dispatchEvent(new CustomEvent('tabchange', { detail: { tabId } }));
}

document.querySelectorAll('.nav-item').forEach((btn) => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});

// Tiny shared store so the tabs stay in sync without a framework.
const AppState = {
  devices: [],
  listeners: [],
  setDevices(devices) {
    this.devices = devices;
    this.listeners.forEach((fn) => fn(this.devices));
  },
  onDevicesChange(fn) {
    this.listeners.push(fn);
  },
  updateDeviceStatus(id, status, lastSeen) {
    const device = this.devices.find((d) => d.id === id);
    if (!device) return;
    device.status = status;
    device.lastSeen = lastSeen;
    this.listeners.forEach((fn) => fn(this.devices));
  },
};

function updateStatusSummary() {
  const devices = AppState.devices;
  const online = devices.filter((d) => d.status === 'online').length;
  document.getElementById('statusSummary').textContent = devices.length
    ? `${online} / ${devices.length} online`
    : 'No devices yet';
}
AppState.onDevicesChange(updateStatusSummary);

async function refreshDevices() {
  const devices = await window.api.devices.list();
  AppState.setDevices(devices);
  return devices;
}

window.api.devices.onStatusUpdate(({ id, status, lastSeen }) => {
  AppState.updateDeviceStatus(id, status, lastSeen);
});

// ---------- collapsible panels (state remembered between launches) ----------
const COLLAPSE_KEY = 'avcs.collapsedPanels';

function loadCollapsed() {
  try { return JSON.parse(localStorage.getItem(COLLAPSE_KEY)) || {}; } catch (e) { return {}; }
}

function setPanelCollapsed(panel, collapsed, persist = true) {
  panel.classList.toggle('collapsed', collapsed);
  const toggle = panel.querySelector('.collapse-toggle');
  if (toggle) {
    toggle.textContent = collapsed ? 'Show' : 'Hide';
    toggle.setAttribute('aria-expanded', String(!collapsed));
  }
  if (persist) {
    try {
      const state = loadCollapsed();
      state[panel.dataset.collapseId] = collapsed;
      localStorage.setItem(COLLAPSE_KEY, JSON.stringify(state));
    } catch (e) { /* not persisted */ }
  }
}

function initCollapsibles() {
  const saved = loadCollapsed();
  document.querySelectorAll('.panel.collapsible').forEach((panel) => {
    setPanelCollapsed(panel, !!saved[panel.dataset.collapseId], false);
    panel.querySelector('.collapse-toggle').addEventListener('click', () => {
      setPanelCollapsed(panel, !panel.classList.contains('collapsed'));
    });
  });
}

// ---------- dark / light theme ----------
function showTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  document.querySelectorAll('[data-theme-choice]').forEach((btn) => {
    btn.setAttribute('aria-pressed', String(btn.dataset.themeChoice === theme));
  });
}

function initTheme() {
  showTheme(window.api.theme.initial === 'light' ? 'light' : 'dark');
  document.querySelectorAll('[data-theme-choice]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      showTheme(btn.dataset.themeChoice); // instant
      await window.api.theme.set(btn.dataset.themeChoice); // persist + native colors
    });
  });
}

window.addEventListener('DOMContentLoaded', async () => {
  initTheme();
  initCollapsibles();
  await refreshDevices();

  const settings = await window.api.settings.get();
  const heartbeatSelect = document.getElementById('heartbeatInterval');
  heartbeatSelect.value = String(settings.heartbeatInterval);
  heartbeatSelect.addEventListener('change', (e) => {
    window.api.heartbeat.configure({ intervalMs: parseInt(e.target.value, 10) });
  });

  ['DevicesTab', 'ConsoleTab', 'ControlTab', 'DeviceTestTab', 'SettingsTab'].forEach((name) => {
    if (window[name]) window[name].init();
  });
});
