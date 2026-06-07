# @chegger/node-obscura-aws-lambda

AWS Lambda-specific Node.js wrapper around the
[Obscura](https://github.com/h4ckf0r0day/obscura) browser binary.

This package exists so Lambda consumers can install a Lambda-compatible
`obscura` build directly, without carrying the default desktop/server targets
from `@chegger/node-obscura`.

## Built Obscura version

The Lambda artifact in this repo is built from upstream Obscura
**v0.1.7** (`dist/build-metadata.json` records the exact tag and checksum).

## Install

```bash
npm install @chegger/node-obscura-aws-lambda
```

Supported target:

- Linux x64, intended for AWS Lambda `nodejs24.x`

## Usage

```js
const { chromium } = require('playwright-core');
const { startObscura } = require('@chegger/node-obscura-aws-lambda');

async function main() {
  const obscura = await startObscura({ stealth: true });
  const browser = await chromium.connectOverCDP(obscura.endpoint);

  try {
    const context = browser.contexts()[0] || (await browser.newContext());
    const page = await context.newPage();
    await page.goto('https://example.com');
    console.log(await page.title());
  } finally {
    await browser.close();
    await obscura.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
```

If you use CDK `NodejsFunction`, force Docker bundling so the postinstall step
runs in a Linux x64 Lambda-like environment and includes the downloaded binary
in the deployment artifact:

```ts
const myLambdaFunction = new lambda.NodejsFunction(this, 'MyLambdaFunction', {
  // ...
  runtime: l.Runtime.NODEJS_24_X,
  architecture: l.Architecture.X86_64,
  bundling: {
    forceDockerBundling: true,
    nodeModules: ['@chegger/node-obscura-aws-lambda'],
  },
});
```

## API

The runtime API intentionally mirrors `@chegger/node-obscura`.

### `getBinaryPath()`

Returns the installed Lambda-specific Obscura binary path.

### `startObscura(options?)`

Starts `obscura serve` and resolves when the CDP endpoint is ready.

Options:

- `port?: number`
- `host?: string`
- `stealth?: boolean`
- `startupTimeoutMs?: number`
- `extraArgs?: string[]`

Returns:

```ts
{
  endpoint: string;
  wsEndpoint: string;
  close: () => Promise<void>;
}
```

## Build the Lambda Artifact

This repo is Docker-first. You do not need Rust installed locally for the main
build flow.

```bash
npm run build:artifact
```

That script will:

1. clone the upstream `obscura` source
2. build it inside an Amazon Linux 2023 Docker image
3. package `obscura` and `obscura-worker` into:
   `dist/obscura-x86_64-linux-lambda.tar.gz`
4. write a checksum and build metadata

### Smoke-test the built artifact

```bash
npm run smoke:test
```

This runs the built binary inside the AWS Lambda Node 24 base image and waits
for `/json/version` to come up.

## Environment variables

Runtime install:

- `OBSCURA_AWS_LAMBDA_RELEASE_TAG` overrides the package release tag to
  download. Default: `v${package.version}`
- `OBSCURA_AWS_LAMBDA_DOWNLOAD_BASE_URL` overrides the binary download base URL
- `NODE_OBSCURA_AWS_LAMBDA_SKIP_DOWNLOAD=1` skips binary download during
  install

Build scripts:

- `OBSCURA_UPSTREAM_REPO` overrides the upstream Obscura git repo
- `OBSCURA_UPSTREAM_TAG` overrides the upstream Obscura git tag
- `OBSCURA_CARGO_FEATURES` overrides Cargo features. Default: `stealth`
- `OBSCURA_LAMBDA_DOCKER_TAG` overrides the local Docker builder image tag
- `OBSCURA_LAMBDA_ARCHIVE` overrides the archive path used by the smoke test
- `OBSCURA_LAMBDA_SMOKE_IMAGE` overrides the Lambda base image used by the
  smoke test

## License

MIT for this wrapper package. Obscura itself remains Apache-2.0 under its
upstream project.
