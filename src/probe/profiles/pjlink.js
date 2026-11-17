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

  commands: {
    note: 'Standard PJLink commands. If the projector has a PJLink password, turn PJLink authentication off on the projector for these buttons to work.',
    powerOn: cmd('Power on', '%1POWR 1'),
    powerOff: cmd('Power off', '%1POWR 0'),
    mute: cmd('AV mute on', '%1AVMT 31'),
    volumeUp: cmd('', '%2SVOL 1'),
    volumeDown: cmd('', '%2SVOL 0'),
    sources: [cmd('HDMI 1', '%1INPT 31'), cmd('HDMI 2', '%1INPT 32'), cmd('RGB 1', '%1INPT 11'), cmd('Video 1', '%1INPT 21'), cmd('Network', '%1INPT 51')],
    custom: [cmd('AV mute off', '%1AVMT 30'), cmd('Power status?', '%1POWR ?'), cmd('Input status?', '%1INPT ?'), cmd('Lamp hours?', '%1LAMP ?'), cmd('Error status?', '%1ERST ?')],
  },
};
