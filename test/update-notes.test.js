const assert = require('assert');
const { notesToText, friendlyError } = require('../src/update-notes');

const html = '<h2>What&#39;s new</h2><ul><li>Console: TCP &amp; UDP &amp; serial</li><li>Blue <b>theme</b></li></ul><p>Fix &lt;tab&gt; bug</p><script>alert(1)</script>';
assert.strictEqual(notesToText(html), "What's new\n\n• Console: TCP & UDP & serial\n• Blue theme\n\nFix <tab> bug");
assert.strictEqual(notesToText([{ version: '1', note: '<p>A</p>' }, { version: '2', note: 'B' }]), 'A\n\nB');
assert.strictEqual(notesToText(null), '');
assert.ok(!/https?:/.test(friendlyError(new Error('HttpError: 404 url: https://github.com/prabinraj-dev/avutilitytool/releases/latest/download/latest.yml'))));
assert.ok(/internet/.test(friendlyError(new Error('net::ERR_INTERNET_DISCONNECTED getaddrinfo ENOTFOUND github.com'))));
assert.ok(!/github/.test(friendlyError(new Error('weird failure at https://github.com/x/y here'))));
console.log('update-notes: all tests passed');
