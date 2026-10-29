import { constants } from "node:fs";
import { mkdir, open, realpath, rename, link, unlink, opendir, lstat } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { basename, join } from "node:path";
import type { CreateJobInput, GenerationInput, Quote } from "@quady3d/sdk";
import { LocalError } from "./errors.js";
import { generation, quoteId, jobId, actionId, quoteResponse } from "./schemas.js";

export type Action = { version: 1; actionId: string; request: CreateJobInput; jobId?: string; phase: "submit_pending" | "accepted"; createdAt: number; updatedAt: number };
type SavedQuote = { version: 1; input: GenerationInput; quote: Quote; updatedAt: number };
export type Delivery = { version: 1; assetId: string; path: string; byteSize: number; sha256: string; updatedAt: number };
type JobLink = { version: 1; jobId: string; actionId: string; requestHash: string; createdAt: number };
type Terminal = JobLink & { observedAt: number };
type Maintenance = { version: 1; cursor?: string; updatedAt: number };
type Binding = { version: 1; api: string; account: string };
type ProfileLink = Binding & { profile: string };
type DirectoryIdentity = { dev: number; ino: number };
const terminalRetention = 7 * 86_400_000;
const maximumStateBytes = 64 * 1024;
const filename = (kind: string, id: string) => `${kind}-${createHash("sha256").update(id).digest("hex")}.json`;

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  return JSON.stringify(value);
}
const requestHash = (value: CreateJobInput) => createHash("sha256").update(canonical(value)).digest("hex");

export class StateStore {
  private constructor(public directory: string, public baseDirectory: string, private identity: DirectoryIdentity, private baseIdentity: DirectoryIdentity) {}

  static async create(base: string, profile: string) {
    return StateStore.openDirectory(base, `profile-${profile}`, true);
  }

  private static async openDirectory(base: string, name: string, create = false) {
    try {
      if (!/^(profile|account)-[a-f0-9]{64}$/.test(name)) throw new Error("Invalid recovery directory");
      if (create) await mkdir(base, { recursive: true, mode: 0o700 });
      const baseDirectory = await realpath(base);
      const baseInfo = await lstat(baseDirectory);
      const directory = join(baseDirectory, name);
      if (create) await mkdir(directory, { mode: 0o700 }).catch(error => { if (error.code !== "EEXIST") throw error; });
      const stat = await lstat(directory);
      if (!stat.isDirectory() || stat.isSymbolicLink() ||
        (process.getuid && (stat.uid !== process.getuid() || (stat.mode & 0o077) !== 0))) throw new Error("Private state required");
      return new StateStore(directory, baseDirectory, { dev: stat.dev, ino: stat.ino }, { dev: baseInfo.dev, ino: baseInfo.ino });
    } catch { throw new LocalError("state_unavailable", "Choose a writable private state directory outside your project."); }
  }

  private async checkDirectory() {
    try {
      const [current, base] = await Promise.all([lstat(this.directory), lstat(this.baseDirectory)]);
      if (!current.isDirectory() || current.isSymbolicLink() || current.dev !== this.identity.dev || current.ino !== this.identity.ino ||
        !base.isDirectory() || base.isSymbolicLink() || base.dev !== this.baseIdentity.dev || base.ino !== this.baseIdentity.ino ||
        (process.getuid && (current.uid !== process.getuid() || (current.mode & 0o077) !== 0))) throw new Error("Private directory changed");
    } catch { throw new LocalError("state_unavailable", "The private recovery directory changed. Keep the original action or task ID and inspect the connection state."); }
  }

