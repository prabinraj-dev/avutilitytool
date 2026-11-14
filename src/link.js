const net = require('net');
const dgram = require('dgram');
const { toHexView, toAsciiView } = require('./net/encode');

const RX_COALESCE_MS = 40; // merge back-to-back chunks into one log line

// One live connection at a time (like Hercules): TCP client, UDP, or serial port.
// `emit(channel, payload)` pushes data/status to the UI.
class LinkManager {
  constructor({ emit, loadSerial }) {
    this.emit = emit;
    this.loadSerial = loadSerial || (() => require('serialport'));
    this.link = null; // { kind, label, close(), write(buf, opts), ... }
    this.status = { state: 'closed', kind: null, label: '', lines: null };
    this.rx = { chunks: [], timer: null, from: '' };
  }

  setStatus(patch) {
    this.status = { ...this.status, ...patch };
    this.emit('link:status', this.status);
  }

  flushRx() {
    clearTimeout(this.rx.timer);
    this.rx.timer = null;
    if (!this.rx.chunks.length) return;
    const data = Buffer.concat(this.rx.chunks);
    const from = this.rx.from;
    this.rx = { chunks: [], timer: null, from: '' };
    this.emit('link:data', {
      direction: 'in', hex: toHexView(data), ascii: toAsciiView(data), bytes: data.length, from, timestamp: Date.now(),
    });
  }

  onRx(chunk, from = '') {
    if (this.rx.chunks.length && from !== this.rx.from) this.flushRx();
    this.rx.from = from;
    this.rx.chunks.push(Buffer.from(chunk));
    clearTimeout(this.rx.timer);
    this.rx.timer = setTimeout(() => this.flushRx(), RX_COALESCE_MS);
  }

