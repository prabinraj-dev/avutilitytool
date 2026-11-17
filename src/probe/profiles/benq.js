const { cmd, clean } = require('./util');

// BenQ projectors and displays: the RS-232 command set over the network (usually TCP 8000).
// Commands look like <CR>*pow=?#<CR>; replies look like *POW=ON#.
const wrap = (c) => `\r*${c}#\r`;
const B = { delimiter: 'cr' };
const button = (label, c) => cmd(label, `*${c}#`, B);

module.exports = {
  id: 'benq',
  name: 'BenQ projector / display',
  ports: [8000],
  protocol: 'tcp',
  loginHint: '',

  async identify({ open }) {
    const s = await open(8000);
    try {
      const raw = [];
      const ask = async (q) => {
        const reply = await s.askText(wrap(q), { quietMs: 400, maxMs: 1500 });
        raw.push(`> *${q}#`, `< ${clean(reply) || '(no reply)'}`);
        const matches = [...reply.matchAll(/\*([A-Z0-9]+)=([^#?]+)#/gi)];
        return matches.length ? matches[matches.length - 1][2].trim() : '';
      };
      const model = await ask('modelname=?');
      const power = await ask('pow=?');
      if (!model && !power) return { matched: false };
      const fields = { manufacturer: 'BenQ' };
      if (model) fields.model = model;
      if (power) fields.power = /on/i.test(power) ? 'On' : 'Off';
      const source = await ask('sour=?');
      if (source) fields.input = source;
      const lamp = await ask('ltim=?');
      if (lamp) fields.lampHours = lamp;
      return { matched: true, fields, raw };
    } finally { s.close(); }
  },

};
