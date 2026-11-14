#!/usr/bin/env node
// One command to ship an update:   npm run release            (patch: 0.3.0 -> 0.3.1)
//                                  npm run release -- minor   (0.3.0 -> 0.4.0)
//                                  npm run release -- 1.0.0   (exact version)
// It bumps the version, commits, tags and pushes. GitHub Actions then builds the
// Windows installer and publishes it as a release, and installed apps pick it up.
const { execFileSync } = require('child_process');

const bump = process.argv[2] || 'patch';
const run = (cmd, args) => execFileSync(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32' });
const out = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8', shell: process.platform === 'win32' }).trim();

try {
  out('git', ['rev-parse', '--is-inside-work-tree']);
} catch (e) {
  console.error('This folder is not a git repository yet. See README > "Publishing updates" for the one-time setup.');
  process.exit(1);
}

// Commit any pending changes first so they are part of the release.
if (out('git', ['status', '--porcelain'])) {
  run('git', ['add', '-A']);
  run('git', ['commit', '-m', `Changes for ${bump} release`]);
}

run('npm', ['version', bump, '-m', 'Release %s']); // bumps package.json, commits, tags vX.Y.Z
run('git', ['push', '--follow-tags']);
console.log('\nPushed. GitHub Actions is building the installer; installed apps update once the release appears.');
