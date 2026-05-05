#!/usr/bin/env node

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const workRoot = path.join(repoRoot, 'build');
const distRoot = path.join(repoRoot, 'dist');
const outputRoot = path.join(workRoot, 'output');
const sourceRoot = path.join(workRoot, 'obscura-src');
const builderTag = process.env.OBSCURA_LAMBDA_DOCKER_TAG || 'node-obscura-aws-lambda-builder';

const upstreamRepo =
  process.env.OBSCURA_UPSTREAM_REPO || 'https://github.com/h4ckf0r0day/obscura.git';
const upstreamTag = process.env.OBSCURA_UPSTREAM_TAG || 'v0.1.2';
const cargoFeatures = process.env.OBSCURA_CARGO_FEATURES || 'stealth';
const archiveName = 'obscura-x86_64-linux-lambda.tar.gz';
const archivePath = path.join(distRoot, archiveName);

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    ...options,
  });
  if (result.status !== 0) {
    throw new Error(`Command failed: ${command} ${args.join(' ')}`);
  }
}

function ensureCleanDir(targetPath) {
  fs.rmSync(targetPath, { recursive: true, force: true });
  fs.mkdirSync(targetPath, { recursive: true });
}

function sha256(filePath) {
  const hash = createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

function writeMetadata() {
  const metadataPath = path.join(distRoot, 'build-metadata.json');
  fs.writeFileSync(
    metadataPath,
    JSON.stringify(
      {
        upstreamRepo,
        upstreamTag,
        cargoFeatures: cargoFeatures ? cargoFeatures.split(',').map((v) => v.trim()) : [],
        archiveName,
        sha256: sha256(archivePath),
      },
      null,
      2
    ) + '\n'
  );
}

function cloneUpstream() {
  ensureCleanDir(sourceRoot);
  run('git', ['clone', '--depth', '1', '--branch', upstreamTag, upstreamRepo, sourceRoot]);
}

function buildDockerImage() {
  run('docker', ['build', '-t', builderTag, '-f', 'Dockerfile.lambda-builder', '.'], {
    cwd: repoRoot,
  });
}

function buildObscura() {
  ensureCleanDir(outputRoot);

  const cargoCommand = cargoFeatures
    ? `cargo build --release --features ${cargoFeatures}`
    : 'cargo build --release';
  const script = [
    'set -euo pipefail',
    `cd ${JSON.stringify('/src')}`,
    cargoCommand,
    'cp target/release/obscura /out/obscura',
    'if [ -f target/release/obscura-worker ]; then cp target/release/obscura-worker /out/obscura-worker; fi',
    'chmod 755 /out/obscura',
    'if [ -f /out/obscura-worker ]; then chmod 755 /out/obscura-worker; fi',
  ].join(' && ');

  run(
    'docker',
    [
      'run',
      '--rm',
      '-v',
      `${sourceRoot}:/src`,
      '-v',
      `${outputRoot}:/out`,
      builderTag,
      'bash',
      '-lc',
      script,
    ],
    { cwd: repoRoot }
  );
}

function createArchive() {
  fs.mkdirSync(distRoot, { recursive: true });
  fs.rmSync(archivePath, { force: true });

  const tarEntries = fs
    .readdirSync(outputRoot)
    .filter((fileName) => fileName === 'obscura' || fileName === 'obscura-worker');

  if (!tarEntries.includes('obscura')) {
    throw new Error('Build output did not contain obscura.');
  }

  run('tar', ['-czf', archivePath, '-C', outputRoot, ...tarEntries], { cwd: repoRoot });
  fs.writeFileSync(path.join(distRoot, `${archiveName}.sha256`), `${sha256(archivePath)}  ${archiveName}\n`);
}

function main() {
  fs.mkdirSync(workRoot, { recursive: true });
  console.log(`[node-obscura-aws-lambda] Building ${upstreamRepo} @ ${upstreamTag}`);
  console.log(
    '[node-obscura-aws-lambda] Docker-first build: local Rust is not required for this workflow.'
  );

  cloneUpstream();
  buildDockerImage();
  buildObscura();
  createArchive();
  writeMetadata();

  console.log(`[node-obscura-aws-lambda] Wrote ${archivePath}`);
}

main();
