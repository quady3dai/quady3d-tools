<a href="https://quady3d.com/developers"><img src="assets/quady3d-logo.png" alt="Quady3D" width="112"></a>

# Quady3D developer tools

Create 3D assets from text or a selected image, recover the original task, and save the model file to your project. Official MIT-licensed clients from [Quady3D AI](https://quady3d.com).

[Developer API](https://quady3d.com/developers) · [API documentation](https://quady3d.com/developers/docs) · [Supported models](https://quady3d.com/developers/models) · [Plans and credits](https://quady3d.com/pricing)

## Choose your client

The versioned GitHub Release archives can be installed directly with the commands below.

| Product | Install / source | Official guide |
| --- | --- | --- |
| MCP server | `npm install --global --ignore-scripts https://github.com/quady3dai/quady3d-tools/releases/download/v0.1.2/quady3d-mcp-0.1.2.tgz` | [MCP setup](https://quady3d.com/integrations/mcp) |
| Agent Skill | [`skills/quady3d`](skills/quady3d) | [Skill setup](https://quady3d.com/integrations/agent-skill) |
| TypeScript / JavaScript SDK | `npm install --ignore-scripts https://github.com/quady3dai/quady3d-tools/releases/download/v0.1.2/quady3d-sdk-0.1.2.tgz` | [TypeScript SDK](https://quady3d.com/developers/sdk/typescript) |
| Python SDK | `python -m pip install https://github.com/quady3dai/quady3d-tools/releases/download/v0.1.2/quady3d-0.1.2-py3-none-any.whl` | [Python SDK](https://quady3d.com/developers/sdk/python) |

Versioned downloads and checksums: [GitHub Releases](https://github.com/quady3dai/quady3d-tools/releases) and [Quady3D downloads](https://quady3d.com/developers#downloads).

## From an idea to a game prop

Pair the MCP with the Skill, then ask your agent to create a wooden treasure chest or a camping lantern for your game project. The workflow checks available models and account access, quotes the request, asks for the authorized credit limit when needed, follows the original task, and saves its GLB. Inspect materials, scale and geometry before using the asset in a game scene. [Blender workflow](https://quady3d.com/for/blender) · [Unity import guide](https://quady3d.com/learn/unity-scene-import).

Cloud generation uses Quady3D account credits. Client installation does not add credits or unlock download access. Create a narrowly limited [API key](https://quady3d.com/account?section=connections) and keep it in the host or application environment. Read-only account/model checks and quotes do not create paid generations. Do not place permanent keys in browser code or commit them.

## Build from source

Use Node.js 22+, pnpm 10.16.1 and Python 3.10+.

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm --dir packages/mcp typecheck
pnpm --dir packages/mcp build
```

The JavaScript SDK ships directly usable source and type declarations. To build the Python wheel and source distribution, use a Python environment with `build`, setuptools 77+ and `wheel`, then run `python -m build packages/python`. Keep bundled third-party notices with the MCP.

## Compatibility and delivery

The standalone Codex MCP + Skill flow is verified on macOS arm64. Other operating systems are not covered by that verification; Node/Python minimum versions are runtime requirements. Claude remains pending verification. This basic release exposes eight MCP tools for text or single-image generation, quotes, account/model discovery, recovery and file delivery. Native plugins, advanced operations and scene generation are separate releases.

SDK request timeouts default to 120 seconds. Waiting has its own deadline. Downloads stream to the caller's writer with a default 512 MiB limit. On interruption, retain the original action/job/asset identity and retry that task or asset; byte-range resume is not implemented. Full examples preserve existing destinations and clean up handled partial transfers. Inspect file paths and work inside trusted project directories.

## License and support

The [MIT license](LICENSE) covers these clients. The hosted service, models and generated assets have their own terms. [Changelog](CHANGELOG.md) · [Issues](https://github.com/quady3dai/quady3d-tools/issues) · [Official support](mailto:support@quady3d.com).

Build the versioned archives and checksums with `QUADY3D_BUILD_PYTHON=/absolute/path/to/build-venv/bin/python python3 scripts/release.py`. The selected Python environment must contain setuptools 77+ and wheel; install uv from its official distribution. This command builds locally and does not publish anything.
