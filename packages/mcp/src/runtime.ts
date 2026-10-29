import { Quady3D, Quady3DError, type GenerationInput, type Job } from "@quady3d/sdk";
import type { Configuration } from "./config.js";
import { StateStore } from "./state.js";
import { ProjectFiles } from "./files.js";
import { LocalError } from "./errors.js";
import { createHash } from "node:crypto";
import { parseResponse, modelsResponse, accountResponse, quoteResponse, uploadedResponse, jobResponse, jobsResponse } from "./schemas.js";

export class Runtime {
  private nextMaintenanceAt = Date.now() + 10 * 60_000;
  private stores: StateStore[];
  private constructor(private client: Quady3D | null, public state: StateStore, public files: ProjectFiles, private credentialState: StateStore, private api: string) { this.stores = [state]; }
  static async create(config: Configuration, client?: Quady3D) {
    const state = await StateStore.create(config.stateDirectory, config.profile);
    const files = await ProjectFiles.create(config.roots, state.baseDirectory);
    await state.prune().catch(() => undefined);
    await state.pruneOtherProfiles().catch(() => undefined);
    const connection = client ?? (config.apiKey ? new Quady3D({ apiKey: config.apiKey, baseUrl: config.baseUrl }) : null);
    const api = createHash("sha256").update(connection ? new URL(config.baseUrl).href.replace(/\/$/, "") : config.baseUrl).digest("hex");
    return new Runtime(connection, state, files, state, api);
  }
  private connected() {
    if (!this.client) throw new LocalError("connection_required", "Create a Quady3D key in Connected apps and set QUADY3D_API_KEY in your MCP host's environment settings. Do not paste the key into chat.");
    return this.client;
  }
  private async maintain() {
    if (Date.now() < this.nextMaintenanceAt) return;
    this.nextMaintenanceAt = Date.now() + 10 * 60_000;
    await this.state.prune().catch(() => undefined);
    await this.state.pruneOtherProfiles().catch(() => undefined);
  }
  private async observed<T extends { id: string; status: string }>(job: T): Promise<T> {
    for (const store of this.stores) await store.observed(job.id, job.status).catch(() => undefined);
    await this.maintain();
    return job;
  }
  async models(operation?: "text-to-3d" | "image-to-3d", signal?: AbortSignal) { return parseResponse(modelsResponse, await this.connected().models({ operation, signal })); }
  private async confirmAccount(signal?: AbortSignal) {
    const account = parseResponse(accountResponse, await this.connected().account({ signal }));
    const stores = await this.credentialState.accountStores(this.api, account.account_id);
    this.state = stores[0]; this.stores = stores;
    return account;
  }
  private async prepareRecovery(signal?: AbortSignal) {
    try { await this.confirmAccount(signal); }
    catch (error) {
      if (!(error instanceof Quady3DError) || error.status !== 403 || error.code !== "permission_denied") throw error;
      // A jobs-only key retains its original credential scope. Never downgrade
      // a connection that was already bound to a verified account.
      const stores = await this.credentialState.accountStores(this.api);
      this.state = stores[0]; this.stores = stores;
    }
  }
  async account(signal?: AbortSignal) {
    const account = await this.confirmAccount(signal);
    return { ...account, local_workspace: await this.files.workspace(), local_recovery: { scope: account.account_id ? "account" : "credential", across_keys: Boolean(account.account_id), registered_connections: this.stores.length } };
  }
  async upload(path: string, signal?: AbortSignal) {
    const client = this.connected();
    const image = await this.files.image(path);
    return parseResponse(uploadedResponse, await client.uploadFile(image.data, { contentType: image.type, signal }));
  }
  async quote(input: GenerationInput, signal?: AbortSignal) {
    await this.prepareRecovery(signal);
    const quote = parseResponse(quoteResponse, await this.connected().quote(input, { signal }));
    await this.state.saveQuote(input, quote);
    await this.maintain();
    return quote;
  }
  async create(quoteId: string, maxCredits: number, actionId: string, signal?: AbortSignal) {
    const client = this.connected();
    await this.prepareRecovery(signal);
    const original = await StateStore.locateAction(this.stores, actionId);
    let action = original?.action;
    const state = original?.store ?? this.state;
    if (action && (action.request.quote_id !== quoteId || action.request.max_credits !== maxCredits)) throw new LocalError("action_conflict", "This action ID belongs to a different quote or credit limit. Resume its original request.", { client_action_id: actionId });
    if (action?.jobId) {
      let recoverySaved = true;
      for (const copy of original!.copies) {
        try { await copy.store.accepted(copy.action, action.jobId); }
        catch (error) { if (error instanceof LocalError && error.code === "action_conflict") throw error; recoverySaved = false; }
      }
      return { ...await this.job(action.jobId, 0, signal), client_action_id: actionId, recovered: true, local_recovery_saved: recoverySaved };
    }
    if (!action) {
      await this.files.requireGenerationWorkspace();
      const saved = await StateStore.locateQuote(this.stores, quoteId);
      if (saved.quote.credits > maxCredits) throw new LocalError("budget_exceeded", "This quote exceeds the authorized credit limit.");
      action = await state.prepareAction(actionId, { ...saved.input, quote_id: quoteId, max_credits: maxCredits });
    }
    const raw = await client.createJob(action.request, { idempotencyKey: actionId, signal });
    // Keep an accepted task identity even if its response is otherwise malformed.
    const knownId = typeof raw?.id === "string" && /^int_[a-f0-9]{64}$/.test(raw.id) ? raw.id : undefined;
    if (!knownId) throw new LocalError("submission_unconfirmed", "The submission response could not be confirmed. Resume this same action ID.", { client_action_id: actionId });
    let recoverySaved = true;
    for (const copy of original?.copies ?? [{ store: state, action }]) {
      try { await copy.store.accepted(copy.action, knownId); }
      catch (error) {
        if (error instanceof LocalError && error.code === "action_conflict") throw new LocalError("action_conflict", "The accepted task conflicts with saved recovery information. Keep the task ID and inspect the original request.", { job_id: knownId, client_action_id: actionId });
        recoverySaved = false;
      }
    }
    let job;
    try { job = parseResponse(jobResponse, raw); }
    catch { throw new LocalError("submission_unconfirmed", "The task was accepted but its response is incomplete. Query this task ID.", { client_action_id: actionId, job_id: knownId }); }
    await this.observed(job);
    return { ...job, client_action_id: actionId, local_recovery_saved: recoverySaved, recovered: Boolean(original) };
  }
  async job(id: string, waitSeconds = 0, signal?: AbortSignal) {
    const client = this.connected();
    if (!waitSeconds) return this.observed(parseResponse(jobResponse, await client.getJob(id, { signal })));
    let latest: Job | undefined;
    try {
      return this.observed(parseResponse(jobResponse, await client.waitForJob(id, { signal, timeoutMs: waitSeconds * 1000, onProgress: job => { latest = job; } })));
    } catch (error) {
      if (error instanceof Quady3DError && error.code === "wait_timeout" && latest) return { ...parseResponse(jobResponse, latest), wait_ended: true };
      throw error;
    }
  }
  async jobs(options: Parameters<Quady3D["listJobs"]>[0]) { return parseResponse(jobsResponse, await this.connected().listJobs(options)); }
  async download(assetId: string, targetPath: string, signal?: AbortSignal) {
    const saved = await this.files.download(this.connected(), assetId, targetPath, signal);
    let recoverySaved = true;
    try { await this.state.saveDelivery({ assetId, path: saved.path, byteSize: saved.byte_size, sha256: saved.sha256 }); } catch { recoverySaved = false; }
    await this.maintain();
    return { ...saved, asset_id: assetId, local_recovery_saved: recoverySaved };
  }
}
