const { cmd } = require('./util');

// Q-SYS Remote Control (QRC): JSON-RPC 2.0 over TCP 1710, each message ends with a null byte.
const frame = (obj) => `${JSON.stringify(obj)}\0`;
const parse = (buf) => buf.toString('utf8').split('\0').map((t) => { try { return JSON.parse(t); } catch (e) { return null; } }).filter(Boolean);
const NUL = { delimiter: 'custom', delimiterCustom: '00', delimiterEncoding: 'hex' };

module.exports = {
  id: 'qsys',
  name: 'QSC Q-SYS Core (QRC)',
  ports: [1710],
  protocol: 'tcp',
  loginHint: 'Q-SYS user name and PIN, only if the design has access control on',

  async identify({ open, creds }) {
    const s = await open(1710);
    try {
      const raw = [];
      const hello = parse(await s.read({ quietMs: 400, maxMs: 1200 }));
      hello.forEach((m) => raw.push(`< ${JSON.stringify(m)}`));
      if (creds.username || creds.password) {
        s.send(frame({ jsonrpc: '2.0', method: 'Logon', params: { User: creds.username || '', Password: creds.password || '' } }));
        raw.push('> Logon');
      }
      const replies = parse(await s.ask(frame({ jsonrpc: '2.0', method: 'StatusGet', id: 1, params: 0 }), { quietMs: 400, maxMs: 2000 }));
      raw.push('> StatusGet');
      replies.forEach((m) => raw.push(`< ${JSON.stringify(m)}`));
      const all = [...hello, ...replies];
      const status = (all.find((m) => m.id === 1 && m.result) || {}).result || (all.find((m) => m.method === 'EngineStatus') || {}).params;
      const error = (all.find((m) => m.error) || {}).error;
      if (!status && !error) return { matched: false };
      const fields = { manufacturer: 'QSC' };
      if (status) {
        if (status.Platform) fields.model = status.Platform;
        if (status.DesignName) fields.designName = status.DesignName;
        if (status.DesignCode) fields.designCode = status.DesignCode;
        if (status.State) fields.state = status.State;
        if (status.IsEmulator !== undefined) fields.emulator = status.IsEmulator ? 'Yes' : 'No';
        if (status.IsRedundant !== undefined) fields.redundant = status.IsRedundant ? 'Yes' : 'No';
        if (status.Status && status.Status.String) fields.status = status.Status.String;
      }
      if (!status && error) return { matched: true, needsLogin: true, loginFailed: !!(creds.username || creds.password), fields, raw };
      return { matched: true, fields, raw };
    } finally { s.close(); }
  },

};
