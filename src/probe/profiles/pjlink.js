const crypto = require('crypto');
const { cmd, clean } = require('./util');

// PJLink: the common control standard for projectors (and some displays). TCP 4352.
const QUERIES = [
  ['class', '%1CLSS ?'], ['name', '%1NAME ?'], ['manufacturer', '%1INF1 ?'], ['model', '%1INF2 ?'],
  ['info', '%1INFO ?'], ['power', '%1POWR ?'], ['serial', '%2SNUM ?'], ['firmware', '%2SVER ?'],
];
const POWER = { 0: 'Off (standby)', 1: 'On', 2: 'Cooling', 3: 'Warming up' };

module.exports = {
  id: 'pjlink',
  name: 'PJLink projector / display',
  ports: [4352],
  protocol: 'tcp',
  loginHint: 'PJLink password (no user name)',

  async identify({ open, creds }) {
    const s = await open(4352);
    try {
      const banner = (await s.read({ until: /\r/, maxMs: 2000 })).toString('latin1');
      const m = /^PJLINK ([01])(?: (\S+))?/.exec(banner);
      if (!m) return { matched: false };
      const raw = [`< ${clean(banner)}`];
      const fields = {};
      let prefix = '';
      if (m[1] === '1') {
        fields.authentication = 'Password required';
        if (!creds.password) return { matched: true, needsLogin: true, fields, raw };
        prefix = crypto.createHash('md5').update(`${m[2]}${creds.password}`).digest('hex');
      }
      for (const [key, query] of QUERIES) {
        if (key === 'serial' && fields.class !== '2') break; // class 2 only
        const reply = clean(await s.askText(`${prefix}${query}\r`, { until: /\r/, maxMs: 1500 }));
        prefix = ''; // the digest goes on the first command only
        raw.push(`> ${query}`, `< ${reply || '(no reply)'}`);
        if (/PJLINK ERRA/.test(reply)) return { matched: true, needsLogin: true, loginFailed: true, fields, raw };
        const value = (/=(.*)$/.exec(reply) || [])[1];
        if (value === undefined || /^ERR\d$/.test(value)) continue;
        fields[key] = key === 'power' ? (POWER[value] || value) : value;
      }
      return { matched: true, fields, raw };
    } finally { s.close(); }
  },

};
