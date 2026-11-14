// Works out where updates come from. Pure functions, no Electron, so it is unit-tested.
//
// Priority:
//   1. "Update source" typed in Settings (owner/repo, a github.com URL, or a web folder URL)
//   2. The repository baked into the build (src/update-config.json, written by
//      `npm run configure-updates`)
// Returns a electron-updater provider options object, or null when nothing is configured.

const REPO_RE = /^([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))\/([A-Za-z0-9._-]{1,100})$/;
const PLACEHOLDER = /^(OWNER|YOUR[-_]?NAME|your-github-user)\//i;

function parseRepo(text) {
  const t = String(text || '').trim().replace(/\.git$/i, '').replace(/\/+$/, '');
  if (!t) return null;

  let m = REPO_RE.exec(t);
  if (!m) {
    // https://github.com/owner/repo  (optionally followed by /releases/... )
    m = /^https?:\/\/(?:www\.)?github\.com\/([^/\s]+)\/([^/\s]+)(?:\/.*)?$/i.exec(t);
  }
  if (!m || PLACEHOLDER.test(`${m[1]}/${m[2]}`)) return null;
  return { owner: m[1], repo: m[2].replace(/\.git$/i, '') };
}

function resolveFeed(settingValue, bundledRepo) {
  const typed = String(settingValue || '').trim();
  if (typed) {
    const repo = parseRepo(typed);
    if (repo) return { provider: 'github', owner: repo.owner, repo: repo.repo, releaseType: 'release' };
    if (/^https?:\/\//i.test(typed)) return { provider: 'generic', url: typed };
    return null; // typed something we can't understand: don't silently fall back
  }
  const repo = parseRepo(bundledRepo);
  if (repo) return { provider: 'github', owner: repo.owner, repo: repo.repo, releaseType: 'release' };
  return null;
}

function describeFeed(feed) {
  if (!feed) return '';
  return feed.provider === 'github' ? `github.com/${feed.owner}/${feed.repo}` : feed.url;
}

module.exports = { parseRepo, resolveFeed, describeFeed };
