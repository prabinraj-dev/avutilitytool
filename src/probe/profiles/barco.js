const { cmd } = require('./util');

// Barco projectors on the Pulse platform: JSON-RPC 2.0 on TCP 9090.
const rpc = (id, method, params) => JSON.stringify({ jsonrpc: '2.0', method, ...(params ? { params } : {}), id });
const J = { encoding: 'utf8', delimiter: 'none' };

function parseAll(text) {
  // Replies arrive back to back with no separator: split on balanced braces.
  const out = []; let depth = 0; let start = -1;
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === '{') { if (depth === 0) start = i; depth += 1; }
    if (text[i] === '}') { depth -= 1; if (depth === 0 && start >= 0) { try { out.push(JSON.parse(text.slice(start, i + 1))); } catch (e) { /* skip */ } start = -1; } }
  }
  return out;
}

module.exports = {
  id: 'barco',
  name: 'Barco projector (Pulse)',
  ports: [9090],
  protocol: 'tcp',
  loginHint: '',

  async identify({ open }) {
    const s = await open(9090);
    try {
      const raw = [];
      const get = async (id, property) => {
        const q = rpc(id, 'property.get', { property });
        const reply = (await s.ask(q, { quietMs: 400, maxMs: 1800 })).toString('utf8');
        raw.push(`> ${q}`, `< ${reply.trim() || '(no reply)'}`);
        const msg = parseAll(reply).find((m) => m.id === id);
        if (!msg) return { spoke: false };
        return { spoke: true, value: typeof msg.result === 'object' ? '' : String(msg.result === undefined ? '' : msg.result) };
      };
      const serial = await get(1, 'system.serialnumber');
      if (!serial.spoke) return { matched: false };
      const fields = { manufacturer: 'Barco' };
      if (serial.value) fields.serial = serial.value;
      const model = await get(2, 'system.modelname');
      if (model.value) fields.model = model.value;
      const fw = await get(3, 'system.firmwareversion');
      if (fw.value) fields.firmware = fw.value;
      const state = await get(4, 'system.state');
      if (state.value) fields.state = state.value;
      return { matched: true, fields, raw };
    } finally { s.close(); }
  },

};
