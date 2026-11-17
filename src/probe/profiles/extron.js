const { cmd, clean } = require('./util');

// Extron SIS over Telnet (TCP 23). The unit announces itself with a copyright banner.
module.exports = {
  id: 'extron',
  name: 'Extron (SIS)',
  ports: [23],
  protocol: 'tcp',
  loginHint: 'Extron administrator or user password (no user name)',

  async identify({ open, creds }) {
    const s = await open(23, { telnet: true });
    try {
      let banner = (await s.read({ quietMs: 500, maxMs: 2500 })).toString('latin1');
      if (!/Extron Electronics/i.test(banner)) return { matched: false };
      const raw = [`< ${clean(banner)}`];
      const fields = { manufacturer: 'Extron' };
      const b = /Extron Electronics,\s*([^,\r\n]+?),\s*V(\d[\w.]*)(?:,\s*([\d-]+))?/i.exec(banner);
      if (b) { fields.model = b[1].trim(); fields.firmware = b[2]; if (b[3]) fields.partNumber = b[3]; }

      if (/Password:/i.test(banner)) {
        if (!creds.password) return { matched: true, needsLogin: true, fields, raw };
        const reply = await s.askText(`${creds.password}\r`, { quietMs: 400, maxMs: 2000 });
        raw.push('> (password)', `< ${clean(reply)}`);
        if (/Password:/i.test(reply) || !/Administrator|User/i.test(reply)) return { matched: true, needsLogin: true, loginFailed: true, fields, raw };
        fields.access = /Administrator/i.test(reply) ? 'Administrator' : 'User';
      }
      const ask = async (label, send, shown) => {
        const reply = clean(await s.askText(send, { quietMs: 300, maxMs: 1500 }));
        raw.push(`> ${shown}`, `< ${reply || '(no reply)'}`);
        return /^E\d\d$/.test(reply) ? '' : reply;
      };
      const fw = await ask('firmware', 'Q', 'Q');
      if (fw) fields.firmware = fw.replace(/^Ver\d*\*?/i, '');
      const pn = await ask('part', 'N', 'N');
      if (pn) fields.partNumber = pn.replace(/^(Pno|N)/i, '');
      const model = await ask('model', '1I', '1I');
      if (model && !fields.model) fields.model = model.replace(/^Inf01\*/i, '');
      const mac = await ask('mac', '\x1BCH\r', 'Esc CH');
      const macMatch = /([0-9A-F]{2}[-:]){5}[0-9A-F]{2}/i.exec(mac);
      if (macMatch) fields.mac = macMatch[0].replace(/-/g, ':').toUpperCase();
      const name = await ask('name', '\x1BCN\r', 'Esc CN');
      if (name) fields.name = name.replace(/^Ipn\s*/i, '');
      return { matched: true, fields, raw };
    } finally { s.close(); }
  },

  commands: {
    note: 'Typical SIS commands for Extron switchers. SIS commands differ between models, so check them against your model’s manual.',
    mute: cmd('Audio mute on', '1Z', { delimiter: 'none' }),
    volumeUp: cmd('', '+V', { delimiter: 'none' }),
    volumeDown: cmd('', '-V', { delimiter: 'none' }),
    sources: [1, 2, 3, 4].map((n) => cmd(`Input ${n}`, `${n}!`, { delimiter: 'none' })),
    custom: [cmd('Audio mute off', '0Z', { delimiter: 'none' }), cmd('Firmware?', 'Q', { delimiter: 'none' }), cmd('Part number?', 'N', { delimiter: 'none' }), cmd('Current input?', '!', { delimiter: 'none' })],
  },
};
