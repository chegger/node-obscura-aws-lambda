#!/usr/bin/env node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const archivePath =
  process.env.OBSCURA_LAMBDA_ARCHIVE ||
  path.join(repoRoot, 'dist', 'obscura-x86_64-linux-lambda.tar.gz');
const lambdaImage = process.env.OBSCURA_LAMBDA_SMOKE_IMAGE || 'public.ecr.aws/lambda/nodejs:24';

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    ...options,
  });
  if (result.status !== 0) {
    throw new Error(`Command failed: ${command} ${args.join(' ')}`);
  }
}

function main() {
  if (!fs.existsSync(archivePath)) {
    throw new Error(`Archive not found at ${archivePath}. Run npm run build:artifact first.`);
  }

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'node-obscura-aws-lambda-smoke-'));
  const extractRoot = path.join(tempRoot, 'extract');
  fs.mkdirSync(extractRoot, { recursive: true });

  try {
    run('tar', ['-xzf', archivePath, '-C', extractRoot], { cwd: repoRoot });

    const script = [
      'set -euo pipefail',
      'chmod +x /opt/obscura/obscura',
      'if [ -f /opt/obscura/obscura-worker ]; then',
      '  chmod +x /opt/obscura/obscura-worker',
      'fi',
      '/opt/obscura/obscura serve --port 9222 >/tmp/obscura.log 2>&1 &',
      'pid=$!',
      "node -e 'const http=require(\"http\"); const started=Date.now(); const url=\"http://127.0.0.1:9222/json/version\"; (function poll(){ http.get(url, (res) => { let body=\"\"; res.setEncoding(\"utf8\"); res.on(\"data\", (chunk) => body += chunk); res.on(\"end\", () => { try { const parsed = JSON.parse(body); if (parsed && parsed.webSocketDebuggerUrl) process.exit(0); } catch {} if (Date.now() - started > 10000) process.exit(1); setTimeout(poll, 200); }); }).on(\"error\", () => { if (Date.now() - started > 10000) process.exit(1); setTimeout(poll, 200); }); })();'",
      'status=$?',
      'kill $pid || true',
      'wait $pid || true',
      'cat /tmp/obscura.log || true',
      'exit $status',
    ].join('\n');

    run(
      'docker',
      [
        'run',
        '--rm',
        '--entrypoint',
        'bash',
        '-v',
        `${extractRoot}:/opt/obscura`,
        lambdaImage,
        '-lc',
        script,
      ],
      { cwd: repoRoot }
    );

    console.log('[node-obscura-aws-lambda] Lambda smoke test passed.');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

main();
