'use strict';

const fs = require('fs');
const https = require('https');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const packageJson = require('./package.json');

const RELEASE_TAG = process.env.OBSCURA_AWS_LAMBDA_RELEASE_TAG || `v${packageJson.version}`;
const DOWNLOAD_BASE_URL =
  process.env.OBSCURA_AWS_LAMBDA_DOWNLOAD_BASE_URL ||
  'https://github.com/chegger/node-obscura-aws-lambda/releases/download';
const SKIP_DOWNLOAD = process.env.NODE_OBSCURA_AWS_LAMBDA_SKIP_DOWNLOAD === '1';
const PLATFORM_KEY = 'linux-x64-lambda';
const ASSET_NAME = 'obscura-x86_64-linux-lambda.tar.gz';
const PACKAGE_ROOT = __dirname;

function assertSupportedPlatform() {
  if (process.platform !== 'linux' || process.arch !== 'x64') {
    console.warn(
      `[@chegger/node-obscura-aws-lambda] Skipping download for unsupported platform ${process.platform}/${process.arch}.`
    );
    return false;
  }
  return true;
}

function download(url, destination, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    const request = https.get(
      url,
      {
        headers: {
          'User-Agent': '@chegger/node-obscura-aws-lambda',
        },
      },
      (response) => {
        if (
          response.statusCode &&
          response.statusCode >= 300 &&
          response.statusCode < 400 &&
          response.headers.location
        ) {
          response.resume();
          if (redirectCount >= 5) {
            reject(new Error(`Too many redirects while downloading ${url}`));
            return;
          }
          download(response.headers.location, destination, redirectCount + 1)
            .then(resolve)
            .catch(reject);
          return;
        }

        if (!response.statusCode || response.statusCode >= 400) {
          response.resume();
          reject(new Error(`Failed to download ${url}: status ${response.statusCode || 'unknown'}`));
          return;
        }

        const file = fs.createWriteStream(destination);
        response.pipe(file);
        file.on('finish', () => {
          file.close(resolve);
        });
        file.on('error', (error) => {
          file.close(() => reject(error));
        });
      }
    );
    request.on('error', reject);
  });
}

async function main() {
  if (SKIP_DOWNLOAD) {
    console.log(
      '[@chegger/node-obscura-aws-lambda] Skipping binary download because NODE_OBSCURA_AWS_LAMBDA_SKIP_DOWNLOAD=1'
    );
    return;
  }

  if (!assertSupportedPlatform()) {
    return;
  }

  const targetDir = path.join(PACKAGE_ROOT, 'binaries', PLATFORM_KEY);
  const targetBinary = path.join(targetDir, 'obscura');
  if (fs.existsSync(targetBinary)) {
    return;
  }

  fs.mkdirSync(targetDir, { recursive: true });

  const downloadUrl = `${DOWNLOAD_BASE_URL}/${RELEASE_TAG}/${ASSET_NAME}`;
  const tempArchive = path.join(os.tmpdir(), `${ASSET_NAME}-${Date.now()}`);
  const extractDir = fs.mkdtempSync(path.join(os.tmpdir(), 'node-obscura-aws-lambda-'));

  try {
    console.log(`[@chegger/node-obscura-aws-lambda] Downloading ${downloadUrl}`);
    await download(downloadUrl, tempArchive);
    execFileSync('tar', ['-xzf', tempArchive, '-C', extractDir], { stdio: 'inherit' });

    for (const fileName of ['obscura', 'obscura-worker']) {
      const extractedFile = path.join(extractDir, fileName);
      if (fs.existsSync(extractedFile)) {
        const destination = path.join(targetDir, fileName);
        fs.copyFileSync(extractedFile, destination);
        fs.chmodSync(destination, 0o755);
      }
    }

    if (!fs.existsSync(targetBinary)) {
      throw new Error(`Extracted archive did not contain obscura at ${targetBinary}`);
    }

    console.log(
      `[@chegger/node-obscura-aws-lambda] Installed Obscura to ${targetBinary}`
    );
  } finally {
    fs.rmSync(extractDir, { recursive: true, force: true });
    fs.rmSync(tempArchive, { force: true });
  }
}

main().catch((error) => {
  console.error('[@chegger/node-obscura-aws-lambda] Failed to install Obscura:', error);
  process.exit(1);
});
