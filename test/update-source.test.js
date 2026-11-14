const assert = require('assert');
const { parseRepo, resolveFeed } = require('../src/update-source');

assert.deepStrictEqual(parseRepo('acme/av-tool'), { owner: 'acme', repo: 'av-tool' });
assert.deepStrictEqual(parseRepo(' https://github.com/acme/av-tool '), { owner: 'acme', repo: 'av-tool' });
assert.deepStrictEqual(parseRepo('https://github.com/acme/av-tool.git'), { owner: 'acme', repo: 'av-tool' });
assert.deepStrictEqual(parseRepo('https://github.com/acme/av-tool/releases/latest/download'), { owner: 'acme', repo: 'av-tool' });
assert.strictEqual(parseRepo(''), null);
assert.strictEqual(parseRepo('OWNER/REPO'), null, 'placeholder must not count as configured');
assert.strictEqual(parseRepo('nonsense'), null);

const gh = { provider: 'github', owner: 'acme', repo: 'av-tool', releaseType: 'release' };
assert.deepStrictEqual(resolveFeed('', 'acme/av-tool'), gh, 'bundled repo used when setting empty');
assert.deepStrictEqual(resolveFeed('acme/av-tool', ''), gh);
assert.deepStrictEqual(resolveFeed('other/thing', 'acme/av-tool'), { ...gh, owner: 'other', repo: 'thing' }, 'setting overrides bundled');
assert.deepStrictEqual(resolveFeed('http://localhost:8123/', ''), { provider: 'generic', url: 'http://localhost:8123/' });
assert.strictEqual(resolveFeed('', ''), null);
assert.strictEqual(resolveFeed('', 'OWNER/REPO'), null);
assert.strictEqual(resolveFeed('garbage', 'acme/av-tool'), null, 'unparseable setting does not silently fall back');
console.log('update-source: all tests passed');
