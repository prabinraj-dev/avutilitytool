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

  // ---------- Lightware LW3 ----------
  const LW = { '/.ProductName': 'MMX4x2-HT200', '/.SerialNumber': '87654321', '/.PackageVersion': '1.6.0b10', '/MANAGEMENT/NETWORK.MacAddress': 'A8-D2-36-00-11-22', '/MANAGEMENT/NETWORK.HostName': 'lightware-87654321' };
  const lw = await serve((s) => lines(s, (l) => { const path = l.trim().replace(/^GET /, ''); s.write(LW[path] ? `pr ${path}=${LW[path]}\r\n` : `pE ${path} %E001:Syntax error\r\n`); }, '\n'));
  r = await details({ 6107: lw.port });
  m = r.matches[0];
  assert.deepStrictEqual([m.profileId, m.fields.model, m.fields.serial, m.fields.firmware, m.fields.mac, m.fields.hostname], ['lightware', 'MMX4x2-HT200', '87654321', '1.6.0b10', 'A8:D2:36:00:11:22', 'lightware-87654321']);
  assert.ok(!('partNumber' in m.fields));
  lw.close();
  console.log('lightware ok');

  // ---------- LG ----------
  const LGR = { 'ka 01 ff': 'a 01 OK01x', 'fy 01 ff': 'y 01 OK805KCRN1A234x', 'fz 01 ff': 'z 01 OK041030x', 'xb 01 ff': 'b 01 OK90x', 'kf 01 ff': 'f 01 OK14x' };
  const lg = await serve((s) => lines(s, (l) => s.write(LGR[l] || 'a 01 NG00x')));
  r = await details({ 9761: lg.port });
  m = r.matches[0];
  assert.deepStrictEqual([m.profileId, m.fields.serial, m.fields.firmware, m.fields.power, m.fields.input, m.fields.volume], ['lg', '805KCRN1A234', '041030', 'On', 'HDMI 1', '20']);
  assert.strictEqual(mergeCommands(null, 'lg').mapping.powerOn.payload, 'ka 01 01');
  lg.close();
  console.log('lg ok');

  // ---------- Hikvision (HTTP digest login) ----------
  const httpMod = require('http');
  const md5 = (t) => crypto.createHash('md5').update(t).digest('hex');
  const XML = '<?xml version="1.0"?><DeviceInfo version="2.0"><deviceName>Lobby Cam</deviceName><model>DS-2CD2143G2-I</model><serialNumber>DS-2CD2143G2-I20220101AAWRJ12345678</serialNumber><macAddress>a4:14:37:aa:bb:cc</macAddress><firmwareVersion>V5.7.3</firmwareVersion><firmwareReleasedDate>build 220112</firmwareReleasedDate><deviceType>IPCamera</deviceType></DeviceInfo>';
  const hik = await new Promise((resolve) => {
    const server = httpMod.createServer((req, res) => {
      if (req.url !== '/ISAPI/System/deviceInfo') { res.writeHead(404); res.end(); return; }
      const auth = req.headers.authorization || '';
      const g = (k) => (new RegExp(`${k}="?([^",]+)"?`).exec(auth) || [])[1];
      const expected = md5(`${md5('admin:IP Camera(H1234):Hik12345')}:abc123nonce:${g('nc')}:${g('cnonce')}:auth:${md5('GET:/ISAPI/System/deviceInfo')}`);
      if (auth && g('username') === 'admin' && g('response') === expected) { res.writeHead(200, { 'Content-Type': 'application/xml' }); res.end(XML); return; }
      res.writeHead(401, { 'WWW-Authenticate': 'Digest qop="auth", realm="IP Camera(H1234)", nonce="abc123nonce"' }); res.end();
    });
    server.listen(0, '127.0.0.1', () => resolve({ port: server.address().port, close: () => server.close() }));
  });
  r = await details({ 80: hik.port });
  m = r.matches.find((x) => x.profileId === 'hikvision');
  assert.ok(m && m.needsLogin && !m.loginFailed, 'hikvision asks for login');
  r = await details({ 80: hik.port }, { username: 'admin', password: 'nope' });
  assert.ok(r.matches.find((x) => x.profileId === 'hikvision').loginFailed);
  r = await details({ 80: hik.port }, { username: 'admin', password: 'Hik12345' });
  m = r.matches.find((x) => x.profileId === 'hikvision');
  assert.deepStrictEqual([m.fields.model, m.fields.serial, m.fields.mac, m.fields.firmware, m.fields.name], ['DS-2CD2143G2-I', 'DS-2CD2143G2-I20220101AAWRJ12345678', 'A4:14:37:AA:BB:CC', 'V5.7.3 build 220112', 'Lobby Cam']);
  hik.close();
  // an ordinary web server on port 80 is not mistaken for Hikvision
  const plain = await new Promise((resolve) => { const server = httpMod.createServer((req, res) => { res.writeHead(req.url === '/' ? 200 : 401, { 'WWW-Authenticate': 'Digest realm="router", nonce="x"' }); res.end('<title>Router</title>'); }); server.listen(0, '127.0.0.1', () => resolve({ port: server.address().port, close: () => server.close() })); });
  r = await details({ 80: plain.port });
  assert.strictEqual(r.matches.length, 0, 'generic 401 web server is not Hikvision');
  assert.strictEqual(r.web[0].title, 'Router');
  plain.close();
  console.log('hikvision ok');

  // ---------- Epson ESC/VP.net ----------
  const EP = { 'PWR?': 'PWR=01', 'SNO?': 'SNO=X4HF1234567', 'SOURCE?': 'SOURCE=30', 'LAMP?': 'LAMP=1234' };
  const epson = (needPw) => serve((s) => {
    let ready = false; let buf = Buffer.alloc(0);
    s.on('error', () => {});
    s.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      if (!ready) {
        if (buf.length < 16) return;
        const hasPw = buf[15] === 1 && buf.toString('latin1', 18, 34).replace(/\0+$/, '') === 'epsonpw';
        const ok = !needPw || hasPw;
        s.write(Buffer.concat([Buffer.from('ESC/VP.net\x10\x03\x00\x00', 'latin1'), Buffer.from([ok ? 0x20 : 0x41, 0x00])]));
        ready = ok; buf = Buffer.alloc(0); return;
      }
      const text = buf.toString('latin1'); if (!text.includes('\r')) return; buf = Buffer.alloc(0);
      const q = text.split('\r')[0];
      s.write(`${EP[q] || 'ERR'}\r:`);
    });
  });
  const ep = await epson(false);
  r = await details({ 3629: ep.port });
  m = r.matches[0];
  assert.deepStrictEqual([m.profileId, m.fields.serial, m.fields.power, m.fields.input, m.fields.lampHours], ['epson', 'X4HF1234567', 'On', 'HDMI 1', '1234']);
  ep.close();
  const ep2 = await epson(true);
  r = await details({ 3629: ep2.port });
  assert.ok(r.matches[0].needsLogin && !r.matches[0].loginFailed);
  r = await details({ 3629: ep2.port }, { password: 'epsonpw' });
  assert.strictEqual(r.matches[0].fields.serial, 'X4HF1234567');
  ep2.close();
  console.log('epson ok');

  // ---------- Panasonic NTCONTROL (protected) ----------
  const pana = await serve((s) => {
    s.write('NTCONTROL 1 0a1b2c3d\r');
    const good = crypto.createHash('md5').update('admin1:panasonic:0a1b2c3d').digest('hex');
    lines(s, (l) => { if (!l.startsWith(good)) { s.write('ERRA\r'); return; } s.write(l.slice(32) === '00QPW' ? '00001\r' : '00ER401\r'); });
  });
  r = await details({ 1024: pana.port });
  assert.ok(r.matches[0].profileId === 'panasonic' && r.matches[0].needsLogin);
  r = await details({ 1024: pana.port }, { username: 'admin1', password: 'wrong' });
  assert.ok(r.matches[0].loginFailed);
  r = await details({ 1024: pana.port }, { username: 'admin1', password: 'panasonic' });
  assert.strictEqual(r.matches[0].fields.power, 'On');
  pana.close();
  console.log('panasonic ok');

  // ---------- BenQ ----------
  const BQ = { 'modelname=?': '*MODELNAME=LU935ST#', 'pow=?': '*POW=ON#', 'sour=?': '*SOUR=HDMI#', 'ltim=?': '*LTIM=1500#' };
  const bq = await serve((s) => { let buf = ''; s.on('error', () => {}); s.on('data', (d) => { buf += d.toString('latin1'); const mm = /\*([^#]+)#/.exec(buf); if (!mm) return; buf = ''; s.write(`>*${mm[1]}#\r\r\n${BQ[mm[1]] || '*Illegal format#'}\r\n`); }); });
  r = await details({ 8000: bq.port });
  m = r.matches[0];
  assert.deepStrictEqual([m.profileId, m.fields.model, m.fields.power, m.fields.input, m.fields.lampHours], ['benq', 'LU935ST', 'On', 'HDMI', '1500']);
  assert.strictEqual(mergeCommands(null, 'benq').mapping.powerOff.payload, '*pow=off#');
  bq.close();
  console.log('benq ok');

  // ---------- Barco Pulse ----------
  const BA = { 'system.serialnumber': '2590123456', 'system.modelname': 'UDX-4K32', 'system.firmwareversion': '2.4.19', 'system.state': 'on' };
  const ba = await serve((s) => { s.on('error', () => {}); s.on('data', (d) => { const q = JSON.parse(d.toString()); s.write(JSON.stringify({ jsonrpc: '2.0', result: BA[q.params.property], id: q.id })); }); });
  r = await details({ 9090: ba.port });
  m = r.matches[0];
  assert.deepStrictEqual([m.profileId, m.fields.serial, m.fields.model, m.fields.firmware, m.fields.state], ['barco', '2590123456', 'UDX-4K32', '2.4.19', 'on']);
  ba.close();
  console.log('barco ok');

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
