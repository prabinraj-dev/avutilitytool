const { clean } = require('./util');

// Epson projectors: ESC/VP.net on TCP 3629. A short handshake opens the session,
// then the usual ESC/VP21 text commands work ("PWR?", "SNO?" ...), each answered and followed by ":".
function handshake(password) {
  const head = Buffer.from('ESC/VP.net\x10\x03\x00\x00\x00', 'latin1');
  if (!password) return Buffer.concat([head, Buffer.from([0x00])]);
  const pw = Buffer.alloc(16); pw.write(password.slice(0, 16), 'latin1');
  return Buffer.concat([head, Buffer.from([0x01, 0x01, 0x01]), pw]);
}
const POWER = { '00': 'Standby', '01': 'On', '02': 'Warming up', '03': 'Cooling', '04': 'Standby (network on)', '05': 'Abnormal standby' };
const SOURCES = { 30: 'HDMI 1', A0: 'HDMI 2', 11: 'Computer 1', 21: 'Computer 2', 41: 'Video', 52: 'USB', 53: 'LAN', 80: 'HDBaseT' };

module.exports = {
  id: 'epson',
  name: 'Epson projector (ESC/VP.net)',
  ports: [3629],
  protocol: 'tcp',
  loginHint: 'Epson "Web Control" / Monitor password (no user name)',

  async identify({ open, creds }) {
    const s = await open(3629);
    try {
      const raw = [];
      const hello = await s.ask(handshake(creds.password), { quietMs: 300, maxMs: 2000 });
      raw.push('> ESC/VP.net connect', `< ${clean(hello.toString('latin1').slice(0, 10))} status 0x${hello.length > 14 ? hello[14].toString(16) : '??'}`);
      if (hello.toString('latin1', 0, 10) !== 'ESC/VP.net') return { matched: false };
      const fields = { manufacturer: 'Epson' };
      if (hello[14] !== 0x20) return { matched: true, needsLogin: true, loginFailed: !!creds.password, fields, raw };
      const ask = async (q) => {
        const reply = clean((await s.askText(`${q}\r`, { until: /:/, quietMs: 300, maxMs: 1500 })).replace(/:\s*$/, ''));
        raw.push(`> ${q}`, `< ${reply || '(no reply)'}`);
        return (/=(.*)$/.exec(reply) || [])[1] || '';
      };
      const power = await ask('PWR?');
      if (power) fields.power = POWER[power] || power;
      const serial = await ask('SNO?');
      if (serial) fields.serial = serial;
      const source = await ask('SOURCE?');
      if (source) fields.input = SOURCES[source.toUpperCase()] || source;
      const lamp = await ask('LAMP?');
      if (lamp) fields.lampHours = lamp;
      return { matched: true, fields, raw };
    } finally { s.close(); }
  },

};
