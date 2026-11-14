const os = require('os');
const dns = require('dns').promises;
const { probeTcp } = require('./tcp');
const { pingHost, readArpTable } = require('./ping');

// Ports checked when the user leaves the port box empty. Covers the control
// ports most AV gear listens on.
const COMMON_AV_PORTS = [
  [22, 'SSH'], [23, 'Telnet'], [80, 'HTTP'], [443, 'HTTPS'],
  [1319, 'AMX'], [1515, 'Samsung MDC'], [1702, 'Q-SYS'], [1710, 'Q-SYS'],
  [2202, 'Shure'], [3629, 'Epson ESC/VP.net'], [4352, 'PJLink'],
  [5000, 'Kramer / generic'], [5678, 'PTZ VISCA'], [7142, 'NEC projector'],
  [8080, 'HTTP alt'], [9761, 'LG display'], [20060, 'Sony BRAVIA'],
  [22023, 'Extron SSH'], [41794, 'Crestron CIP'], [41795, 'Crestron console'],
];
const SERVICE_NAMES = Object.fromEntries(COMMON_AV_PORTS);
const DEFAULT_PORTS = [...new Set(COMMON_AV_PORTS.map(([p]) => p))];

const MAX_HOSTS = 4094;
const MAX_PORTS = 200;

function ipToInt(ip) {
  return ip.split('.').reduce((acc, octet) => (acc << 8) + parseInt(octet, 10), 0) >>> 0;
}

function intToIp(int) {
  return [24, 16, 8, 0].map((shift) => (int >>> shift) & 0xff).join('.');
}

function isValidIp(ip) {
  const parts = String(ip).split('.');
  return parts.length === 4 && parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255);
}

// "192.168.1.0/24" -> host IPs (network + broadcast excluded above a /31).
function parseCidr(cidr) {
  const [base, prefixStr] = String(cidr).trim().split('/');
  const prefix = prefixStr === undefined || prefixStr === '' ? 32 : parseInt(prefixStr, 10);
  if (!isValidIp(base) || Number.isNaN(prefix) || prefix < 0 || prefix > 32) {
    throw new Error('Invalid network \u2014 use something like 192.168.1.0/24');
  }
  const hostBits = 32 - prefix;
  const size = hostBits === 0 ? 1 : 2 ** hostBits;
  if (size > MAX_HOSTS + 2) throw new Error(`Range too large (max ${MAX_HOSTS} hosts) \u2014 try a /24`);
  const network = hostBits >= 32 ? 0 : ((ipToInt(base) >>> hostBits) << hostBits) >>> 0;
  const start = size > 2 ? 1 : 0;
  const end = size > 2 ? size - 1 : size;
  const ips = [];
  for (let i = start; i < end; i += 1) ips.push(intToIp((network + i) >>> 0));
  return ips;
}

// Accepts: "192.168.1.0/24", "192.168.1.50", "192.168.1.10-192.168.1.40",
// or the short form "192.168.1.10-40".
function parseTarget(input) {
  const text = String(input || '').trim();
  if (!text) throw new Error('Enter a network to scan, e.g. 192.168.1.0/24');
  if (text.includes('/')) return parseCidr(text);

  if (text.includes('-')) {
    const [left, right] = text.split('-').map((s) => s.trim());
    if (!isValidIp(left)) throw new Error('Invalid range start address');
    const endIp = isValidIp(right) ? right : `${left.split('.').slice(0, 3).join('.')}.${right}`;
    if (!isValidIp(endIp)) throw new Error('Invalid range end address');
    const a = ipToInt(left);
    const b = ipToInt(endIp);
    if (b < a) throw new Error('Range end must be after the start');
    if (b - a + 1 > MAX_HOSTS) throw new Error(`Range too large (max ${MAX_HOSTS} hosts)`);
    const ips = [];
    for (let n = a; n <= b; n += 1) ips.push(intToIp(n >>> 0));
    return ips;
  }

  if (!isValidIp(text)) throw new Error('Invalid IP address');
  return [text];
}

