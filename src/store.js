const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DEFAULT_DATA = {
  devices: [],
  mappings: {},
  settings: {
    heartbeatInterval: 10000,
    heartbeatMethod: 'tcp',
    theme: 'dark',
    updateUrl: '',
    autoCheckUpdates: true,
  },
};

// Everything is kept in one small JSON file under the OS's per-app data
// directory. Fine for the device counts an AV closet deals with; swap this
// class for a SQLite-backed one later without touching any of the IPC code.
class Store {
  constructor(userDataPath) {
    this.filePath = path.join(userDataPath, 'av-control-data.json');
    this.data = this.load();
  }

  load() {
    try {
      const raw = fs.readFileSync(this.filePath, 'utf8');
      const parsed = JSON.parse(raw);
      return { ...DEFAULT_DATA, ...parsed, settings: { ...DEFAULT_DATA.settings, ...parsed.settings } };
    } catch (e) {
      return JSON.parse(JSON.stringify(DEFAULT_DATA));
    }
  }

  save() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), 'utf8');
  }

  listDevices() {
    return this.data.devices;
  }

  addDevice(device) {
    const record = {
      id: crypto.randomUUID(),
      name: device.name || 'Untitled device',
      ip: device.ip,
      port: parseInt(device.port, 10),
      protocol: device.protocol === 'udp' ? 'udp' : 'tcp',
      room: device.room || '',
      status: 'unknown',
      lastSeen: null,
    };
    this.data.devices.push(record);
    this.save();
    return record;
  }

  updateDevice(id, patch) {
    const device = this.data.devices.find((d) => d.id === id);
    if (!device) return null;
    Object.assign(device, patch);
    this.save();
    return device;
  }

  removeDevice(id) {
    this.data.devices = this.data.devices.filter((d) => d.id !== id);
    delete this.data.mappings[id];
    this.save();
  }

  getMapping(deviceId) {
    return this.data.mappings[deviceId] || null;
  }

  setMapping(deviceId, mapping) {
    this.data.mappings[deviceId] = mapping;
    this.save();
    return mapping;
  }

  getSettings() {
    return this.data.settings;
  }

  setSettings(patch) {
    this.data.settings = { ...this.data.settings, ...patch };
    this.save();
    return this.data.settings;
  }
}

module.exports = { Store };
