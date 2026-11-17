const http = require('http');
const https = require('https');
const { Session } = require('./session');
const { pingHost, readArpTable } = require('../net/ping');
const {
  probePorts, reverseLookup, DEFAULT_PORTS, SERVICE_NAMES, isValidIp,
} = require('../net/discovery');

const PROFILES = [
  require('./profiles/pjlink'),
  require('./profiles/epson'),
  require('./profiles/panasonic'),
  require('./profiles/benq'),
  require('./profiles/barco'),
  require('./profiles/samsung'),
  require('./profiles/qsys'),
  require('./profiles/lightware'),
  require('./profiles/lg'),
  require('./profiles/hikvision'),
  require('./profiles/extron'),
  require('./profiles/crestron'),
  require('./profiles/amx'),
];

// First three bytes of the MAC address -> maker (AV brands only; others show as unknown).
const OUI = {
  '00:10:7F': 'Crestron', '00:05:A6': 'Extron', '00:60:74': 'QSC', '00:60:9F': 'AMX', '00:90:5E': 'Biamp',
};

const withTimeout = (promise, ms, label) => Promise.race([
  promise,
  new Promise((_, reject) => { setTimeout(() => reject(new Error(`${label} timed out`)), ms); }),
]);

// Reads the device's own web page: server software, page title, whether it wants a login.
function httpInfo(ip, port, creds) {
  return new Promise((resolve) => {
    const secure = port === 443 || port === 8443;
    const headers = { 'User-Agent': 'AV-Control-Utility' };
    if (creds.username || creds.password) headers.Authorization = `Basic ${Buffer.from(`${creds.username || ''}:${creds.password || ''}`).toString('base64')}`;
    const req = (secure ? https : http).request({
      host: ip, port, path: '/', method: 'GET', headers, timeout: 3000, rejectUnauthorized: false,
    }, (res) => {
      let body = '';
      res.setEncoding('latin1');
      res.on('data', (c) => { if (body.length < 65536) body += c; });
      res.on('end', () => {
        const title = (/<title[^>]*>([^<]{1,120})/i.exec(body) || [])[1];
        resolve({
          port,
          status: res.statusCode,
          server: String(res.headers.server || '').slice(0, 80),
          title: title ? title.replace(/\s+/g, ' ').trim() : '',
          needsLogin: res.statusCode === 401,
          realm: (/realm="([^"]+)"/i.exec(String(res.headers['www-authenticate'] || '')) || [])[1] || '',
        });
      });
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(null));
    req.end();
  });
}

