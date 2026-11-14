const net = require('net');

// Opens a TCP connection, writes `data`, and collects whatever comes back
// within a short response window (resetting the window each time a new
// chunk arrives, so multi-packet responses get coalesced into one entry).
function sendTcp({
  ip, port, data, connectTimeoutMs = 3000, responseWindowMs = 800,
}) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;
    const chunks = [];
    let responseTimer = null;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(responseTimer);
      socket.destroy();
      resolve(result);
    };

    socket.setTimeout(connectTimeoutMs);
    socket.once('timeout', () => finish({ success: false, error: 'Connection timed out', response: Buffer.alloc(0) }));
    socket.once('error', (err) => finish({ success: false, error: err.message, response: Buffer.alloc(0) }));

    socket.connect(port, ip, () => {
      socket.setTimeout(0);
      if (data && data.length) socket.write(data);

      socket.on('data', (chunk) => {
        chunks.push(chunk);
        clearTimeout(responseTimer);
        responseTimer = setTimeout(() => {
          finish({ success: true, error: null, response: Buffer.concat(chunks) });
        }, 150);
      });

      responseTimer = setTimeout(() => {
        finish({ success: true, error: null, response: Buffer.concat(chunks) });
      }, responseWindowMs);
    });
  });
}

// Cheap "is this port open" probe used by the subnet scanner.
function probeTcp({ ip, port, timeoutMs = 500 }) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
    socket.connect(port, ip, () => finish(true));
  });
}

// Same idea as probeTcp but distinguishes "timed out" (unresponsive) from
// "actively refused" (offline) for the heartbeat monitor.
function checkTcpStatus({ ip, port, timeoutMs = 1500 }) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;
    const finish = (status) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(status);
    };
    socket.setTimeout(timeoutMs);
    socket.once('timeout', () => finish('unresponsive'));
    socket.once('error', () => finish('offline'));
    socket.connect(port, ip, () => finish('online'));
  });
}

module.exports = { sendTcp, probeTcp, checkTcpStatus };