// "23, 80, 5000-5005" or an array -> sorted unique ports. Blank -> null,
// which tells the scanner to use the common AV port list.
function parsePorts(input) {
  const items = Array.isArray(input) ? input : String(input || '').split(/[\s,;]+/);
  const ports = new Set();
  items.map((s) => String(s).trim()).filter(Boolean).forEach((item) => {
    const range = item.match(/^(\d+)-(\d+)$/);
    if (range) {
      const [lo, hi] = [Number(range[1]), Number(range[2])].sort((x, y) => x - y);
      for (let p = lo; p <= hi && ports.size <= MAX_PORTS; p += 1) ports.add(p);
    } else if (/^\d+$/.test(item)) {
      ports.add(Number(item));
    } else {
      throw new Error(`"${item}" is not a valid port`);
    }
  });
  const list = [...ports];
  if (list.some((p) => p < 1 || p > 65535)) throw new Error('Ports must be between 1 and 65535');
  if (list.length > MAX_PORTS) throw new Error(`Too many ports (max ${MAX_PORTS})`);
  return list.length ? list.sort((a, b) => a - b) : null;
}

// The /24 (or smaller) networks this PC is on, for the network chips.
function localNetworks() {
  const found = [];
  const seen = new Set();
  const ifaces = os.networkInterfaces();
  Object.keys(ifaces).forEach((name) => {
    (ifaces[name] || []).forEach((a) => {
      const v4 = a.family === 'IPv4' || a.family === 4;
      if (!v4 || a.internal || a.address.startsWith('169.254.')) return;
      const maskBits = a.netmask.split('.').reduce((n, o) => n + Number(o).toString(2).replace(/0/g, '').length, 0);
      const prefix = Math.max(maskBits, 24); // never auto-suggest more than 254 hosts
      const network = ((ipToInt(a.address) >>> (32 - prefix)) << (32 - prefix)) >>> 0;
      const cidr = `${intToIp(network)}/${prefix}`;
      if (!seen.has(cidr)) {
        seen.add(cidr);
        found.push({ name, address: a.address, cidr });
      }
    });
  });
  return found;
}

// Pool that stops handing out work as soon as shouldCancel() turns true.
async function runPool(items, worker, concurrency, shouldCancel) {
  let index = 0;
  async function next() {
    while (index < items.length && !shouldCancel()) {
      const current = index;
      index += 1;
      // eslint-disable-next-line no-await-in-loop
      await worker(items[current], current);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) || 1 }, next));
}

async function probePorts(ip, ports, timeoutMs) {
  const results = await Promise.all(ports.map(async (port) => ((await probeTcp({ ip, port, timeoutMs })) ? port : null)));
  return results.filter((p) => p !== null);
}

async function reverseLookup(ip) {
  try {
    const names = await Promise.race([
      dns.reverse(ip),
      new Promise((_, reject) => { setTimeout(() => reject(new Error('timeout')), 1200); }),
    ]);
    return names && names[0] ? names[0] : '';
  } catch (e) {
    return '';
  }
}

// Sweeps a target. Each host is checked two ways in parallel -- an ICMP ping
// and a TCP connect to every port in the list -- so devices that block ping
// but expose a control port are still found, and devices that answer ping
// but use an unlisted port still show up as "responds to ping".
async function scanRange({
  target, ports, timeoutMs = 400, concurrency = 24, onProgress, shouldCancel = () => false,
}) {
  const ips = parseTarget(target);
  const customPorts = parsePorts(ports);
  const portList = customPorts || DEFAULT_PORTS;

  let scanned = 0;
  const found = [];

  await runPool(ips, async (ip) => {
    const [alive, open] = await Promise.all([
      pingHost(ip, 800),
      probePorts(ip, portList, timeoutMs),
    ]);
    if (alive || open.length) {
      found.push({
        ip,
        alive,
        openPorts: open.map((port) => ({ port, service: SERVICE_NAMES[port] || '' })),
      });
    }
    scanned += 1;
    if (onProgress) onProgress({ scanned, total: ips.length, found: found.length });
  }, concurrency, shouldCancel);

  // Enrich what we found: MAC (from the ARP cache the sweep just warmed up)
  // and hostname (reverse DNS, with a short timeout).
  if (found.length) {
    const [arp, names] = await Promise.all([
      readArpTable(),
      Promise.all(found.map((f) => reverseLookup(f.ip))),
    ]);
    found.forEach((f, i) => {
      f.mac = arp[f.ip] || '';
      f.hostname = names[i] || '';
    });
  }

  found.sort((a, b) => ipToInt(a.ip) - ipToInt(b.ip));
  return {
    results: found,
    cancelled: shouldCancel(),
    scannedHosts: scanned,
    totalHosts: ips.length,
    portsUsed: portList,
    usedDefaultPorts: !customPorts,
  };
}

module.exports = {
  parseCidr, parseTarget, parsePorts, localNetworks, scanRange, ipToInt, intToIp, COMMON_AV_PORTS, DEFAULT_PORTS,
};
