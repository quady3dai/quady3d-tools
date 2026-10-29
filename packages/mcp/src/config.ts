import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { LocalError } from "./errors.js";
import { savedApiKey } from "./credentials.js";

export type Configuration = { apiKey?: string; baseUrl: string; roots: string[]; stateDirectory: string; profile: string };

export function configuration(env: Record<string, string | undefined> = process.env, args: string[] = process.argv.slice(2)): Configuration {
  const roots: string[] = [];
  if (env.QUADY3D_ALLOWED_ROOTS) {
    let value: unknown;
    try { value = JSON.parse(env.QUADY3D_ALLOWED_ROOTS); } catch { throw new LocalError("invalid_configuration", "Set QUADY3D_ALLOWED_ROOTS to a JSON array of absolute project directories."); }
    if (!Array.isArray(value) || value.some(item => typeof item !== "string")) throw new LocalError("invalid_configuration", "Allowed roots must be a JSON array of project directories.");
    roots.push(...value);
  }
  for (let i = 0; i < args.length; i += 2) {
    if (args[i] !== "--root" || !args[i + 1]) throw new LocalError("invalid_configuration", "Use --root followed by an absolute project directory.");
    roots.push(args[i + 1]);
  }
  if (roots.length > 20 || roots.some(root => !isAbsolute(root) || root.includes("\0"))) throw new LocalError("invalid_configuration", "Choose up to 20 absolute project directories.");
  const apiKey = env.QUADY3D_API_KEY?.trim() || (env === process.env || env.QUADY3D_API_KEY_FILE ? savedApiKey(env) : undefined);
  const baseUrl = env.QUADY3D_API_URL ?? "https://quady3d.com/api/v1";
  const stateDirectory = env.QUADY3D_STATE_DIR ?? join(env.XDG_STATE_HOME ?? (process.platform === "win32" ? env.LOCALAPPDATA ?? homedir() : join(homedir(), ".local", "state")), "quady3d", "mcp");
  if (!isAbsolute(stateDirectory) || stateDirectory.includes("\0")) throw new LocalError("invalid_configuration", "Use an absolute local state directory outside your project.");
  const profile = createHash("sha256").update(`${baseUrl}\0${apiKey ?? "disconnected"}`).digest("hex");
  return { apiKey, baseUrl, roots: [...new Set(roots)], stateDirectory, profile };
}