  /** Bind only an account identity returned by the configured, authenticated API. */
  async accountStores(api: string, account?: string): Promise<StateStore[]> {
    const bound = await this.read<Binding>("identity", "account");
    if (bound && (!account || bound.api !== api || bound.account !== account)) throw new LocalError("account_identity_changed", "This connection no longer confirms its original account. Keep the original task IDs and restore the correct connection before creating or replaying a submission.");
    if (!account) return [this];
    if (!/^acc_[a-f0-9]{64}$/.test(account) || !/^[a-f0-9]{64}$/.test(api)) throw new LocalError("account_identity_invalid", "The account identity could not be confirmed.");
    const binding: Binding = { version: 1, api, account };
    await this.write("identity", "account", binding, true);
    const saved = await this.read<Binding>("identity", "account");
    if (saved?.api !== api || saved?.account !== account) throw new LocalError("account_identity_changed", "This connection belongs to a different saved account.");
    const scope = createHash("sha256").update(`account:v1\0${api}\0${account}`).digest("hex");
    const registry = await StateStore.openDirectory(this.baseDirectory, `account-${scope}`, true);
    await registry.write("identity", "account", binding, true);
    const identity = await registry.read<Binding>("identity", "account");
    if (identity?.api !== api || identity?.account !== account) throw new LocalError("state_unavailable", "The account recovery index does not match this connection.");
    const profile = basename(this.directory).slice("profile-".length);
    const pointer: ProfileLink = { ...binding, profile };
    await registry.write("profile", profile, pointer, true);
    await registry.write("primary", "profile", pointer, true);
    const primary = await registry.read<ProfileLink>("primary", "profile");
    const stores = new Map<string, StateStore>();
    let entries = 0;
    await registry.checkDirectory();
    const directory = await opendir(registry.directory);
    for await (const entry of directory) {
      if (++entries > 512) throw new LocalError("recovery_index_limit", "Saved recovery information needs inspection. Preserve the original task IDs before continuing.");
      if (!/^profile-[a-f0-9]{64}\.json$/.test(entry.name)) continue;
      if (!entry.isFile()) throw new LocalError("state_unavailable", "Saved recovery information could not be verified. Preserve the original task IDs.");
      if (stores.size >= 128) throw new LocalError("recovery_index_limit", "Too many saved connections to check at once. Preserve the original task IDs before continuing.");
      const link = await registry.readName<ProfileLink>(entry.name);
      if (!link || link.api !== api || link.account !== account || typeof link.profile !== "string" || !/^[a-f0-9]{64}$/.test(link.profile) || filename("profile", link.profile) !== entry.name) throw new LocalError("state_unavailable", "An account recovery reference could not be verified.");
      const source = await StateStore.openDirectory(this.baseDirectory, `profile-${link.profile}`);
      const origin = await source.read<Binding>("identity", "account");
      if (origin?.api !== api || origin?.account !== account) throw new LocalError("state_unavailable", "An original recovery profile no longer confirms this account.");
      stores.set(link.profile, source);
    }
    await registry.checkDirectory();
    if (!primary || primary.api !== api || primary.account !== account || !stores.has(primary.profile)) throw new LocalError("state_unavailable", "The original account recovery profile is unavailable. Preserve the original records.");
    return [stores.get(primary.profile)!, ...[...stores].filter(([key]) => key !== primary.profile).map(([, store]) => store)];
  }

  static async locateAction(stores: StateStore[], id: string) {
    const found: { store: StateStore; action: Action }[] = [];
    for (const store of stores) {
      const action = await store.action(id);
      if (action) found.push({ store, action });
    }
    if (found.some(({ action }) => requestHash(action.request) !== requestHash(found[0].action.request)) || new Set(found.flatMap(({ action }) => action.jobId ? [action.jobId] : [])).size > 1) throw new LocalError("action_conflict", "This action has conflicting saved requests or tasks. Preserve them and recover using the original task ID.", { client_action_id: id });
    const selected = found.find(({ action }) => action.jobId) ?? found[0];
    return selected ? { ...selected, copies: found } : undefined;
  }

  static async locateQuote(stores: StateStore[], id: string) {
    let found: SavedQuote | null = null;
    for (const store of stores) {
      const saved = await store.savedQuote(id);
      if (!saved) continue;
      if (found && canonical({ input: found.input, quote: found.quote }) !== canonical({ input: saved.input, quote: saved.quote })) throw new LocalError("quote_conflict", "This quote has conflicting saved inputs. Preserve the original task identity.");
      found = saved;
    }
    if (!found || found.quote.expires_at * 1000 <= Date.now()) throw new LocalError("local_quote_expired", "Request a new quote in this connection before starting a new action.");
    return found;
  }

  private read<T>(kind: string, id: string) { return this.readName<T>(filename(kind, id)); }

