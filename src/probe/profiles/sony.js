const { cmd } = require('./util');

// Sony BRAVIA displays: Simple IP Control on TCP 20060. Fixed 24-byte messages:
// "*S" + type (C=control, E=enquiry, A=answer, N=notify) + 4-letter function + 16-char parameter + LF.
const msg = (type, fn, param = '################') => `*S${type}${fn}${param}`;
const S = { delimiter: 'lf' };
const INPUTS = { '0000000100000001': 'HDMI 1', '0000000100000002': 'HDMI 2', '0000000100000003': 'HDMI 3', '0000000100000004': 'HDMI 4' };

module.exports = {
  id: 'sony',
  name: 'Sony BRAVIA display (Simple IP Control)',
  ports: [20060],
  protocol: 'tcp',
  loginHint: '',

  async identify({ open }) {
    const s = await open(20060);
    try {
      const raw = [];
      const ask = async (fn, param) => {
        const q = msg('E', fn, param);
        const r = (await s.askText(`${q}\n`, { until: new RegExp(`\\*SA${fn}.{16}\\n`), quietMs: 300, maxMs: 1500 }));
        raw.push(`> ${q}`, `< ${r.trim() || '(no reply)'}`);
        const m = new RegExp(`\\*SA${fn}(.{16})`).exec(r);
        return m ? m[1] : null;
      };
      const power = await ask('POWR');
      if (power === null) return { matched: false };
      const fields = { manufacturer: 'Sony' };
      if (!/^F+$/.test(power)) fields.power = power.endsWith('1') ? 'On' : 'Standby';
      const mac = await ask('MADR', 'eth0############');
      if (mac && !/^F+$/.test(mac)) fields.mac = mac.replace(/#/g, '').replace(/(..)(?!$)/g, '$1:').toUpperCase();
      if (fields.power === 'On') {
        const input = await ask('INPT');
        if (input && !/^F+$/.test(input)) fields.input = INPUTS[input] || input;
        const vol = await ask('VOLU');
        if (vol && /^\d+$/.test(vol)) fields.volume = String(Number(vol));
      }
      return { matched: true, fields, raw };
    } finally { s.close(); }
  },

};
