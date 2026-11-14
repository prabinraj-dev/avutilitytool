// Turns user-entered text into raw bytes on the way out, and raw bytes
// back into readable hex/ASCII views on the way in.

function cleanHex(str) {
  return String(str || '').replace(/0x/gi, '').replace(/[^0-9a-fA-F]/g, '');
}

function encodeText(value, encoding) {
  if (value == null) return Buffer.alloc(0);
  if (encoding === 'hex') {
    const cleaned = cleanHex(value);
    if (cleaned.length % 2 !== 0) {
      throw new Error('Hex value must have an even number of digits');
    }
    return Buffer.from(cleaned, 'hex');
  }
  if (encoding === 'ascii') {
    return Buffer.from(String(value), 'ascii');
  }
  return Buffer.from(String(value), 'utf8'); // default utf8
}

const DELIMITER_PRESETS = {
  none: Buffer.alloc(0),
  cr: Buffer.from([0x0d]),
  lf: Buffer.from([0x0a]),
  crlf: Buffer.from([0x0d, 0x0a]),
};

function encodeDelimiter(delimiter, customValue, customEncoding) {
  if (delimiter === 'custom') {
    return encodeText(customValue || '', customEncoding === 'hex' ? 'hex' : 'utf8');
  }
  return DELIMITER_PRESETS[delimiter] || Buffer.alloc(0);
}

// params: { payload, encoding, delimiter, delimiterCustom, delimiterEncoding }
function buildFrame(params) {
  const body = encodeText(params.payload, params.encoding);
  const term = encodeDelimiter(params.delimiter, params.delimiterCustom, params.delimiterEncoding);
  return Buffer.concat([body, term]);
}

function toHexView(buffer) {
  if (!buffer || !buffer.length) return '';
  return Array.from(buffer).map((b) => b.toString(16).padStart(2, '0')).join(' ');
}

function toAsciiView(buffer) {
  if (!buffer || !buffer.length) return '';
  return Array.from(buffer).map((b) => (b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : '.')).join('');
}

module.exports = {
  encodeText, encodeDelimiter, buildFrame, toHexView, toAsciiView, DELIMITER_PRESETS,
};
