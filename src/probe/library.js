// Online protocol library: command sets live in the repo's protocols/ folder, not in the app.
// The app downloads the index once per session and then only the file for the device it found.
const KEYS = ['powerOn', 'powerOff', 'volumeUp', 'volumeDown', 'mute', 'volumeSet'];
const TIMEOUT_MS = 6000;

class OfflineError extends Error {}

// fetchText(url) -> Promise<{ status, text }>; rejects on network failure.
function createLibrary({ baseUrl, fetchText }) {
  let indexPromise = null;
  const files = new Map();

  const get = async (path) => {
    let res;
    try {
      res = await Promise.race([
        fetchText(`${baseUrl}${path}`),
        new Promise((_, reject) => { setTimeout(() => reject(new Error('timeout')), TIMEOUT_MS); }),
      ]);
    } catch (e) {
      throw new OfflineError('No internet connection');
    }
    if (res.status === 404) return null;
    if (res.status !== 200) throw new Error(`The protocol library is not available right now (HTTP ${res.status}).`);
    try { return JSON.parse(res.text); } catch (e) { throw new Error('The protocol library returned unreadable data.'); }
  };

  const index = () => {
    if (!indexPromise) indexPromise = get('index.json').catch((e) => { indexPromise = null; throw e; });
    return indexPromise;
  };

  async function lookup({ profileId, manufacturer, model }) {
    const idx = await index();
    if (!idx) return null;
    const file = (profileId && idx.profiles && idx.profiles[profileId])
      || (manufacturer && idx.manufacturers && idx.manufacturers[String(manufacturer).trim().toLowerCase()]);
    if (!file || !/^[\w.-]+\.json$/.test(file)) return null; // only plain file names from the library
    if (!files.has(file)) files.set(file, get(file).catch((e) => { files.delete(file); throw e; }));
    const entry = await files.get(file);
    if (!entry) return null;
    // Model-specific overrides: the longest matching model prefix wins.
    const name = String(model || '').trim().toUpperCase();
    const key = Object.keys(entry.models || {})
      .filter((k) => k && name.startsWith(k.toUpperCase()))
      .sort((a, b) => b.length - a.length)[0];
    const override = key ? entry.models[key] : {};
    return {
      id: entry.id || profileId,
      name: entry.name || '',
      protocol: override.protocol || entry.protocol || 'tcp',
      port: override.port || entry.port || null,
      note: override.note || entry.note || '',
      matchedModel: key || '',
      commands: { ...(entry.commands || {}), ...(override.commands || {}) },
    };
  }

  return { lookup };
}

// Fills {id} and {cs} in hex templates (Samsung MDC style: checksum = sum of bytes after the first).
function resolveTemplate(command, context = {}) {
  if (!command || typeof command.payload !== 'string' || !/\{(id|cs)\}/.test(command.payload)) return command;
  const id = Number(context.id) || 0;
  const bytes = command.payload.replace('{id}', id.toString(16).padStart(2, '0').toUpperCase()).split(/\s+/).filter(Boolean);
  const cs = bytes.slice(1).filter((b) => b !== '{cs}').reduce((sum, b) => sum + parseInt(b, 16), 0) & 0xff;
  return { ...command, payload: bytes.map((b) => (b === '{cs}' ? cs.toString(16).padStart(2, '0').toUpperCase() : b)).join(' ') };
}

const isCommand = (c) => c && typeof c === 'object' && typeof c.payload === 'string';
function cleanCommand(c, context) {
  const r = resolveTemplate(c, context);
  return {
    label: String(r.label || '').slice(0, 40),
    payload: String(r.payload).slice(0, 2000),
    encoding: ['ascii', 'utf8', 'hex'].includes(r.encoding) ? r.encoding : 'ascii',
    delimiter: ['none', 'cr', 'lf', 'crlf', 'custom'].includes(r.delimiter) ? r.delimiter : 'cr',
    delimiterCustom: String(r.delimiterCustom || '').slice(0, 20),
    delimiterEncoding: r.delimiterEncoding === 'hex' ? 'hex' : 'text',
  };
}

// Checks a downloaded command set and fills in device-specific values.
function prepareCommands(commands, context) {
  const out = {};
  KEYS.forEach((k) => { if (isCommand(commands[k])) out[k] = cleanCommand(commands[k], context); });
  ['sources', 'custom'].forEach((k) => {
    if (Array.isArray(commands[k])) out[k] = commands[k].filter(isCommand).slice(0, 64).map((c) => cleanCommand(c, context));
  });
  return out;
}

function countCommands(commands) {
  return KEYS.filter((k) => commands[k]).length + (commands.sources || []).length + (commands.custom || []).length;
}

module.exports = { createLibrary, prepareCommands, countCommands, OfflineError };
