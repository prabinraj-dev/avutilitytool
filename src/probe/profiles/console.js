const { clean } = require('./util');

// Shared login handling for Telnet-style consoles (Crestron, AMX).
// Returns { ok, needsLogin, loginFailed, text }.
async function consoleLogin(s, creds, raw, firstText) {
  let text = firstText;
  for (let i = 0; i < 3; i += 1) {
    if (/(login|user\s*name|username)\s*:\s*$/i.test(text.trim())) {
      if (!creds.username) return { needsLogin: true, text };
      text = await s.askText(`${creds.username}\r`, { quietMs: 500, maxMs: 2500 });
      raw.push('> (user name)', `< ${clean(text)}`);
    } else if (/password\s*:\s*$/i.test(text.trim())) {
      if (!creds.password) return { needsLogin: true, text };
      text = await s.askText(`${creds.password}\r`, { quietMs: 600, maxMs: 3000 });
      raw.push('> (password)', `< ${clean(text)}`);
      if (/(password|login|user\s*name)\s*:\s*$/i.test(text.trim()) || /invalid|incorrect|denied|fail/i.test(text)) {
        return { needsLogin: true, loginFailed: true, text };
      }
    } else break;
  }
  return { ok: true, text };
}

module.exports = { consoleLogin };
