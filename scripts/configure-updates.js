#!/usr/bin/env node
// Points the app at your GitHub repository for updates.
//   node scripts/configure-updates.js OWNER/REPO
// Writes src/update-config.json (read by the app at runtime) and the
// build.publish block in package.json (used by electron-builder when publishing).
const fs = require('fs');
const path = require('path');
const { parseRepo } = require('../src/update-source');

const input = process.argv[2];
const repo = parseRepo(input);
if (!repo) {
  console.error('Usage: node scripts/configure-updates.js OWNER/REPO   (for example: acme/av-control-utility)');
  process.exit(1);
}

const root = path.join(__dirname, '..');
fs.writeFileSync(path.join(root, 'src', 'update-config.json'), `${JSON.stringify({ repo: `${repo.owner}/${repo.repo}` }, null, 2)}\n`);

const pkgPath = path.join(root, 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
pkg.build.publish = [{
  provider: 'github', owner: repo.owner, repo: repo.repo, releaseType: 'release',
}];
fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);

console.log(`Updates will be published to, and checked from: github.com/${repo.owner}/${repo.repo}`);
