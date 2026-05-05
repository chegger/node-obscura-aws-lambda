'use strict';

const fs = require('fs');
const http = require('http');
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');

const PLATFORM_KEY = 'linux-x64-lambda';

function assertSupportedPlatform() {
  if (process.platform !== 'linux' || process.arch !== 'x64') {
    throw new Error(
      `Unsupported ${PLATFORM_KEY} platform: ${process.platform}/${process.arch}.`
    );
  }
}

function getBinaryPath() {
  assertSupportedPlatform();
  const binaryPath = path.join(__dirname, 'binaries', PLATFORM_KEY, 'obscura');
  if (!fs.existsSync(binaryPath)) {
    throw new Error(
      `Obscura binary not found at ${binaryPath}. Reinstall @chegger/node-obscura-aws-lambda so postinstall can fetch it.`
    );
  }
  return binaryPath;
}

function findOpenPort(host) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, host, () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('Failed to allocate an Obscura port.')));
        return;
      }
      server.close((closeError) => {
        if (closeError) {
          reject(closeError);
          return;
        }
        resolve(address.port);
      });
    });
  });
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function logOutput(stream, prefix) {
  let buffer = '';
  stream.on('data', (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || '';
    for (const line of lines) {
      if (line.trim()) {
        console.log(`${prefix} ${line}`);
      }
    }
  });
  stream.on('end', () => {
    if (buffer.trim()) {
      console.log(`${prefix} ${buffer.trim()}`);
    }
  });
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const request = http.get(url, (response) => {
      if (!response.statusCode || response.statusCode >= 400) {
        response.resume();
        reject(new Error(`Unexpected status ${response.statusCode || 'unknown'} from ${url}`));
        return;
      }

      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        body += chunk;
      });
      response.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch (error) {
          reject(error);
        }
      });
    });
    request.on('error', reject);
  });
}

async function waitForReady(endpoint, timeoutMs, child) {
  const startedAt = Date.now();
  const versionUrl = `${endpoint}/json/version`;

  while (Date.now() - startedAt < timeoutMs) {
    if (child.exitCode !== null) {
      throw new Error(`Obscura exited before becoming ready (exit code ${child.exitCode}).`);
    }

    try {
      const version = await fetchJson(versionUrl);
      if (version && version.webSocketDebuggerUrl) {
        return version;
      }
    } catch {
      // Keep polling until timeout.
    }

    await wait(200);
  }

  throw new Error(`Timed out waiting for Obscura to become ready at ${versionUrl}.`);
}

async function stopChild(child) {
  if (child.exitCode !== null) {
    return;
  }

  child.kill('SIGTERM');
  const startedAt = Date.now();
  while (child.exitCode === null && Date.now() - startedAt < 3000) {
    await wait(100);
  }

  if (child.exitCode === null) {
    child.kill('SIGKILL');
  }
}

async function startObscura(options = {}) {
  const host = options.host || '127.0.0.1';
  const port = options.port || (await findOpenPort(host));
  const endpoint = `http://${host}:${port}`;
  const binaryPath = getBinaryPath();
  const args = ['serve', '--port', String(port)];

  if (host !== '127.0.0.1') {
    args.push('--host', host);
  }
  if (options.stealth) {
    args.push('--stealth');
  }
  if (Array.isArray(options.extraArgs) && options.extraArgs.length > 0) {
    args.push(...options.extraArgs);
  }

  const child = spawn(binaryPath, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  if (!child.stdout || !child.stderr) {
    throw new Error('Failed to attach to Obscura stdout/stderr.');
  }

  logOutput(child.stdout, '[obscura]');
  logOutput(child.stderr, '[obscura:stderr]');

  try {
    const version = await waitForReady(endpoint, options.startupTimeoutMs || 10000, child);
    return {
      endpoint,
      wsEndpoint: version.webSocketDebuggerUrl,
      close: async () => stopChild(child),
    };
  } catch (error) {
    await stopChild(child);
    throw error;
  }
}

module.exports = {
  getBinaryPath,
  startObscura,
};
