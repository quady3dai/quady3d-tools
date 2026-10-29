<a href="https://quady3d.com/integrations/mcp"><img src="https://quady3d.com/assets/brand/moki3d/moki-monster-maskable-512.png" alt="Quady3D" width="96"></a>

# Quady3D MCP 0.1.2

[Official setup](https://quady3d.com/integrations/mcp) · [API documentation](https://quady3d.com/developers/docs) · [Models](https://quady3d.com/developers/models) · [Source](https://github.com/quady3dai/quady3d-tools)

Official local MCP server by Quady3D AI. Node.js 22+ is required. Create 3D assets from text or one selected image, resume original tasks and save files inside allowed project folders. The client is MIT licensed; cloud use requires a Quady3D account, credits and model download access.

## Install

```sh
npm install --global --ignore-scripts @quady3d/mcp@0.1.2
quady3d-mcp --version
quady3d-mcp connect
```

The version command prints `0.1.2`. Create an access key at [Connected apps](https://quady3d.com/account?section=connections), with Generate and download permissions and small per-job and daily limits. Paste it into the hidden terminal prompt. The key is stored as a private local file at `~/.config/quady3d/connection.json` (POSIX permissions 600). This is not encrypted keychain storage. No key goes in the command or chat. `QUADY3D_API_KEY` in the server environment takes precedence; `QUADY3D_API_KEY_FILE` can select another absolute connection file. `connect --replace` explicitly replaces a saved key. `connect --stdin` accepts a key from a password manager's standard output.

The package is distributed under the official `@quady3d` npm organization. A global npm installation requires a writable npm prefix; use your Node version manager or install in a separate local directory with `npm install --ignore-scripts @quady3d/mcp@0.1.2` and use its `node_modules/@quady3d/mcp/dist/cli.mjs` with `command = "node"`. Versioned archives and checksums are also available from [Quady3D downloads](https://quady3d.com/developers#downloads).

## Connect Codex

Run `command -v quady3d-mcp` to find the executable. In `~/.codex/config.toml`, add this section, replacing both absolute paths. Keep existing unrelated settings.

```toml
[mcp_servers.quady3d]
command = "/absolute/path/to/quady3d-mcp"
args = ["--root", "/absolute/path/to/project"]
tool_timeout_sec = 180
default_tools_approval_mode = "writes"
```

Restart the MCP connection or start a new Codex session. Ask the agent to check your Quady3D account, models and writable project directory; this does not generate or charge credits. On a managed host, administrator policy can require approval or block connections. Approve the requested file or generation action in the host when prompted; do not disable its sandbox or approval policy. Codex CLI 0.163.0-alpha.11 on macOS has been verified with standalone MCP and Skill. Claude Code and Claude Desktop remain unverified for this release.

Only explicitly configured existing project folders are readable or writable. Repeat `--root` for multiple folders. `QUADY3D_ALLOWED_ROOTS` is an alternative JSON array of absolute paths. Keep private recovery data outside these roots. The API defaults to `https://quady3d.com/api/v1`; set `QUADY3D_API_URL` only for another trusted connection.

## First task

Install the companion [Skill](https://quady3d.com/integrations/agent-skill), then ask:

> Use $quady3d to create a wooden chest. Check my download access, available models and the quote. Ask me to authorize the credit limit. Save a new GLB inside this project and recover the original task if interrupted.

The eight tools are `quady3d_list_models`, `quady3d_get_account`, `quady3d_upload_file`, `quady3d_quote`, `quady3d_create_job`, `quady3d_get_job`, `quady3d_list_jobs` and `quady3d_download_asset`. Quotes do not generate; creating a task reserves credits. Balance, key budgets and download access are separate. Image input is one PNG/JPEG/WebP up to 8 MiB. Uploads expire after 30 minutes and quotes after five minutes.

## Recovery and files

Keep the original action, quote, body and credit limit after an uncertain submission. Query an existing job ID instead of creating a replacement task. Waiting or downloading again does not generate. Downloads preserve existing files and stay inside allowed roots. The destination filesystem must support hard links. Inspect the delivered geometry, textures and scale in your 3D tool.

Private recovery state defaults to the platform's user state directory under `quady3d/mcp`. `QUADY3D_STATE_DIR` can choose another absolute directory outside project roots. It contains prompts and task identifiers, never access keys. Confirmed terminal and delivery records are cleaned up after seven days during use; unresolved submissions are retained.

## Update or remove

Install an explicitly selected newer package version and restart the connection. To disconnect, remove only the Quady3D MCP section and revoke its key in Connected apps. `npm uninstall --global @quady3d/mcp` removes the global package. Deleting the saved connection file disconnects local consumers using it; keep recovery records until all original tasks are resolved. None of these actions cancel accepted cloud tasks or delete saved model files.

See [setup and troubleshooting](https://quady3d.com/integrations/mcp), [checksums and source](https://quady3d.com/developers#downloads), and the included LICENSE and third-party notices.

For a local archive server, set `QUADY3D_PACKAGE_ORIGIN` to its loopback origin and use that origin in the archive URL above. Package origin and API origin are separate: set `QUADY3D_API_URL` only to the trusted service you intend to call.

Downloads stream into private temporary files and publish only complete files without overwriting existing outputs. After an interrupted transfer, retry the same asset ID. Byte-range resume is not implemented.
