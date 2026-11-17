const crypto = require('crypto');
const { cmd, clean } = require('./util');

// Panasonic projectors and displays: "NTCONTROL" command control on TCP 1024.
// The unit greets with "NTCONTROL 0" (open) or "NTCONTROL 1 <random>" (protected: commands are
// prefixed with md5("user:password:random")). Commands are "00" + command + CR.
const INPUTS = { HD1: 'HDMI 1', HD2: 'HDMI 2', RG1: 'RGB 1', RG2: 'RGB 2', DVI: 'DVI', DL1: 'Digital Link', SD1: 'SDI', VID: 'Video', NWP: 'Network' };

module.exports = {
  id: 'panasonic',
  name: 'Panasonic projector / display (NTCONTROL)',
  ports: [1024],
  protocol: 'tcp',
  loginHint: 'Panasonic web control user name and password (often admin1 / panasonic)',

  async identify({ open, creds }) {
    const s = await open(1024);
    try {
      const banner = (await s.read({ until: /\r/, maxMs: 2000 })).toString('latin1');
      const m = /^NTCONTROL ([01])(?: (\S+))?/.exec(banner);
      if (!m) return { matched: false };
      const raw = [`< ${clean(banner)}`];
      const fields = { manufacturer: 'Panasonic' };
      let prefix = '';
      if (m[1] === '1') {
        fields.authentication = 'Protected mode';
        if (!creds.username || !creds.password) return { matched: true, needsLogin: true, fields, raw };
        prefix = crypto.createHash('md5').update(`${creds.username}:${creds.password}:${m[2]}`).digest('hex');
      }
      const ask = async (q) => {
        const reply = clean(await s.askText(`${prefix}00${q}\r`, { until: /\r/, maxMs: 1500 }));
        raw.push(`> 00${q}`, `< ${reply || '(no reply)'}`);
        return reply;
      };
      const power = await ask('QPW');
      if (/ERRA/.test(power)) return { matched: true, needsLogin: true, loginFailed: true, fields, raw };
      const pv = /^00(\d{3})$/.exec(power);
      if (pv) fields.power = pv[1] === '001' ? 'On' : 'Off (standby)';
      // Most units accept one command per connection, so further questions use fresh connections.
      return { matched: true, fields, raw };
    } finally { s.close(); }
  },

  commands: {
    note: 'Panasonic NTCONTROL commands. They work from buttons only when command control runs without protection (set "Command protect" to off on the projector); the serial number is not available over this protocol.',
    powerOn: cmd('Power on', '00PON'),
    powerOff: cmd('Power off', '00POF'),
    mute: cmd('Shutter / AV mute on', '00OSH:1'),
    sources: Object.entries({ HD1: 'HDMI 1', HD2: 'HDMI 2', RG1: 'RGB 1', DVI: 'DVI', DL1: 'Digital Link' }).map(([code, label]) => cmd(label, `00IIS:${code}`)),
    custom: [cmd('Shutter / AV mute off', '00OSH:0'), cmd('Power status?', '00QPW'), cmd('Input status?', '00QIN'), cmd('Volume up', '00AUU'), cmd('Volume down', '00AUD')],
  },
  INPUTS,
};
