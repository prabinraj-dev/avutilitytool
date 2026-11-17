const { cmd } = require('./util');

// Samsung commercial displays: MDC (Multiple Display Control), binary protocol on TCP 1515.
// Frame: AA <command> <display id> <length> <data...> <checksum = sum of bytes after AA, low 8 bits>
function mdc(command, id, data = []) {
  const body = [command, id, data.length, ...data];
  return Buffer.from([0xaa, ...body, body.reduce((a, b) => a + b, 0) & 0xff]);
}
const hex = (buf) => Array.from(buf).map((b) => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');

function parseAck(buf, command) {
  for (let i = 0; i + 6 <= buf.length; i += 1) {
    if (buf[i] === 0xaa && buf[i + 1] === 0xff) {
      const len = buf[i + 3];
      if (buf[i + 5] !== command) continue;
      return { ok: buf[i + 4] === 0x41, id: buf[i + 2], data: buf.subarray(i + 6, i + 6 + Math.max(0, len - 2)) };
    }
  }
  return null;
}
const INPUTS = { 0x14: 'PC', 0x18: 'DVI', 0x20: 'MagicInfo', 0x21: 'HDMI 1', 0x23: 'HDMI 2', 0x25: 'DisplayPort', 0x31: 'HDMI 3', 0x60: 'TV' };
const HEX = { encoding: 'hex', delimiter: 'none' };

module.exports = {
  id: 'samsung-mdc',
  name: 'Samsung display (MDC)',
  ports: [1515],
  protocol: 'tcp',
  loginHint: '',

  async identify({ open }) {
    const s = await open(1515);
    try {
      const raw = [];
      let id = null;
      let status = null;
      for (const tryId of [0x00, 0x01, 0xfe]) {
        const q = mdc(0x00, tryId);
        const reply = await s.ask(q, { quietMs: 300, maxMs: 1500 });
        raw.push(`> ${hex(q)}`, `< ${hex(reply) || '(no reply)'}`);
        status = parseAck(reply, 0x00);
        if (status) { id = status.id; break; }
      }
      if (!status) return { matched: false };
      const fields = { manufacturer: 'Samsung', displayId: String(id) };
      if (status.ok && status.data.length >= 4) {
        fields.power = status.data[0] ? 'On' : 'Off';
        fields.volume = String(status.data[1]);
        fields.mute = status.data[2] ? 'On' : 'Off';
        fields.input = INPUTS[status.data[3]] || `0x${status.data[3].toString(16)}`;
      }
      const text = async (key, command) => {
        const q = mdc(command, id);
        const reply = await s.ask(q, { quietMs: 300, maxMs: 1500 });
        raw.push(`> ${hex(q)}`, `< ${hex(reply) || '(no reply)'}`);
        const ack = parseAck(reply, command);
        const value = ack && ack.ok ? ack.data.toString('latin1').replace(/[^\x20-\x7e]/g, '').trim() : '';
        if (value) fields[key] = value;
      };
      await text('serial', 0x0b);
      await text('model', 0x8a);
      await text('firmware', 0x0e);
      return { matched: true, fields, raw, context: { id } };
    } finally { s.close(); }
  },

  // Built for the display ID that answered.
  buildCommands({ id = 0 } = {}) {
    const h = (command, data) => hex(mdc(command, id, data));
    return {
      note: `Samsung MDC commands for display ID ${id}. Volume is set to fixed levels because each MDC frame carries its own checksum.`,
      powerOn: cmd('Power on', h(0x11, [1]), HEX),
      powerOff: cmd('Power off', h(0x11, [0]), HEX),
      mute: cmd('Mute on', h(0x13, [1]), HEX),
      sources: [[0x21, 'HDMI 1'], [0x23, 'HDMI 2'], [0x31, 'HDMI 3'], [0x25, 'DisplayPort'], [0x14, 'PC'], [0x18, 'DVI']].map(([v, label]) => cmd(label, h(0x14, [v]), HEX)),
      custom: [cmd('Mute off', h(0x13, [0]), HEX), cmd('Volume 20', h(0x12, [20]), HEX), cmd('Volume 40', h(0x12, [40]), HEX), cmd('Volume 60', h(0x12, [60]), HEX), cmd('Status?', h(0x00), HEX), cmd('Serial number?', h(0x0b), HEX)],
    };
  },
};
