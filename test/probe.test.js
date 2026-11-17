// Runs "Get details" against small fake devices that speak each protocol.
const assert = require('assert');
const net = require('net');
const crypto = require('crypto');
const { getDetails, mergeCommands } = require('../src/probe');

function serve(onConnect) {
  return new Promise((resolve) => {
    const server = net.createServer(onConnect);
    server.listen(0, '127.0.0.1', () => resolve({ port: server.address().port, close: () => server.close() }));
  });
}
const lines = (sock, handler, sep = '\r') => {
  let buf = '';
  sock.on('data', (d) => { buf += d.toString('latin1'); let i; while ((i = buf.indexOf(sep)) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); handler(l); } });
  sock.on('error', () => {});
};
const details = (ports, creds) => getDetails({ ip: '127.0.0.1', creds, skipSystem: true, portOverride: ports });

(async () => {
  // ---------- PJLink (no password, class 2) ----------
  const PJ = { '%1CLSS ?': '%1CLSS=2', '%1NAME ?': '%1NAME=Boardroom PJ', '%1INF1 ?': '%1INF1=EPSON', '%1INF2 ?': '%1INF2=EB-L630U', '%1INFO ?': '%1INFO=ERR3', '%1POWR ?': '%1POWR=1', '%2SNUM ?': '%2SNUM=X4HF1234567', '%2SVER ?': '%2SVER=1.05' };
  const pj = await serve((s) => { s.write('PJLINK 0\r'); lines(s, (l) => s.write(`${PJ[l] || 'ERR1'}\r`)); });
  let r = await details({ 4352: pj.port });
  let m = r.matches[0];
  assert.strictEqual(m.profileId, 'pjlink');
  assert.deepStrictEqual([m.fields.manufacturer, m.fields.model, m.fields.serial, m.fields.firmware, m.fields.power, m.fields.name], ['EPSON', 'EB-L630U', 'X4HF1234567', '1.05', 'On', 'Boardroom PJ']);
  assert.ok(!('info' in m.fields), 'error replies are not shown as values');
  assert.ok(m.commandCount >= 10 && !r.needsLogin);
  pj.close();
  console.log('pjlink ok');

  // ---------- PJLink with password ----------
  const pja = await serve((s) => {
    s.write('PJLINK 1 498e4a67\r');
    const good = crypto.createHash('md5').update('498e4a67secret').digest('hex');
    let authed = false;
    lines(s, (l) => {
      if (!authed) { if (!l.startsWith(good)) { s.write('PJLINK ERRA\r'); return; } authed = true; l = l.slice(32); }
      s.write(`${PJ[l] || 'ERR1'}\r`);
    });
  });
  r = await details({ 4352: pja.port });
  assert.ok(r.needsLogin && r.matches[0].needsLogin && !r.matches[0].loginFailed, 'asks for the password');
  r = await details({ 4352: pja.port }, { password: 'wrong' });
  assert.ok(r.matches[0].needsLogin && r.matches[0].loginFailed, 'wrong password is reported');
  r = await details({ 4352: pja.port }, { password: 'secret' });
  assert.strictEqual(r.matches[0].fields.serial, 'X4HF1234567');
  assert.ok(!r.needsLogin);
  pja.close();
  console.log('pjlink login ok');

  // ---------- Extron with password ----------
  const ex = await serve((s) => {
    s.write('\r\n(c) Copyright 2019, Extron Electronics, IN1608 xi, V1.07, 60-1238-83\r\nTue, 17 Nov 2026 11:30:00\r\n\r\nPassword:');
    let authed = false; let buf = '';
    s.on('error', () => {});
    s.on('data', (d) => {
      buf += d.toString('latin1');
      if (!authed) { if (!buf.includes('\r')) return; const pw = buf.split('\r')[0]; buf = ''; if (pw === 'extron') { authed = true; s.write('\r\nLogin Administrator\r\n'); } else s.write('\r\nPassword:'); return; }
      const c = buf; buf = '';
      if (c === 'Q') s.write('1.07\r\n'); else if (c === 'N') s.write('60-1238-83\r\n'); else if (c === '1I') s.write('IN1608 xi\r\n');
      else if (c === '\x1BCH\r') s.write('00-05-A6-12-34-56\r\n'); else if (c === '\x1BCN\r') s.write('IN1608-Boardroom\r\n'); else s.write('E10\r\n');
    });
  });
  r = await details({ 23: ex.port });
  m = r.matches.find((x) => x.profileId === 'extron');
  assert.ok(m && m.needsLogin, 'extron asks for password');
  assert.strictEqual(m.fields.model, 'IN1608 xi');
  assert.strictEqual(r.matches.length, 1, 'other Telnet profiles do not claim an Extron');
  r = await details({ 23: ex.port }, { password: 'extron' });
  m = r.matches[0];
  assert.deepStrictEqual([m.fields.model, m.fields.firmware, m.fields.partNumber, m.fields.mac, m.fields.name, m.fields.access], ['IN1608 xi', '1.07', '60-1238-83', '00:05:A6:12:34:56', 'IN1608-Boardroom', 'Administrator']);
  assert.strictEqual(r.mac, '00:05:A6:12:34:56', 'device-reported MAC fills the summary');
  ex.close();
  console.log('extron ok');

  // ---------- Q-SYS ----------
  const qs = await serve((s) => {
    s.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'EngineStatus', params: { State: 'Active', DesignName: 'Boardroom', DesignCode: 'abc', IsRedundant: false, IsEmulator: false, Platform: 'Core 110f' } })}\0`);
    lines(s, (l) => { const q = JSON.parse(l); if (q.method === 'StatusGet') s.write(`${JSON.stringify({ jsonrpc: '2.0', id: q.id, result: { Platform: 'Core 110f', State: 'Active', DesignName: 'Boardroom', DesignCode: 'abc', IsRedundant: false, IsEmulator: false, Status: { Code: 0, String: 'OK' } } })}\0`); }, '\0');
  });
  r = await details({ 1710: qs.port });
  m = r.matches[0];
  assert.deepStrictEqual([m.profileId, m.fields.model, m.fields.designName, m.fields.status], ['qsys', 'Core 110f', 'Boardroom', 'OK']);
  qs.close();
  console.log('qsys ok');

  // ---------- Samsung MDC (display ID 1) ----------
  const ack = (id, command, data) => { const body = [0xff, id, data.length + 2, 0x41, command, ...data]; return Buffer.from([0xaa, ...body, body.reduce((a, b) => a + b, 0) & 0xff]); };
  const sm = await serve((s) => {
    s.on('error', () => {});
    s.on('data', (d) => {
      if (d[2] !== 0x01) return; // only answers its own ID
      if (d[1] === 0x00) s.write(ack(1, 0x00, [1, 25, 0, 0x21, 1, 0]));
      if (d[1] === 0x0b) s.write(ack(1, 0x0b, [...Buffer.from('0ABC3HDN123456')]));
      if (d[1] === 0x8a) s.write(ack(1, 0x8a, [...Buffer.from('QM55R')]));
      if (d[1] === 0x0e) s.write(ack(1, 0x0e, [...Buffer.from('T-KTM2ELAKUC-2140.6')]));
    });
  });
  r = await details({ 1515: sm.port });
  m = r.matches[0];
  assert.deepStrictEqual([m.profileId, m.fields.serial, m.fields.model, m.fields.power, m.fields.input, m.fields.displayId], ['samsung-mdc', '0ABC3HDN123456', 'QM55R', 'On', 'HDMI 1', '1']);
  const merged = mergeCommands(null, 'samsung-mdc', m.context);
  assert.strictEqual(merged.mapping.powerOn.payload, 'AA 11 01 01 01 14', 'power-on frame with correct checksum for ID 1');
  assert.strictEqual(merged.mapping.powerOff.payload, 'AA 11 01 01 00 13');
  assert.strictEqual(merged.mapping.sources[0].payload, 'AA 14 01 01 21 37');
  sm.close();
  console.log('samsung ok');

  // ---------- AMX with login, and Crestron ----------
  const amx = await serve((s) => {
    s.write('Welcome to NetLinx v4.1.419 Copyright AMX LLC 2016\r\nLogin : ');
    let stage = 0;
    lines(s, (l) => {
      if (stage === 0) { stage = 1; s.write('Password : '); return; }
      if (stage === 1) { if (l === 'pw') { stage = 2; s.write('\r\nLogin successful\r\n>'); } else { stage = 0; s.write('\r\nLogin not authorized\r\nLogin : '); } return; }
      if (/get ip/i.test(l)) s.write('IP Settings for 0:1:0\r\nHostName    AMXM9F1234\r\nType        DHCP\r\nIP Address  10.0.0.9\r\nMAC Address 00:60:9f:9f:12:34\r\n>');
      else if (/get sn/i.test(l)) s.write('Serial Number: 210512X1234567\r\n>');
      else if (/show device/i.test(l)) s.write('Device Info for <0:1:0>\r\n Name=NX-2200 Master Manufacturer=AMX LLC\r\n Version=v1.6.201\r\n>');
      else s.write('>');
    });
  });
  r = await details({ 23: amx.port });
  m = r.matches.find((x) => x.profileId === 'amx');
  assert.ok(m && m.needsLogin, 'amx asks for login');
  r = await details({ 23: amx.port }, { username: 'administrator', password: 'bad' });
  assert.ok(r.matches.find((x) => x.profileId === 'amx').loginFailed);
  r = await details({ 23: amx.port }, { username: 'administrator', password: 'pw' });
  m = r.matches.find((x) => x.profileId === 'amx');
  assert.deepStrictEqual([m.fields.serial, m.fields.mac, m.fields.hostname, m.fields.model], ['210512X1234567', '00:60:9F:9F:12:34', 'AMXM9F1234', 'NX-2200 Master Manufacturer=AMX LLC'.split(' Manufacturer')[0]]);
  amx.close();
  console.log('amx ok');

  const cr = await serve((s) => {
    s.write('\r\nCP3 Control Console\r\n\r\nCP3>');
    lines(s, (l) => {
      if (l === 'ver') s.write('\r\nCP3 Cntrl Eng [v1.8001.0146 (Dec 12 2022), #8AD3F1B2] @E-00107f8a1234\r\nCP3>');
      else if (l === 'hostname') s.write('\r\nHost Name: CP3-BOARDROOM\r\nCP3>');
      else if (/ipconfig/.test(l)) s.write('\r\nEthernet Adapter [LAN]:\r\n  MAC Address(es) . : 00.10.7f.8a.12.34\r\n  IP Address . . . : 10.0.0.5\r\nCP3>');
      else s.write('\r\nCP3>');
    });
  });
  r = await details({ 41795: cr.port });
  m = r.matches[0];
  assert.deepStrictEqual([m.profileId, m.fields.model, m.fields.firmware, m.fields.hostname, m.fields.mac, m.port], ['crestron', 'CP3', '1.8001.0146', 'CP3-BOARDROOM', '00:10:7F:8A:12:34', 41795]);
  cr.close();
  console.log('crestron ok');

  // ---------- unknown device + nothing there ----------
  const dumb = await serve((s) => { s.on('error', () => {}); s.write('hello\r\n'); });
  r = await details({ 23: dumb.port });
  assert.strictEqual(r.matches.length, 0, 'an unknown Telnet device matches no profile');
  assert.ok(r.reachable && r.openPorts.length === 1);
  dumb.close();
  await assert.rejects(() => getDetails({ ip: 'not-an-ip' }));

  // ---------- merging keeps what the user already entered ----------
  const mine = { powerOn: { label: 'Projector ON', payload: 'MY PWR', encoding: 'ascii', delimiter: 'cr' }, sources: [{ label: 'HDMI 1', payload: 'MINE' }, { label: 'HDMI 2', payload: '' }], custom: [{ label: 'Lights', payload: 'lightson' }, { label: 'Button 2', payload: '' }] };
  const out = mergeCommands(mine, 'pjlink').mapping;
  assert.strictEqual(out.powerOn.payload, 'MY PWR'); assert.strictEqual(out.powerOn.label, 'Projector ON');
  assert.strictEqual(out.powerOff.payload, '%1POWR 0');
  assert.strictEqual(out.sources.find((s) => s.label === 'HDMI 1').payload, 'MINE');
  assert.strictEqual(out.sources.find((s) => s.label === 'HDMI 2').payload, '%1INPT 32');
  assert.strictEqual(out.custom[0].payload, 'lightson');
  assert.ok(out.custom.length >= 12 && out.custom.some((c) => c.label === 'Lamp hours?'));

  console.log('probe: all tests passed');
  process.exit(0);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
