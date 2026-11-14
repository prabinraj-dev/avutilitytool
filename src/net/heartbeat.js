const { EventEmitter } = require('events');
const { checkTcpStatus } = require('./tcp');
const { probeUdp } = require('./udp');
const { pingHost } = require('./ping');

// Polls every known device on a fixed interval and emits a 'status' event
// whenever a device's reachability changes (or on every successful check,
// so "last seen" keeps advancing while a device stays online).
class HeartbeatManager extends EventEmitter {
  constructor() {
    super();
    this.timer = null;
    this.intervalMs = 10000;
    this.method = 'tcp'; // 'tcp' | 'udp' | 'icmp'
    this.timeoutMs = 1500;
    this.getDevices = () => [];
    this.inFlight = false;
  }

  configure({
    intervalMs, method, getDevices, timeoutMs,
  } = {}) {
    if (intervalMs) this.intervalMs = intervalMs;
    if (method) this.method = method;
    if (getDevices) this.getDevices = getDevices;
    if (timeoutMs) this.timeoutMs = timeoutMs;
    if (this.timer) {
      this.stop();
      this.start();
    }
  }

  async checkOne(device) {
    try {
      if (this.method === 'icmp') {
        return (await pingHost(device.ip, this.timeoutMs)) ? 'online' : 'offline';
      }
      if (device.protocol === 'udp' || this.method === 'udp') {
        return (await probeUdp(device.ip, device.port, this.timeoutMs)) ? 'online' : 'offline';
      }
      return await checkTcpStatus({ ip: device.ip, port: device.port, timeoutMs: this.timeoutMs });
    } catch (e) {
      return 'offline';
    }
  }

  async tick() {
    if (this.inFlight) return; // don't stack sweeps if one is still running
    this.inFlight = true;
    const devices = this.getDevices() || [];
    await Promise.all(devices.map(async (device) => {
      const status = await this.checkOne(device);
      this.emit('status', {
        id: device.id,
        status,
        lastSeen: status === 'online' ? Date.now() : device.lastSeen || null,
      });
    }));
    this.inFlight = false;
  }

  start() {
    if (this.timer) return;
    this.tick();
    this.timer = setInterval(() => this.tick(), this.intervalMs);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}

module.exports = { HeartbeatManager };
