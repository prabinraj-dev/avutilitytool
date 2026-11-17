const { clean } = require('./util');
const { consoleLogin } = require('./console');

// AMX NetLinx masters and devices: Telnet console on TCP 23.
module.exports = {
  id: 'amx',
  name: 'AMX NetLinx (Telnet)',
  ports: [23],
  protocol: 'tcp',
  loginHint: 'AMX user name and password (when Telnet security is on)',

  async identify({ open, creds }) {
    const s = await open(23, { telnet: true });
    try {
      const raw = [];
      const text = (await s.read({ quietMs: 500, maxMs: 2000 })).toString('latin1');
      raw.push(`< ${clean(text) || '(nothing)'}`);
      const login = await consoleLogin(s, creds, raw, text);
      const looksAmx = /netlinx|\bAMX\b/i.test(text + login.text);
      if (!looksAmx) return { matched: false };
      const fields = { manufacturer: 'AMX' };
      const v = /NetLinx\s+v([\w.]+)/i.exec(text + login.text);
      if (v) fields.firmware = v[1];
      if (!login.ok) return { matched: true, fields, raw, ...login };

      const ask = async (c) => { const r = await s.askText(`${c}\r`, { quietMs: 600, maxMs: 3000 }); raw.push(`> ${c}`, `< ${clean(r) || '(no reply)'}`); return r; };
      const ip = await ask('get ip');
      const mac = /MAC Address\s*[:=]?\s*((?:[0-9a-f]{2}[:-]){5}[0-9a-f]{2})/i.exec(ip);
      if (mac) fields.mac = mac[1].replace(/-/g, ':').toUpperCase();
      const host = /Host\s*Name\s*[:=]?\s*(\S+)/i.exec(ip);
      if (host) fields.hostname = host[1];
      const sn = await ask('get sn');
      const snMatch = /(?:serial(?: number)?|S\/?N)\s*[:=]?\s*([A-Z0-9-]{6,})/i.exec(sn) || /^\s*([A-Z0-9]{8,})\s*$/im.exec(sn);
      if (snMatch) fields.serial = snMatch[1];
      const dev = await ask('show device');
      const name = /Name\s*=\s*(.+?)(?:\s+Manufacturer\s*=|[\r\n,]|$)/i.exec(dev);
      if (name) fields.model = name[1].trim();
      const dsn = /Serial(?: Number)?\s*=\s*([^\r\n,\s]+)/i.exec(dev);
      if (dsn && !fields.serial) fields.serial = dsn[1];
      const dv = /Version\s*=\s*v?([\w.]+)/i.exec(dev);
      if (dv) fields.firmware = dv[1];
      return { matched: true, fields, raw };
    } finally { s.close(); }
  },

  commands: {
    note: 'AMX control strings are defined by the NetLinx program on the master, so there is no standard list. Enter the strings your program expects.',
  },
};