  // ---------- serial discovery ----------
  async listSerial() {
    try {
      const { SerialPort } = this.loadSerial();
      const ports = await SerialPort.list();
      return ports
        .map((p) => ({
          path: p.path,
          description: [p.friendlyName || p.manufacturer, p.vendorId && p.productId ? `${p.vendorId}:${p.productId}` : '']
            .filter(Boolean).join(' '),
        }))
        .sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true }));
    } catch (e) {
      return [];
    }
  }

  // ---------- open / close ----------
  async open(cfg) {
    if (this.link) await this.close();
    this.setStatus({ state: 'opening', kind: cfg.kind, label: '', error: '' });
    try {
      if (cfg.kind === 'tcp') this.link = await this.openTcp(cfg);
      else if (cfg.kind === 'udp') this.link = await this.openUdp(cfg);
      else if (cfg.kind === 'serial') this.link = await this.openSerial(cfg);
      else throw new Error('Unknown connection type');
      this.setStatus({ state: 'open', kind: cfg.kind, label: this.link.label, error: '' });
      return { success: true, label: this.link.label };
    } catch (err) {
      this.link = null;
      this.setStatus({ state: 'closed', kind: cfg.kind, label: '', error: err.message, lines: null });
      return { success: false, error: err.message };
    }
  }

  async close() {
    const link = this.link;
    this.link = null;
    this.flushRx();
    if (link) {
      try { await link.close(); } catch (e) { /* already gone */ }
    }
    this.setStatus({ state: 'closed', label: '', lines: null });
    return true;
  }

  lostLink(reason) {
    if (!this.link) return;
    this.link = null;
    this.flushRx();
    this.setStatus({ state: 'closed', label: '', error: reason, lines: null });
  }

  // ---------- TCP ----------
  openTcp({ ip, port }) {
    const p = Number(port);
    if (!ip) return Promise.reject(new Error('Enter the device IP address'));
    if (!Number.isInteger(p) || p < 1 || p > 65535) return Promise.reject(new Error('Port must be 1-65535'));
    return new Promise((resolve, reject) => {
      const socket = new net.Socket();
      socket.setNoDelay(true);
      socket.setTimeout(4000);
      socket.once('timeout', () => { socket.destroy(); reject(new Error(`Connection to ${ip}:${p} timed out`)); });
      socket.once('error', (err) => reject(new Error(err.code === 'ECONNREFUSED' ? `${ip}:${p} refused the connection` : err.message)));
      socket.connect(p, ip, () => {
        socket.setTimeout(0);
        socket.removeAllListeners('timeout');
        socket.removeAllListeners('error');
        socket.setKeepAlive(true, 15000);
        socket.on('data', (d) => this.onRx(d));
        socket.on('error', (err) => this.lostLink(err.message));
        socket.on('close', () => this.lostLink('Connection closed by the device'));
        resolve({
          kind: 'tcp',
          label: `TCP ${ip}:${p}`,
          write: (buf) => new Promise((res, rej) => socket.write(buf, (e) => (e ? rej(e) : res()))),
          close: () => new Promise((res) => { socket.removeAllListeners('close'); socket.end(); setTimeout(() => { socket.destroy(); res(); }, 100); }),
        });
      });
    });
  }

  // ---------- UDP ----------
  openUdp({ ip, port, localPort, broadcast }) {
    const p = Number(port);
    const lp = localPort === '' || localPort == null ? 0 : Number(localPort);
    if (!broadcast && !ip) return Promise.reject(new Error('Enter the device IP address'));
    if (!Number.isInteger(p) || p < 1 || p > 65535) return Promise.reject(new Error('Port must be 1-65535'));
    if (!Number.isInteger(lp) || lp < 0 || lp > 65535) return Promise.reject(new Error('Local port must be 0-65535'));
    return new Promise((resolve, reject) => {
      const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
      socket.once('error', (err) => {
        try { socket.close(); } catch (e) { /* not open */ }
        reject(new Error(err.code === 'EADDRINUSE' ? `Local port ${lp} is already in use` : err.message));
      });
      socket.bind(lp, () => {
        socket.removeAllListeners('error');
        if (broadcast) socket.setBroadcast(true);
        socket.on('message', (msg, rinfo) => this.onRx(msg, `${rinfo.address}:${rinfo.port}`));
        socket.on('error', (err) => this.lostLink(err.message));
        const target = broadcast && !ip ? '255.255.255.255' : ip;
        const bound = socket.address().port;
        resolve({
          kind: 'udp',
          label: `UDP ${target}:${p} (listening on ${bound})`,
          write: (buf) => new Promise((res, rej) => socket.send(buf, p, target, (e) => (e ? rej(e) : res()))),
          close: () => new Promise((res) => { try { socket.close(() => res()); } catch (e) { res(); } }),
        });
      });
    });
  }

  // ---------- Serial ----------
  openSerial(cfg) {
    let SerialPort;
    try {
      ({ SerialPort } = this.loadSerial());
    } catch (e) {
      return Promise.reject(new Error('Serial support could not be loaded on this PC'));
    }
    if (!cfg.path) return Promise.reject(new Error('Choose a COM port'));
    const handshake = cfg.handshake || 'none';
    const options = {
      path: cfg.path,
      baudRate: Number(cfg.baudRate) || 9600,
      dataBits: Number(cfg.dataBits) || 8,
      parity: cfg.parity || 'none',
      stopBits: Number(cfg.stopBits) || 1,
      rtscts: handshake === 'rtscts',
      xon: handshake === 'xonxoff',
      xoff: handshake === 'xonxoff',
      autoOpen: false,
    };
    return new Promise((resolve, reject) => {
      const port = new SerialPort(options);
      port.open((err) => {
        if (err) {
          const msg = /Access denied|busy|in use/i.test(err.message) ? `${cfg.path} is in use by another program` : err.message;
          reject(new Error(msg));
          return;
        }
        port.on('data', (d) => this.onRx(d));
        port.on('error', (e) => this.lostLink(e.message));
        port.on('close', () => this.lostLink(`${cfg.path} was disconnected`));

        // Modem-line lights (CD / RI / DSR / CTS), like Hercules.
        const poll = setInterval(() => {
          if (!port.isOpen) return;
          port.get((e, s) => {
            if (!e && s && this.link && this.link.kind === 'serial') {
              const next = { cd: !!s.dcd, ri: !!s.ri, dsr: !!s.dsr, cts: !!s.cts };
              const prev = this.status.lines || {};
              if (['cd', 'ri', 'dsr', 'cts'].some((k) => prev[k] !== next[k])) this.setStatus({ lines: { ...prev, ...next } });
            }
          });
        }, 500);
        if (poll.unref) poll.unref();

        resolve({
          kind: 'serial',
          label: `${cfg.path} ${options.baudRate} ${options.dataBits}${options.parity[0].toUpperCase()}${options.stopBits}`,
          write: (buf) => new Promise((res, rej) => port.write(buf, (e) => (e ? rej(e) : port.drain(() => res())))),
          setLine: (line, on) => new Promise((res, rej) => port.set({ [line]: on }, (e) => (e ? rej(e) : res()))),
          close: () => new Promise((res) => {
            clearInterval(poll);
            port.removeAllListeners('close');
            if (port.isOpen) port.close(() => res()); else res();
          }),
        });
      });
    });
  }

  // ---------- transmit ----------
  async send(buffer) {
    if (!this.link) return { success: false, error: 'Not connected — press Connect first' };
    try {
      await this.link.write(buffer);
      return {
        success: true,
        sentHex: toHexView(buffer),
        sentAscii: toAsciiView(buffer),
        bytes: buffer.length,
        timestamp: Date.now(),
      };
    } catch (err) {
      return { success: false, error: err.message, sentHex: toHexView(buffer), sentAscii: toAsciiView(buffer), timestamp: Date.now() };
    }
  }

  async setLine(line, on) {
    if (!this.link || !this.link.setLine) return { success: false, error: 'Only available on an open serial port' };
    try {
      await this.link.setLine(line === 'dtr' ? 'dtr' : 'rts', !!on);
      this.setStatus({ lines: { ...(this.status.lines || {}), [line]: !!on } });
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }
}

module.exports = { LinkManager };
