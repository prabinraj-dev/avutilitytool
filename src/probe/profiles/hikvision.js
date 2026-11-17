const crypto = require('crypto');

// Hikvision cameras and recorders: device information over the built-in web API (ISAPI),
// which needs the device's user name and password (HTTP digest login).
const md5 = (text) => crypto.createHash('md5').update(text).digest('hex');
const PATH = '/ISAPI/System/deviceInfo';
const tag = (xml, name) => ((new RegExp(`<${name}[^>]*>([^<]*)</${name}>`, 'i').exec(xml) || [])[1] || '').trim();

function digestHeader(challenge, { username, password }, method, uri) {
  const get = (key) => (new RegExp(`${key}="?([^",]+)"?`, 'i').exec(challenge) || [])[1] || '';
  const realm = get('realm'); const nonce = get('nonce'); const opaque = get('opaque');
  const qop = /qop="?[^",]*auth/i.test(challenge) ? 'auth' : '';
  const ha1 = md5(`${username}:${realm}:${password}`);
  const ha2 = md5(`${method}:${uri}`);
  const nc = '00000001';
  const cnonce = crypto.randomBytes(8).toString('hex');
  const response = qop ? md5(`${ha1}:${nonce}:${nc}:${cnonce}:${qop}:${ha2}`) : md5(`${ha1}:${nonce}:${ha2}`);
  return `Digest username="${username}", realm="${realm}", nonce="${nonce}", uri="${uri}", response="${response}"`
    + (qop ? `, qop=${qop}, nc=${nc}, cnonce="${cnonce}"` : '') + (opaque ? `, opaque="${opaque}"` : '');
}

module.exports = {
  id: 'hikvision',
  name: 'Hikvision camera / recorder',
  ports: [80, 443],
  protocol: 'tcp',
  loginHint: 'Hikvision user name (usually admin) and password',

  async identify({ request, creds, openPorts }) {
    const port = [80, 443].find((p) => openPorts.includes(p));
    const raw = [];
    let res = await request(port, PATH, {});
    if (!res) return { matched: false };
    raw.push(`> GET ${PATH}`, `< HTTP ${res.status}`);
    const challenge = String(res.headers['www-authenticate'] || '');
    if (res.status !== 200 && res.status !== 401) return { matched: false };
    let looksHik = /<DeviceInfo[\s>]/i.test(res.body)
      || /hikvision|IP ?Camera|\bDS-|\biDS-|DVR|NVR/i.test(challenge)
      || /hikvision|App-webs|DNVRS-Webs/i.test(String(res.headers.server || ''));
    if (!looksHik && res.status === 401) {
      // Other makes also answer 401 to unknown paths, so confirm with Hikvision's own login page.
      const page = await request(port, '/doc/page/login.asp', {});
      raw.push('> GET /doc/page/login.asp', `< HTTP ${page ? page.status : 'no reply'}`);
      looksHik = !!page && page.status === 200;
    }
    if (!looksHik) return { matched: false };
    const fields = { manufacturer: 'Hikvision' };

    if (res.status === 401) {
      if (!creds.username || !creds.password) return { matched: true, port, needsLogin: true, fields, raw };
      const auth = /digest/i.test(challenge)
        ? digestHeader(challenge, creds, 'GET', PATH)
        : `Basic ${Buffer.from(`${creds.username}:${creds.password}`).toString('base64')}`;
      res = await request(port, PATH, { Authorization: auth });
      raw.push('> GET (with login)', `< HTTP ${res ? res.status : 'no reply'}`);
      if (!res || res.status !== 200) return { matched: true, port, needsLogin: true, loginFailed: true, fields, raw };
    }
    if (!/<DeviceInfo[\s>]/i.test(res.body)) return { matched: false };
    raw.push(res.body.replace(/\s+/g, ' ').slice(0, 1500));
    const set = (key, value) => { if (value) fields[key] = value; };
    set('name', tag(res.body, 'deviceName'));
    set('model', tag(res.body, 'model'));
    set('serial', tag(res.body, 'serialNumber'));
    set('mac', tag(res.body, 'macAddress').toUpperCase());
    set('firmware', [tag(res.body, 'firmwareVersion'), tag(res.body, 'firmwareReleasedDate')].filter(Boolean).join(' '));
    set('deviceType', tag(res.body, 'deviceType'));
    return { matched: true, port, fields, raw };
  },

  commands: {
    note: 'Hikvision devices are controlled through their web API with a login, not with raw command strings, so there are no buttons to load. The details above are read-only.',
  },
};
