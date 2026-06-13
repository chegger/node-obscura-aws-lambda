#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import path from 'node:path';

const version = process.argv[2]?.replace(/^v/, '');
if (!version || !/^\d+\.\d+\.\d+/.test(version)) {
  console.error('Usage: npm run version:set -- <version>');
  console.error('Example: npm run version:set -- 0.1.9');
  process.exit(1);
}

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const upstreamRepo =
  process.env.OBSCURA_UPSTREAM_REPO || 'https://github.com/h4ckf0r0day/obscura.git';

const check = spawnSync('git', ['ls-remote', '--tags', upstreamRepo, `v${version}`], {
  encoding: 'utf8',
});

if (check.status !== 0) {
  console.error(`Failed to check upstream tag v${version} in ${upstreamRepo}`);
  process.exit(check.status ?? 1);
}

if (!check.stdout.trim()) {
  console.error(`Upstream Obscura tag v${version} was not found in ${upstreamRepo}`);
  process.exit(1);
}

const bump = spawnSync('npm', ['version', version, '--no-git-tag-version'], {
  cwd: repoRoot,
  stdio: 'inherit',
});

if (bump.status !== 0) {
  process.exit(bump.status ?? 1);
}

console.log(`[node-obscura-aws-lambda] Set package version to ${version} (builds upstream v${version}).`);
console.log('[node-obscura-aws-lambda] Next: commit, push main, then tag and push v' + version);
