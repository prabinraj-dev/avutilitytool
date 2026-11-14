// Turns whatever the update feed gives us as "release notes" (HTML from GitHub,
// plain text, or a per-version list) into clean plain text for the update dialog.

const ENTITIES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&apos;': "'", '&nbsp;': ' ' };

function decode(text) {
  return text
    .replace(/&(amp|lt|gt|quot|apos|nbsp|#39);/g, (m) => ENTITIES[m])
    .replace(/&#(\d+);/g, (m, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (m, n) => String.fromCodePoint(parseInt(n, 16)));
}

function htmlToText(html) {
  return decode(
    String(html)
      .replace(/<\s*(script|style)[\s\S]*?<\/\s*\1\s*>/gi, '')
      .replace(/<\s*li[^>]*>/gi, '\n• ')
      .replace(/<\s*(\/ul|\/ol|\/h[1-6])\s*>/gi, '\n\n')
      .replace(/<\s*(br|\/p|\/div)\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, ''),
  )
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// notes: string | [{version, note}] | null
function notesToText(notes) {
  if (!notes) return '';
  const raw = Array.isArray(notes) ? notes.map((n) => n && n.note).filter(Boolean).join('\n\n') : String(notes);
  return htmlToText(raw).slice(0, 4000);
}

// Never show the update server's address (or any URL) in the UI.
function friendlyError(err) {
  const message = String(err && err.message ? err.message : err).split('\n')[0];
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|ECONNRESET|EAI_AGAIN|net::|socket hang up|getaddrinfo|network/i.test(message)) {
    return 'Could not reach the update server. Check your internet connection and try again.';
  }
  if (/404|Cannot find (channel|latest)|No published versions/i.test(message)) {
    return 'No update information is available right now.';
  }
  if (/sha512|checksum|signature/i.test(message)) {
    return 'The downloaded update failed its integrity check. Please try again.';
  }
  return message.replace(/https?:\/\/\S+/gi, '').replace(/\s+/g, ' ').trim().slice(0, 160) || 'Something went wrong while updating.';
}

module.exports = { htmlToText, notesToText, friendlyError };
