const { execFile } = require('child_process');
const os = require('os');

// Uses the OS `ping` command so no elevated privileges are needed. Success is
// decided by looking for a TTL in the output rather than trusting the exit
// code alone: on Windows, "Destination host unreachable" replies from a
// gateway still exit with code 0.
function pingHost(ip, timeoutMs = 1000) {
  return new Promise((resolve) => {
    const platform = os.platform();
    let args;
    if (platform === 'win32') args = ['-n', '1', '-w', String(timeoutMs), ip];
    else if (platform === 'darwin') args = ['-c', '1', '-W', String(timeoutMs), ip];
    else args = ['-c', '1', '-W', String(Math.max(1, Math.ceil(timeoutMs / 1000))), ip];

    execFile('ping', args, { windowsHide: true, timeout: timeoutMs + 2500 }, (err, stdout) => {
      const out = String(stdout || '');
      if (/ttl[=:]/i.test(out)) { resolve(true); return; }
      resolve(platform !== 'win32' && !err);
    });
  });
}

// Reads the OS ARP cache and returns { "192.168.1.20": "AA:BB:CC:DD:EE:FF" }.
// After a ping/connect sweep the cache holds a MAC for every host on the
// local subnet that answered at layer 2.
function readArpTable() {
  return new Promise((resolve) => {
    execFile('arp', ['-a'], { windowsHide: true, timeout: 5000 }, (err, stdout) => {
      const table = {};
      String(stdout || '').split(/\r?\n/).forEach((line) => {
        const m = line.match(/(\d{1,3}(?:\.\d{1,3}){3})\D+?([0-9a-f]{1,2}(?:[:-][0-9a-f]{1,2}){5})/i);
        if (!m) return;
        const mac = m[2].split(/[:-]/).map((b) => b.padStart(2, '0')).join(':').toUpperCase();
        if (mac === 'FF:FF:FF:FF:FF:FF' || mac === '00:00:00:00:00:00') return;
        table[m[1]] = mac;
      });
      resolve(table);
    });
  });
}

module.exports = { pingHost, readArpTable };
