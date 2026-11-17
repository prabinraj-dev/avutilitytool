const { clean } = require('./util');
const { consoleLogin } = require('./console');

// Crestron control processors: text console on TCP 41795 (CTP), sometimes Telnet 23.
module.exports = {
  id: 'crestron',
  name: 'Crestron control system (console)',
  ports: [41795, 23],
  protocol: 'tcp',
  loginHint: 'Crestron device user name and password (when authentication is on)',

  async identify({ open, creds, openPorts }) {
    const port = [41795, 23].find((p) => openPorts.includes(p));
    const s = await open(port, { telnet: true });
    try {
      const raw = [];
      let text = (await s.read({ quietMs: 500, maxMs: 1500 })).toString('latin1');
      if (!text.trim()) text = await s.askText('\r', { quietMs: 500, maxMs: 1500 });
      raw.push(`< ${clean(text) || '(nothing)'}`);
      const login = await consoleLogin(s, creds, raw, text);
      const looksCrestron = /crestron|control console|cntrl eng/i.test(text + login.text);
      if (!login.ok) return looksCrestron ? { matched: true, port, fields: { manufacturer: 'Crestron' }, raw, ...login } : { matched: false };

      const ask = async (c) => { const r = await s.askText(`${c}\r`, { quietMs: 500, maxMs: 2500 }); raw.push(`> ${c}`, `< ${clean(r) || '(no reply)'}`); return r; };
      const ver = await ask('ver');
      const prompt = /^([A-Z0-9][\w-]{1,30})>\s*$/im.exec(ver) || /^([A-Z0-9][\w-]{1,30})>\s*$/im.exec(login.text);
      if (!looksCrestron && !/crestron|cntrl eng|\[v\d+\.\d+/i.test(ver)) return { matched: false };
      const fields = { manufacturer: 'Crestron' };
      const line = ver.split(/[\r\n]+/).map((l) => l.trim()).find((l) => /\[v?\d|v\d+\.\d+/i.test(l));
      if (line) fields.versionInfo = clean(line);
      const fw = /v(\d+\.\d+(?:\.\d+){0,2})/i.exec(ver);
      if (fw) fields.firmware = fw[1];
      const model = /^([A-Z0-9][\w-]+)\s+(?:Cntrl Eng|\[)/im.exec(ver);
      if (model) fields.model = model[1]; else if (prompt) fields.model = prompt[1];
      const sn = /#([0-9A-F]{8})\b/i.exec(ver);
      if (sn) fields.tsid = sn[1].toUpperCase();
      const host = await ask('hostname');
      const h = /Host\s*Name\s*:\s*(\S+)/i.exec(host);
      if (h) fields.hostname = h[1];
      const ip = await ask('ipconfig /all');
      const mac = /MAC Address[^:\r\n]*:\s*((?:[0-9a-f]{2}[.:-]){5}[0-9a-f]{2})/i.exec(ip);
      if (mac) fields.mac = mac[1].replace(/[.-]/g, ':').toUpperCase();
      return { matched: true, port, fields, raw };
    } finally { s.close(); }
  },

};
