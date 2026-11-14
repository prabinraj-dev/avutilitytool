const dgram = require('dgram');

// Sends one datagram and waits a short window for any reply. UDP is
// connectionless, so "success" here just means the send didn't error --
// a device that never replies still reports success with an empty response.
function sendUdp({ ip, port, data, responseWindowMs = 800 }) {
  return new Promise((resolve) => {
    const socket = dgram.createSocket('udp4');
    let settled = false;
    const chunks = [];
    let timer = null;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.close();
      resolve(result);
    };

    socket.once('error', (err) => finish({ success: false, error: err.message, response: Buffer.alloc(0) }));

    socket.on('message', (msg) => {
      chunks.push(msg);
      clearTimeout(timer);
      timer = setTimeout(() => finish({ success: true, error: null, response: Buffer.concat(chunks) }), 150);
    });

    socket.send(data || Buffer.alloc(0), port, ip, (err) => {
      if (err) {
        finish({ success: false, error: err.message, response: Buffer.alloc(0) });
        return;
      }
      timer = setTimeout(() => finish({ success: true, error: null, response: Buffer.concat(chunks) }), responseWindowMs);
    });
  });
}

// Best-effort UDP reachability probe for the heartbeat monitor: sends an
// empty datagram and treats an immediate send error as "offline". There is
// no reliable "unresponsive" signal for connectionless UDP.
function probeUdp(ip, port, timeoutMs) {
  return new Promise((resolve) => {
    const socket = dgram.createSocket('udp4');
    let settled = false;
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      socket.close();
      resolve(ok);
    };
    const timer = setTimeout(() => finish(true), timeoutMs);
    socket.once('error', () => {
      clearTimeout(timer);
      finish(false);
    });
    socket.send(Buffer.alloc(0), port, ip, (err) => {
      if (err) {
        clearTimeout(timer);
        finish(false);
      }
    });
  });
}

module.exports = { sendUdp, probeUdp };