  private async readName<T>(name: string): Promise<T | null> {
    let file;
    try {
      await this.checkDirectory();
      file = await open(join(this.directory, name), constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      const stat = await file.stat();
      if (!stat.isFile() || stat.size > maximumStateBytes || (process.getuid && (stat.uid !== process.getuid() || (stat.mode & 0o077) !== 0))) throw new Error("Invalid state");
      const bytes = Buffer.alloc(maximumStateBytes + 1);
      let size = 0;
      while (size < bytes.length) { const chunk = await file.read(bytes, size, bytes.length - size); if (!chunk.bytesRead) break; size += chunk.bytesRead; }
      if (size > maximumStateBytes) throw new Error("State too large");
      await this.checkDirectory();
      const value = JSON.parse(bytes.subarray(0, size).toString("utf8"));
      if (value?.version !== 1) throw new Error("Unsupported state");
      return value as T;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw new LocalError("state_unavailable", "The local recovery record is unreadable. Keep the original action or task ID for recovery.");
    } finally { await file?.close(); }
  }

  private async write(kind: string, id: string, value: unknown, exclusive = false) {
    const body = JSON.stringify(value);
    if (Buffer.byteLength(body) > maximumStateBytes) throw new LocalError("state_too_large", "This request is too large for a recovery record.");
    const temporary = join(this.directory, `.${randomUUID()}.tmp`);
    const target = join(this.directory, filename(kind, id));
    try {
      await this.checkDirectory();
      const file = await open(temporary, "wx", 0o600);
      try { await file.writeFile(body); await file.sync(); } finally { await file.close(); }
      await this.checkDirectory();
      if (exclusive) await link(temporary, target);
      else await rename(temporary, target);
    } catch (error) {
      if (exclusive && (error as NodeJS.ErrnoException).code === "EEXIST") return false;
      throw new LocalError("state_unavailable", "Could not save the local recovery record. No new submission should be attempted with a different action ID.");
    } finally { if (await this.checkDirectory().then(() => true, () => false)) await unlink(temporary).catch(() => undefined); }
    return true;
  }

  async saveQuote(input: GenerationInput, quote: Quote) {
    await this.write("quote", quote.id, { version: 1, input, quote, updatedAt: Date.now() } satisfies SavedQuote);
  }
  async quote(id: string) {
    const saved = await this.savedQuote(id);
    if (!saved || saved.quote?.id !== id || saved.quote.expires_at * 1000 <= Date.now()) throw new LocalError("local_quote_expired", "Request a new quote in this connection before starting a new action.");
    return saved;
  }
  private async savedQuote(id: string) {
    const saved = await this.read<SavedQuote>("quote", id);
    if (saved && (saved.quote?.id !== id || !quoteResponse.safeParse(saved.quote).success || !generation.safeParse(saved.input).success)) throw new LocalError("state_unavailable", "This saved quote is invalid. Preserve the original task identity.");
    return saved;
  }
  async action(id: string) {
    const value = await this.read<Action>("action", id);
    if (value) {
      const { quote_id, max_credits, ...input } = value.request ?? {};
      if (value.actionId !== id || !actionId.safeParse(id).success || !generation.safeParse(input).success || !quoteId.safeParse(quote_id).success ||
        !Number.isFinite(max_credits) || max_credits <= 0 || max_credits > 1_000_000 || !["submit_pending", "accepted"].includes(value.phase) ||
        (value.jobId !== undefined && !jobId.safeParse(value.jobId).success) || (value.phase === "accepted" && !value.jobId)) throw new LocalError("state_unavailable", "This recovery record is invalid. Keep the original task ID.");
    }
    return value;
  }
  async prepareAction(id: string, request: CreateJobInput) {
    const now = Date.now();
    const candidate: Action = { version: 1, actionId: id, request, phase: "submit_pending", createdAt: now, updatedAt: now };
    await this.write("action", id, candidate, true);
    const saved = await this.action(id);
    if (!saved || canonical(saved.request) !== canonical(request)) throw new LocalError("action_conflict", "This action ID belongs to a different request. Resume the original action.", { client_action_id: id });
    return saved;
  }
  async accepted(action: Action, jobId: string) {
    const current = await this.action(action.actionId);
    if (!current) throw new LocalError("state_unavailable", "The original recovery information is unavailable. Keep the accepted task ID.");
    if (requestHash(current.request) !== requestHash(action.request) || current.jobId && current.jobId !== jobId) throw new LocalError("action_conflict", "The saved request or accepted task changed. Keep the original task IDs.");
    await this.bindJob(action, jobId);
    await this.write("action", action.actionId, { ...action, jobId, phase: "accepted", updatedAt: Date.now() });
  }
  private async bindJob(action: Action, jobId: string) {
    const candidate: JobLink = { version: 1, jobId, actionId: action.actionId, requestHash: requestHash(action.request), createdAt: Date.now() };
    await this.write("job", jobId, candidate, true);
    const link = await this.read<JobLink>("job", jobId);
    if (!link || link.actionId !== action.actionId || link.requestHash !== candidate.requestHash) throw new LocalError("action_conflict", "This task belongs to a different local recovery action.");
  }
  async observed(jobId: string, status: string, now = Date.now()) {
    if (status !== "succeeded" && status !== "failed") return;
    const link = await this.read<JobLink>("job", jobId);
    if (link?.jobId !== jobId) return;
    // Immutable first observation: repeated polling cannot extend retention.
    await this.write("terminal", jobId, { ...link, observedAt: now } satisfies Terminal, true);
  }
  async saveDelivery(delivery: Omit<Delivery, "version" | "updatedAt">) {
    await this.write("delivery", delivery.assetId, { ...delivery, version: 1, updatedAt: Date.now() });
  }
  private async remove(name: string) { await this.checkDirectory(); await unlink(join(this.directory, name)).catch(error => { if (error.code !== "ENOENT") throw error; }); }

  private async pruneTerminal(jobId: string, now: number) {
    const terminal = await this.read<Terminal>("terminal", jobId);
    if (!terminal || !Number.isFinite(terminal.observedAt) || now - terminal.observedAt < terminalRetention) return false;
    const action = await this.action(terminal.actionId);
    // A manually replaced action must not be removed with an older task.
    if (action && requestHash(action.request) === terminal.requestHash && (!action.jobId || action.jobId === jobId)) await this.remove(filename("action", action.actionId));
    const link = await this.read<JobLink>("job", jobId);
    if (link && link.requestHash === terminal.requestHash && link.actionId === terminal.actionId) await this.remove(filename("job", jobId));
    await this.remove(filename("terminal", jobId));
    return true;
  }

  async prune(now = Date.now(), limit = 100) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) throw new Error("Choose a bounded maintenance batch");
    const maintenance = await this.read<Maintenance>("maintenance", "scan");
    let cursor = maintenance?.cursor;
    let visited = 0, unreadable = 0;
    const scan = async (after?: string) => {
      let started = !after, found = !after, reachedEnd = true;
      const dir = await opendir(this.directory);
      for await (const entry of dir) {
        if (!started) { if (entry.name === after) { started = true; found = true; } continue; }
        const temporary = /^\.[a-f0-9-]{36}\.tmp$/.test(entry.name);
        if (!entry.isFile() || (!temporary && !/^(quote|delivery|action|job|terminal)-[a-f0-9]{64}\.json$/.test(entry.name))) continue;
        if (visited >= limit) { reachedEnd = false; break; }
        visited++;
        try {
          if (temporary) {
            const info = await lstat(join(this.directory, entry.name));
            if (now - info.mtimeMs >= 86_400_000) await this.remove(entry.name);
          } else if (entry.name.startsWith("quote-")) {
            const saved = await this.readName<SavedQuote>(entry.name);
            if (saved && Number.isFinite(saved.quote?.expires_at) && saved.quote.expires_at * 1000 <= now) await this.remove(entry.name);
          } else if (entry.name.startsWith("delivery-")) {
            const delivery = await this.readName<Delivery>(entry.name);
            if (delivery && Number.isFinite(delivery.updatedAt) && now - delivery.updatedAt >= terminalRetention) await this.remove(entry.name);
          } else if (entry.name.startsWith("action-")) {
            const action = await this.readName<Action>(entry.name);
            if (action?.phase === "accepted" && action.jobId) {
              // Backfill the index for preview records created before this version.
              await this.bindJob(action, action.jobId);
              await this.pruneTerminal(action.jobId, now);
            }
          } else {
            const value = await this.readName<JobLink | Terminal>(entry.name);
            if (value?.jobId) {
              const removed = await this.pruneTerminal(value.jobId, now);
              if (!removed && entry.name.startsWith("job-") && now - value.createdAt >= terminalRetention && !await this.action(value.actionId)) await this.remove(entry.name);
            }
          }
          const retained = await lstat(join(this.directory, entry.name)).catch(() => null);
          if (retained?.isFile()) cursor = entry.name;
        } catch { unreadable++; cursor = entry.name; }
      }
      if (reachedEnd) cursor = undefined;
      return found;
    };
    if (!await scan(cursor)) await scan();
    await this.write("maintenance", "scan", { version: 1, cursor, updatedAt: now } satisfies Maintenance);
    return { visited, unreadable };
  }

  async pruneOtherProfiles(now = Date.now()) {
    const saved = await this.read<Maintenance>("maintenance", "profiles").catch(() => null);
    let cursor = saved?.cursor, visited = 0;
    const scan = async (after?: string) => {
      let started = !after, found = !after, reachedEnd = true;
      const dir = await opendir(this.baseDirectory);
      for await (const entry of dir) {
        if (!started) { if (entry.name === after) { started = true; found = true; } continue; }
        if (!entry.isDirectory() || !/^profile-[a-f0-9]{64}$/.test(entry.name)) continue;
        const directory = join(this.baseDirectory, entry.name);
        if (directory === this.directory) continue;
        if (visited >= 4) { reachedEnd = false; break; }
        visited++; cursor = entry.name;
        try {
          const info = await lstat(directory);
          if (!info.isDirectory() || info.isSymbolicLink() || (process.getuid && (info.uid !== process.getuid() || (info.mode & 0o077) !== 0))) continue;
          // Only local, already-confirmed outcomes can expire. No credential,
          // network request or other profile's task data enters this connection.
          await (await StateStore.openDirectory(this.baseDirectory, entry.name)).prune(now, 25);
        } catch { /* Preserve an inaccessible profile for explicit recovery. */ }
      }
      if (reachedEnd) cursor = undefined;
      return found;
    };
    if (!await scan(cursor)) await scan();
    await this.write("maintenance", "profiles", { version: 1, cursor, updatedAt: now } satisfies Maintenance);
    return { visited };
  }
}
