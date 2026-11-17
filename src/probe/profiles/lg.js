const { cmd, clean } = require('./util');

// LG commercial displays: the RS-232C command set over the network, TCP 9761.
// Send "<cmd1><cmd2> <set id> <data>" + CR; the display answers "<cmd2> <set id> OK<data>x".
const INPUTS = { 90: 'HDMI 1', 91: 'HDMI 2', 92: 'HDMI 3', c0: 'DisplayPort', 70: 'DVI', 80: 'DVI', 98: 'OPS', a0: 'HDMI 1 (PC)', a1: 'HDMI 2 (PC)', d0: 'DisplayPort (PC)' };

module.exports = {
  id: 'lg',
  name: 'LG display (network control)',
  ports: [9761],
  protocol: 'tcp',
  loginHint: '',

  async identify({ open }) {
    const s = await open(9761);
    try {
      const raw = [];
      const ask = async (command) => {
        const reply = clean(await s.askText(`${command}\r`, { until: /x/, quietMs: 300, maxMs: 1500 }));
        raw.push(`> ${command}`, `< ${reply || '(no reply)'}`);
        const m = /^([a-z]) (\d\d) (OK|NG)(.*?)x?$/i.exec(reply);
        return m ? { ok: m[3].toUpperCase() === 'OK', data: m[4] } : null;
      };
      const power = await ask('ka 01 ff');
      if (!power) return { matched: false };
      const fields = { manufacturer: 'LG', setId: '01' };
      if (power.ok) fields.power = power.data === '01' ? 'On' : 'Off';
      const serial = await ask('fy 01 ff');
      if (serial && serial.ok && serial.data) fields.serial = serial.data;
      const version = await ask('fz 01 ff');
      if (version && version.ok && version.data) fields.firmware = version.data;
      const input = await ask('xb 01 ff');
      if (input && input.ok && input.data) fields.input = INPUTS[input.data.toLowerCase()] || input.data;
      const volume = await ask('kf 01 ff');
      if (volume && volume.ok && /^[0-9a-f]{2}$/i.test(volume.data)) fields.volume = String(parseInt(volume.data, 16));
      return { matched: true, fields, raw };
    } finally { s.close(); }
  },

};
