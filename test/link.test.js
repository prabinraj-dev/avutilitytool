const assert = require('assert');
const net = require('net');
const dgram = require('dgram');
const fs = require('fs');
const { spawn } = require('child_process');
const { LinkManager } = require('../src/link');
const { buildFrame } = require('../src/net/encode');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
function makeLink() {
  const events = [];
  const link = new LinkManager({ emit: (ch, p) => events.push([ch, p]) });
  return { link, events, data: () => events.filter((e) => e[0] === 'link:data').map((e) => e[1]), statuses: () => events.filter((e) => e[0] === 'link:status').map((e) => e[1]) };
}

(async () => {
  // ---- frame building as the UI uses it ----
  assert.strictEqual(buildFrame({ payload: 'POWER ON', encoding: 'ascii', delimiter: 'crlf' }).toString('hex'), '504f574552204f4e0d0a');
  assert.strictEqual(buildFrame({ payload: 'aa bb 00 21', encoding: 'hex', delimiter: 'none' }).toString('hex'), 'aabb0021');

  // ---- TCP ----
  {
    const received = [];
    let clientSock;
    const server = net.createServer((s) => { clientSock = s; s.on('data', (d) => { received.push(d.toString()); s.write(Buffer.from('OK:' + d.toString())); }); });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const port = server.address().port;
    const t = makeLink();

    assert.strictEqual((await t.link.send(Buffer.from('x'))).success, false, 'send while closed is rejected');
    const res = await t.link.open({ kind: 'tcp', ip: '127.0.0.1', port });
    assert.ok(res.success, 'tcp opens');
    const sent = await t.link.send(Buffer.from('lightson\r\n'));
    assert.ok(sent.success && sent.sentHex === '6c 69 67 68 74 73 6f 6e 0d 0a');
    await wait(200);
    assert.deepStrictEqual(received, ['lightson\r\n']);
    assert.strictEqual(t.data().length, 1, 'reply arrives as one coalesced entry');
    assert.strictEqual(t.data()[0].ascii, 'OK:lightson..');
    clientSock.write('unsolicited'); await wait(150);
    assert.strictEqual(t.data()[1].ascii, 'unsolicited', 'device-initiated data shows up');

    clientSock.destroy(); await wait(200);
    assert.strictEqual(t.link.status.state, 'closed');
    assert.match(t.link.status.error, /closed/i);
    assert.strictEqual((await t.link.send(Buffer.from('x'))).success, false);

    // refused / invalid
    server.close();
    const refused = await t.link.open({ kind: 'tcp', ip: '127.0.0.1', port });
    assert.ok(!refused.success && /refused/.test(refused.error), refused.error);
    assert.ok(!(await t.link.open({ kind: 'tcp', ip: '', port: 23 })).success);
    assert.ok(!(await t.link.open({ kind: 'tcp', ip: '1.2.3.4', port: 99999 })).success);
    console.log('tcp ok');
  }

  // ---- UDP ----
  {
    const peer = dgram.createSocket('udp4');
    const got = [];
    peer.on('message', (m, r) => { got.push(m.toString()); peer.send(Buffer.from('reply'), r.port, r.address); });
    await new Promise((r) => peer.bind(0, '127.0.0.1', r));
    const t = makeLink();
    const res = await t.link.open({ kind: 'udp', ip: '127.0.0.1', port: peer.address().port, localPort: '' });
    assert.ok(res.success, res.error);
    assert.ok((await t.link.send(Buffer.from('lightson'))).success);
    await wait(250);
    assert.deepStrictEqual(got, ['lightson']);
    assert.strictEqual(t.data()[0].ascii, 'reply');
    assert.match(t.data()[0].from, /^127\.0\.0\.1:\d+$/);
    await t.link.close();

    // explicit local port + port-in-use error
    const lp = 39000 + Math.floor(Math.random() * 500);
    const a = makeLink();
    assert.ok((await a.link.open({ kind: 'udp', ip: '127.0.0.1', port: peer.address().port, localPort: lp })).success);
    assert.match(a.link.status.label, new RegExp(`listening on ${lp}`));
    // a second app asking for the same local port gets a clear message
    const dup = makeLink();
    const dupRes = await dup.link.open({ kind: 'udp', ip: '127.0.0.1', port: 5001, localPort: lp });
    assert.ok(dupRes.success || /in use/.test(dupRes.error)); // reuseAddr lets sockets share on some OSes
    await dup.link.close(); await a.link.close(); peer.close();
    assert.ok(!(await makeLink().link.open({ kind: 'udp', ip: '', port: 5001 })).success);
    console.log('udp ok');
  }

  // ---- Serial (virtual pair made with socat) ----
  if (fs.existsSync('/usr/bin/socat')) {
    const A = '/tmp/avtty-a'; const B = '/tmp/avtty-b';
    const sc = spawn('socat', [`pty,raw,echo=0,link=${A}`, `pty,raw,echo=0,link=${B}`], { stdio: 'ignore' });
    await wait(600);
    const t = makeLink();
    const res = await t.link.open({ kind: 'serial', path: A, baudRate: 115200, dataBits: 8, parity: 'none', stopBits: 1, handshake: 'none' });
    assert.ok(res.success, res.error);
    assert.match(t.link.status.label, /115200 8N1/);

    const far = fs.createReadStream(B, { flags: 'r' }); const farBytes = [];
    far.on('data', (d) => farBytes.push(...d));
    const farW = fs.createWriteStream(B);
    const s = await t.link.send(Buffer.from('aabb0021', 'hex'));
    assert.ok(s.success);
    await wait(200);
    assert.deepStrictEqual(farBytes, [0xaa, 0xbb, 0x00, 0x21], 'bytes written to the COM port arrive on the other end');
    farW.write('POWER ON\r\n'); await wait(250);
    assert.strictEqual(t.data()[0].ascii, 'POWER ON..', 'bytes from the device show as RX');
    assert.ok(!(await makeLink().link.open({ kind: 'serial', path: '/tmp/does-not-exist' })).success);
    assert.ok(!(await makeLink().link.open({ kind: 'serial', path: '' })).success);
    await t.link.close();
    assert.strictEqual(t.link.status.state, 'closed');
    far.destroy(); farW.destroy(); sc.kill();
    console.log('serial ok');
  } else console.log('serial skipped (no socat)');

  console.log('link: all tests passed');
  process.exit(0);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
