import { serveStdio, StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { createQuady3DServer, configuration } from "./index.js";
import { Runtime } from "./runtime.js";
import { errorResult } from "./errors.js";
import manifest from "../package.json" with { type: "json" };
import { connect } from "./credentials.js";

const args = process.argv.slice(2);
if (args.length === 1 && args[0] === "--help") {
  process.stdout.write("Quady3D MCP\n\nUsage: quady3d-mcp [--root /absolute/project]...\n       quady3d-mcp connect [--stdin] [--replace]\n\nCreate a key at https://quady3d.com/account?section=connections, then run connect.\nAlternatively configure QUADY3D_API_KEY in the MCP host environment.\nUse QUADY3D_ALLOWED_ROOTS for a JSON array of project directories.\nWithout an access key, tools can be discovered before connecting.\n\n--version  Print the version\n--help     Show this help\n");
} else if (args.length === 1 && args[0] === "--version") {
  process.stdout.write(`${manifest.version}\n`);
} else if (args[0] === "connect") {
  try { await connect(args.slice(1)); }
  catch (error) { process.stderr.write(`${error instanceof Error ? error.message : "Connection could not be saved."}\n`); process.exitCode = 1; }
} else try {
  const config = configuration();
  const runtime = await Runtime.create(config);
  const transport = new StdioServerTransport(process.stdin, process.stdout, { maxBufferSize: 128 * 1024 });
  const handle = serveStdio(() => createQuady3DServer(config, runtime), {
    transport, legacy: "serve", onerror: () => { process.stderr.write("Quady3D MCP: the protocol connection could not complete.\n"); },
  });
  for (const signal of ["SIGTERM", "SIGINT"] as const) process.once(signal, () => { void handle.close().finally(() => { process.exitCode = 0; }); });
} catch (error) {
  process.stderr.write(`${JSON.stringify(errorResult(error).structuredContent)}\n`);
  process.exitCode = 1;
}
