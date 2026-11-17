const { cmd, clean } = require('./util');

// Lightware LW3 protocol: text commands on TCP 6107, each line ends with CR LF.
// Replies start with a two-letter prefix, e.g. "pr /.SerialNumber=12345678" (pE / nE = error).
const QUERIES = [
  ['model', '/.ProductName'], ['serial', '/.SerialNumber'], ['partNumber', '/.PartNumber'], ['firmware', '/.PackageVersion'],
  ['mac', '/MANAGEMENT/NETWORK.MacAddress'], ['hostname', '/MANAGEMENT/NETWORK.HostName'], ['name', '/MANAGEMENT/LABEL.DeviceLabel'],
];
const LW3 = { delimiter: 'crlf' };

module.exports = {
  id: 'lightware',
  name: 'Lightware (LW3)',
  ports: [6107],
  protocol: 'tcp',
  loginHint: '',

  async identify({ open }) {
    const s = await open(6107);
    try {
      const raw = [];
      const fields = { manufacturer: 'Lightware' };
      let spoke = false;
      for (const [key, path] of QUERIES) {
        const reply = clean(await s.askText(`GET ${path}\r\n`, { until: /\n/, quietMs: 250, maxMs: 1500 }));
        raw.push(`> GET ${path}`, `< ${reply || '(no reply)'}`);
        if (/^(pr|pw|pE|nE|mE|n-|p-)\b/.test(reply)) spoke = true;
        else if (!spoke) return { matched: false }; // first answer isn't LW3
        const value = (/^p[rw] \S+?=(.*)$/.exec(reply) || [])[1];
        if (value === undefined || value === '') continue;
        fields[key] = key === 'mac' ? value.replace(/-/g, ':').toUpperCase() : value;
      }
      return { matched: spoke, fields, raw };
    } finally { s.close(); }
  },

};
