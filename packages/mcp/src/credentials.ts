import { lstatSync, readFileSync } from "node:fs";
import { mkdir, open, link, unlink, rename, lstat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { randomUUID } from "node:crypto";
import { emitKeypressEvents } from "node:readline";
import { LocalError } from "./errors.js";

export function connectionPath(env: Record<string, string | undefined> = process.env) {
  const path = env.QUADY3D_API_KEY_FILE ?? join(env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "quady3d", "connection.json");
  if (!isAbsolute(path) || path.includes("\0")) throw new LocalError("invalid_configuration", "Choose an absolute connection file path.");
  return path;
}

export function savedApiKey(env: Record<string, string | undefined> = process.env): string | undefined {
  if (!env.QUADY3D_API_KEY_FILE && env.QUADY3D_API_URL && env.QUADY3D_API_URL.replace(/\/$/, "") !== "https://quady3d.com/api/v1") return undefined;
  const path = connectionPath(env);
  try {
    const info = lstatSync(path);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 16384 ||
      (process.platform !== "win32" && ((info.mode & 0o077) || process.getuid && info.uid !== process.getuid()))) throw new Error();
    const key: unknown = JSON.parse(readFileSync(path, "utf8")).apiKey;
    if (typeof key !== "string" || !/^q3d_live_[a-f0-9]{32}_[a-f0-9]{64}$/.test(key)) throw new Error();
    return key;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT" && !env.QUADY3D_API_KEY_FILE) return undefined;
    throw new LocalError("invalid_configuration", "Cannot read the Quady3D connection. Use a private, regular connection file owned by your user, or set QUADY3D_API_KEY.");
  }
}

async function readSecret(fromStdin: boolean): Promise<string> {
  if (fromStdin) {
    let value = "";
    for await (const chunk of process.stdin) {
      value += chunk.toString();
      if (value.length > 256) throw new Error("Input is too long.");
    }
    return value.trim();
  }
  if (!process.stdin.isTTY) throw new Error("Use an interactive terminal, or pass --stdin to read a key from standard input.");
  process.stderr.write("Paste your Quady3D access key (hidden): ");
  emitKeypressEvents(process.stdin);
  const previousRaw = process.stdin.isRaw;
  process.stdin.setRawMode(true);
  process.stdin.resume();
  return new Promise((resolve, reject) => {
    let value = "";
    const cleanup = () => { process.stdin.off("keypress", handler); process.stdin.setRawMode(previousRaw); process.stdin.pause(); process.stderr.write("\n"); };
    const handler = (text: string | undefined, key: { name?: string; ctrl?: boolean }) => {
      if (key.name === "return" || key.name === "enter") { cleanup(); resolve(value.trim()); }
      else if (key.ctrl && key.name === "c") { cleanup(); reject(new Error("Connection cancelled.")); }
      else if (key.name === "backspace") value = value.slice(0, -1);
      else if (text && !key.ctrl) {
        value += text;
        if (value.length > 256) { cleanup(); reject(new Error("Input is too long.")); }
      }
    };
    process.stdin.on("keypress", handler);
  });
}

export async function connect(args: string[]) {
  if (args.some(arg => !["--stdin", "--replace"].includes(arg))) throw new Error("Usage: quady3d-mcp connect [--stdin] [--replace]");
  const path = connectionPath();
  const key = await readSecret(args.includes("--stdin"));
  if (!/^q3d_live_[a-f0-9]{32}_[a-f0-9]{64}$/.test(key)) throw new Error("Use an access key from https://quady3d.com/account?section=connections.");
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${randomUUID()}.tmp`;
  const file = await open(temporary, "wx", 0o600);
  try {
    await file.writeFile(JSON.stringify({ apiKey: key }) + "\n");
    await file.close();
    if (args.includes("--replace")) {
      try {
        const info = await lstat(path);
        if (!info.isFile() || info.isSymbolicLink() || process.getuid && info.uid !== process.getuid()) throw new Error("Choose a regular connection file owned by your user.");
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      await rename(temporary, path);
    } else await link(temporary, path);
    process.stdout.write("Connection saved privately. Restart your Quady3D MCP connection and check your account. No generation was started.\n");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new Error("A connection already exists. Use connect --replace to change its key.");
    throw error;
  } finally { await file.close().catch(() => {}); await unlink(temporary).catch(() => {}); }
}
