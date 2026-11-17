const net = require('net');

// A small "talk to a device" helper: connect, read whatever arrives until the line goes
// quiet, send something, read the reply. Answers Telnet option negotiation by declining
// everything, so Telnet-style consoles (Extron, AMX, Crestron) behave like plain sockets.
class Session {
  constructor(socket, { telnet = false } = {}) {
    this.socket = socket;
    this.telnet = telnet; // only text consoles get Telnet handling; binary protocols use 0xFF as data
    this.buffer = Buffer.alloc(0);
    this.closed = false;
    this.waiters = [];
    socket.on('data', (chunk) => {
      this.buffer = Buffer.concat([this.buffer, this.telnet ? this.stripTelnet(chunk) : chunk]);
      this.waiters.forEach((w) => w());
    });
    const end = () => { this.closed = true; this.waiters.forEach((w) => w()); };
    socket.on('close', end);
    socket.on('error', end);
  }

  static open(ip, port, timeoutMs = 2500, options = {}) {
    return new Promise((resolve, reject) => {
      const socket = new net.Socket();
      socket.setNoDelay(true);
      socket.setTimeout(timeoutMs);
      socket.once('timeout', () => { socket.destroy(); reject(new Error('timed out')); });
      socket.once('error', (err) => reject(err));
      socket.connect(port, ip, () => {
        socket.setTimeout(0);
        socket.removeAllListeners('timeout');
        socket.removeAllListeners('error');
        resolve(new Session(socket, options));
      });
    });
  }

  // IAC (0xFF) sequences: reply WONT/DONT to every option, drop them from the data.
  stripTelnet(chunk) {
    if (!chunk.includes(0xff)) return chunk;
    const out = [];
    const reply = [];
    for (let i = 0; i < chunk.length; i += 1) {
      const b = chunk[i];
      if (b !== 0xff) { out.push(b); continue; }
      const cmd = chunk[i + 1];
      if (cmd === 0xff) { out.push(0xff); i += 1; continue; }
      if (cmd >= 0xfb && cmd <= 0xfe) {
        const opt = chunk[i + 2];
        if (opt !== undefined) reply.push(0xff, cmd === 0xfd || cmd === 0xfe ? 0xfc : 0xfe, opt); // DO/DONT -> WONT, WILL/WONT -> DONT
        i += 2; continue;
      }
      if (cmd === 0xfa) { // subnegotiation: skip to IAC SE
        let j = i + 2;
        while (j < chunk.length - 1 && !(chunk[j] === 0xff && chunk[j + 1] === 0xf0)) j += 1;
        i = j + 1; continue;
      }
      i += 1;
    }
    if (reply.length && !this.closed) this.socket.write(Buffer.from(reply));
    return Buffer.from(out);
  }

  // Resolves with everything received once nothing new has arrived for quietMs
  // (or maxMs passed, or the device hung up). `until` (RegExp) returns early on a match.
  read({ quietMs = 350, maxMs = 2500, until } = {}) {
    return new Promise((resolve) => {
      const started = Date.now();
      let quietTimer = null;
      let maxTimer = null;
      const done = () => {
        clearTimeout(quietTimer); clearTimeout(maxTimer);
        this.waiters = this.waiters.filter((w) => w !== onData);
        const data = this.buffer;
        this.buffer = Buffer.alloc(0);
        resolve(data);
      };
      const onData = () => {
        if (this.closed) { done(); return; }
        if (until && until.test(this.buffer.toString('latin1'))) { done(); return; }
        clearTimeout(quietTimer);
        quietTimer = setTimeout(done, quietMs);
      };
      this.waiters.push(onData);
      maxTimer = setTimeout(done, maxMs);
      if (this.closed) { done(); return; }
      if (this.buffer.length) onData();
      else if (Date.now() - started >= maxMs) done();
    });
  }

  send(data) {
    if (this.closed) return;
    this.socket.write(typeof data === 'string' ? Buffer.from(data, 'latin1') : data);
  }

  async ask(data, options) {
    this.buffer = Buffer.alloc(0);
    this.send(data);
    return this.read(options);
  }

  async askText(data, options) {
    return (await this.ask(data, options)).toString('latin1');
  }

  close() {
    this.closed = true;
    this.socket.destroy();
  }
}

module.exports = { Session };
