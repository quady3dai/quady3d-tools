<a href="https://quady3d.com/developers/sdk/typescript"><img src="https://quady3d.com/assets/brand/moki3d/moki-monster-maskable-512.png" alt="Quady3D" width="96"></a>

# Quady3D JavaScript / TypeScript SDK 0.1.2

[Official setup](https://quady3d.com/developers/sdk/typescript) · [API documentation](https://quady3d.com/developers/docs) · [Models](https://quady3d.com/developers/models) · [Source](https://github.com/quady3dai/quady3d-tools)

Official MIT-licensed client by Quady3D AI. Node.js 22+ is required. Query models and accounts, upload one selected image, quote and create idempotent tasks, wait for their original result and stream asset bytes into a caller-owned writer. No runtime dependencies are required.

## Install

```sh
npm install --ignore-scripts @quady3d/sdk@0.1.2
```

Install the exact version from the official npm organization. [Versioned archives and checksums](https://quady3d.com/developers#downloads) and [MIT-licensed source](https://github.com/quady3dai/quady3d-tools) are also available.

## Connect and query

Create a key at [Connected apps](https://quady3d.com/account?section=connections). Set `QUADY3D_API_KEY` in your trusted application's environment through your secret manager. Do not embed it in browser code, commit it or send it in chat. Generate and download keys have separate per-job and daily credit limits. Account credits and model download access are separate requirements.

```js
import { Quady3D } from "@quady3d/sdk";
const client = new Quady3D({ apiKey: process.env.QUADY3D_API_KEY, timeoutMs: 120_000 });
console.log(await client.account());
console.log(await client.models());
```

These queries do not create a paid task. The default API is `https://quady3d.com/api/v1`. HTTPS and no redirects are enforced; HTTP is allowed only for loopback development. Requests default to 120 seconds; waiting has its own total deadline. Large or slow file transfers can require a later download attempt without generating again. The request timeout includes response body transfer.

## Create, recover and save

See the [complete TypeScript example](https://quady3d.com/developers/sdk/typescript) for text and selected-image generation, persistent original-request recovery and no-overwrite file delivery. Choose an available model, get a quote and authorize its credit amount before submitting. Preserve the exact original body and idempotency key if the submission outcome is uncertain. Once a job ID is known, use it to wait or download; do not quote and submit a replacement.

The writer receives bounded binary chunks; your application chooses the temporary file, final path, cleanup and no-overwrite publication. The SDK does not create directories or open third-party asset URLs. Metadata responses are limited to 1 MiB. Downloads default to 512 MiB. Errors include a stable code, request ID and retry information where available. Status waiting retries reads only; paid submission and file download are not retried automatically. Never log credentials or complete private request records.

## Compatibility and removal

This release has been installed on macOS with Node.js 22 and used against the production API. Other supported runtime versions and operating systems still require compatibility verification. Use `npm uninstall @quady3d/sdk`. Updating or uninstalling does not cancel accepted jobs or delete saved files; revoke the key separately to disconnect.

The MIT license covers this client code, not the hosted service, models or generated assets. See LICENSE, NOTICE.txt and the [API contract](https://quady3d.com/api/v1/openapi).


Requests default to 120 seconds. Downloads stream with a default 512 MiB limit (up to 1 GiB when configured). Retry a stopped transfer using the same asset ID and a fresh temporary file. Byte-range resume is not implemented. The complete examples clean up handled partial downloads and publish without overwriting an existing output.
