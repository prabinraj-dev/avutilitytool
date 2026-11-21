// The sweep finds devices correctly, reports them as they answer, and stays fast on an empty /24.
const assert = require('assert');
const net = require('net');
const { scanRange } = require('../src/net/discovery');

(async () => {
  const servers = await Promise.all([0, 1].map(() => new Promise((resolve) => {
    const s = net.createServer((c) => c.destroy());
    s.listen(0, '127.0.0.1', () => resolve(s));
  })));
  const ports = servers.map((s) => s.address().port).join(',');
  const seen = [];
  const r = await scanRange({ target: '127.0.0.1', ports, onFound: (f) => seen.push(f.ip) });
  assert.strictEqual(r.results.length, 1);
  assert.deepStrictEqual(r.results[0].openPorts.map((p) => p.port).sort(), servers.map((s) => s.address().port).sort());
  assert.ok(seen.includes('127.0.0.1'), 'found devices are reported live');
  servers.forEach((s) => s.close());

  // 254 addresses where nothing answers (TEST-NET-1) with the default AV ports.
  const t = Date.now();
  const empty = await scanRange({ target: '192.0.2.0/24' });
  const ms = Date.now() - t;
  assert.strictEqual(empty.scannedHosts, 254);
  assert.ok(ms < 4000, `empty /24 scanned in ${ms} ms`);
  console.log(`discovery: all tests passed (empty /24 in ${ms} ms)`);
  process.exit(0);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