// Plain HTTP(S) GET for profiles that use a device's web API. Resolves null if nothing answers.
function rawHttp(ip, port, secure, path, headers) {
  return new Promise((resolve) => {
    const req = (secure ? https : http).request({
      host: ip, port, path, method: 'GET', headers: { 'User-Agent': 'AV-Control-Utility', ...headers }, timeout: 3000, rejectUnauthorized: false,
    }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { if (body.length < 65536) body += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(null));
    req.end();
  });
}

function profileCommands(profile, context) {
  return profile.buildCommands ? profile.buildCommands(context || {}) : (profile.commands || {});
}

// Counts the ready-made commands in a profile's template.
function commandCount(commands) {
  const fixed = ['powerOn', 'powerOff', 'volumeUp', 'volumeDown', 'mute', 'volumeSet'].filter((k) => commands[k]).length;
  return fixed + (commands.sources || []).length + (commands.custom || []).length;
}

// Gathers everything we can learn about one IP address.
// creds: { username, password } typed by the user for this request only (never stored).
async function getDetails({
  ip, port, creds = {}, onProgress = () => {}, sessionFactory, skipSystem = false, portOverride,
}) {
  if (!isValidIp(ip)) throw new Error('Enter a valid IP address, for example 192.168.1.50');
  const result = {
    ip, mac: '', vendor: '', hostname: '', reachable: false, openPorts: [], web: [], matches: [], needsLogin: false, checkedAt: Date.now(),
  };

  onProgress({ step: 'Checking the network…' });
  const extraPorts = PROFILES.flatMap((p) => p.ports);
  const ports = [...new Set([...DEFAULT_PORTS, ...extraPorts, ...(Number(port) ? [Number(port)] : [])])];
  const scan = portOverride ? Promise.resolve(Object.keys(portOverride).map(Number)) : probePorts(ip, ports, 900);
  const [alive, open, hostname] = await Promise.all([
    skipSystem ? false : pingHost(ip, 1200).catch(() => false),
    scan,
    skipSystem ? '' : reverseLookup(ip),
  ]);
  result.openPorts = open.sort((a, b) => a - b).map((p) => ({ port: p, service: SERVICE_NAMES[p] || '' }));
  result.reachable = !!alive || open.length > 0;
  result.hostname = hostname;
  if (!skipSystem) {
    const arp = await readArpTable().catch(() => ({}));
    result.mac = arp[ip] || '';
    result.vendor = OUI[result.mac.slice(0, 8)] || '';
  }
  if (!result.reachable) return result;

  const openList = result.openPorts.map((p) => p.port);
  const real = (p) => (portOverride && portOverride[p]) || p; // tests map well-known ports to local fakes

  onProgress({ step: 'Reading the device web page…' });
  const webPorts = openList.filter((p) => [80, 443, 8080].includes(p));
  result.web = (await Promise.all(webPorts.map((p) => httpInfo(ip, real(p), creds)))).filter(Boolean).map((w, i) => ({ ...w, port: webPorts[i] }));

  for (const profile of PROFILES) {
    if (!profile.ports.some((p) => openList.includes(p))) continue;
    onProgress({ step: `Asking: ${profile.name}…` });
    try {
      const open1 = (p, options) => (sessionFactory || Session.open)(ip, real(p), 2500, options);
      const request = (p, path, headers) => rawHttp(ip, real(p), p === 443 || p === 8443, path, headers);
      const found = await withTimeout(profile.identify({ open: open1, request, creds, openPorts: openList }), 15000, profile.name);
      if (!found || !found.matched) continue;
      const commands = profileCommands(profile, found.context);
      result.matches.push({
        profileId: profile.id,
        name: profile.name,
        port: found.port || profile.ports.find((p) => openList.includes(p)),
        protocol: profile.protocol,
        fields: found.fields || {},
        raw: found.raw || [],
        needsLogin: !!found.needsLogin,
        loginFailed: !!found.loginFailed,
        loginHint: profile.loginHint || '',
        context: found.context || {},
        commandNote: commands.note || '',
        commandCount: commandCount(commands),
      });
    } catch (e) { /* this profile didn't answer; try the next */ }
  }

  // Details learned from the device itself win over the generic ones.
  const best = result.matches.find((m) => !m.needsLogin) || result.matches[0];
  if (best) {
    if (best.fields.mac && !result.mac) result.mac = best.fields.mac;
    if (best.fields.manufacturer && !result.vendor) result.vendor = best.fields.manufacturer;
    if (best.fields.hostname && !result.hostname) result.hostname = best.fields.hostname;
  }
  result.needsLogin = result.matches.some((m) => m.needsLogin) || (!result.matches.length && result.web.some((w) => w.needsLogin));
  return result;
}

// Merges a profile's ready-made commands into a device's saved buttons without
// overwriting anything the user already entered.
function mergeCommands(existing, profileId, context) {
  const profile = PROFILES.find((p) => p.id === profileId);
  if (!profile) throw new Error('Unknown device type');
  const template = profileCommands(profile, context);
  const mapping = JSON.parse(JSON.stringify(existing || {}));
  const has = (c) => !!(c && c.payload && String(c.payload).trim());
  let added = 0;

  ['powerOn', 'powerOff', 'volumeUp', 'volumeDown', 'mute', 'volumeSet'].forEach((key) => {
    if (!template[key] || has(mapping[key])) return;
    const { label, ...command } = template[key];
    mapping[key] = { ...(mapping[key] || {}), ...command, ...(label ? { label } : {}) };
    added += 1;
  });
  ['sources', 'custom'].forEach((kind) => {
    const incoming = template[kind] || [];
    if (!incoming.length) return;
    const kept = (Array.isArray(mapping[kind]) ? mapping[kind] : []).filter(has); // drop empty placeholders
    const labels = new Set(kept.map((c) => c.label));
    incoming.forEach((c) => { if (!labels.has(c.label)) { kept.push({ ...c }); added += 1; } });
    mapping[kind] = kept;
  });
  if (!Array.isArray(mapping.custom)) mapping.custom = [];
  for (let i = mapping.custom.length; i < 12; i += 1) {
    mapping.custom.push({ label: `Button ${i + 1}`, payload: '', encoding: 'ascii', delimiter: 'crlf', delimiterCustom: '', delimiterEncoding: 'text' });
  }
  return { mapping, added, profile };
}

module.exports = { getDetails, mergeCommands, PROFILES };
