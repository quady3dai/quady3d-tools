<a href="https://quady3d.com/developers/sdk/python"><img src="https://quady3d.com/assets/brand/moki3d/moki-monster-maskable-512.png" alt="Quady3D" width="96"></a>

# Quady3D Python SDK 0.1.2

[Official setup](https://quady3d.com/developers/sdk/python) · [API documentation](https://quady3d.com/developers/docs) · [Models](https://quady3d.com/developers/models) · [Source](https://github.com/quady3dai/quady3d-tools)

Official MIT-licensed client by Quady3D AI. Python 3.10+ is required. Query models and accounts, upload one selected image, quote and create idempotent tasks, wait for their original result and stream asset bytes into a caller-owned writer. No runtime dependencies are required.

## Install

```sh
python3 -m venv .venv
. .venv/bin/activate
python -m pip install quady3d==0.1.2
```

Install the exact version from the official PyPI project. [Versioned archives and checksums](https://quady3d.com/developers#downloads) and [MIT-licensed source](https://github.com/quady3dai/quady3d-tools) are also available.

## Connect and query

Create a key at [Connected apps](https://quady3d.com/account?section=connections). Set `QUADY3D_API_KEY` in your trusted application's environment through your secret manager. Do not embed it in browser code, commit it or send it in chat. Generate and download keys have separate per-job and daily credit limits. Account credits and model download access are separate requirements.

```python
import os
from quady3d import Quady3D
client = Quady3D(api_key=os.environ["QUADY3D_API_KEY"], timeout=120)
print(client.account())
print(client.models())
```

These queries do not create a paid task. The default API is `https://quady3d.com/api/v1`. HTTPS and no redirects are enforced; HTTP is allowed only for loopback development. Requests default to 120 seconds; waiting has its own total deadline. Large or slow file transfers can require a later download attempt without generating again. The timeout bounds individual blocking socket operations, so total streaming time can exceed it.

## Create, recover and save

See the [complete Python example](https://quady3d.com/developers/sdk/python) for text and selected-image generation, persistent original-request recovery and no-overwrite file delivery. Choose an available model, get a quote and authorize its credit amount before submitting. Preserve the exact original body and idempotency key if the submission outcome is uncertain. Once a job ID is known, use it to wait or download; do not quote and submit a replacement.

The writer receives bounded binary chunks; your application chooses the temporary file, final path, cleanup and no-overwrite publication. The SDK does not create directories or open third-party asset URLs. Metadata responses are limited to 1 MiB. Downloads default to 512 MiB. Errors include a stable code, request ID and retry information where available. Status waiting retries reads only; paid submission and file download are not retried automatically. Never log credentials or complete private request records.

## Compatibility and removal

This release has been installed on macOS with Python 3.12 and used against the production API. Other supported runtime versions and operating systems still require compatibility verification. Use `python -m pip uninstall quady3d`. Updating or uninstalling does not cancel accepted jobs or delete saved files; revoke the key separately to disconnect.

The MIT license covers this client code, not the hosted service, models or generated assets. See LICENSE, NOTICE.txt and the [API contract](https://quady3d.com/api/v1/openapi).


Requests default to 120 seconds. Downloads stream with a default 512 MiB limit (up to 1 GiB when configured). Retry a stopped transfer using the same asset ID and a fresh temporary file. Byte-range resume is not implemented. The complete examples clean up handled partial downloads and publish without overwriting an existing output.
