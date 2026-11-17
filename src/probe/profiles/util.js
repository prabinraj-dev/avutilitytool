// Builds one Control-page command entry.
function cmd(label, payload, { encoding = 'ascii', delimiter = 'cr', delimiterCustom = '', delimiterEncoding = 'text' } = {}) {
  return { label, payload, encoding, delimiter, delimiterCustom, delimiterEncoding };
}
const clean = (text) => String(text || '').replace(/[\x00-\x1f\x7f]+/g, ' ').trim();
module.exports = { cmd, clean };
