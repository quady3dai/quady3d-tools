import { McpServer, type ServerContext, type ToolCallback } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import manifest from "../package.json" with { type: "json" };
import type { Configuration } from "./config.js";
import { Runtime } from "./runtime.js";
import { successResult, errorResult } from "./errors.js";
import { operation, status, generation, quoteId, jobId, assetId, actionId } from "./schemas.js";

export { configuration } from "./config.js";
export { Runtime } from "./runtime.js";

export async function createQuady3DServer(config: Configuration, runtime?: Runtime) {
  const tools = runtime ?? await Runtime.create(config);
  const server = new McpServer({ name: "quady3d", version: manifest.version }, { capabilities: { tools: {} } });
  function register<S extends z.ZodType>(name: string, description: string, schema: S, readonly: boolean, handler: (input: z.output<S>, signal: AbortSignal) => Promise<Record<string, unknown>>) {
    server.registerTool(`quady3d_${name}`, {
      title: `Quady3D ${name.replaceAll("_", " ")}`, description, inputSchema: schema,
      annotations: { readOnlyHint: readonly, destructiveHint: false, idempotentHint: name !== "upload_file", openWorldHint: true },
    }, (async (input: z.output<S>, context: ServerContext) => {
      const data = input as Record<string, unknown>;
      const recovery: Record<string, string> = {};
      if (typeof data.client_action_id === "string") recovery.client_action_id = data.client_action_id;
      if (typeof data.job_id === "string") recovery.job_id = data.job_id;
      if (typeof data.asset_id === "string") recovery.asset_id = data.asset_id;
      try { return successResult(await handler(input, context.mcpReq.signal)); }
      catch (error) { return errorResult(error, recovery); }
    }) as ToolCallback<S>);
  }
  register("list_models", "List model availability, input limits and parameter_schema with defaults, enums, ranges and conditional constraints. Select an explicit available model and respect its parameter definitions before quoting. Older APIs may omit definitions; use defaults instead of guessing custom values. No generation charge.", z.strictObject({ operation: operation.optional() }), true, (input, signal) => tools.models(input.operation, signal));
  register("get_account", "Read balance, download access, credit limits, local_workspace readiness and local_recovery across-key support. Authenticates this connection before associating saved requests with its account. Check ready_for_new_generation before a new task. No generation charge.", z.strictObject({}), true, (_, signal) => tools.account(signal));
  register("upload_file", "Upload one explicitly selected PNG, JPG or WebP from an allowed project root (up to 8 MiB). No generation charge; upload expires after 30 minutes.", z.strictObject({ file_path: z.string().min(1).max(4096) }), false, (input, signal) => tools.upload(input.file_path, signal));
  register("quote", "Quote an explicit text or single-image generation without charging. Saves this connection's input for create_job. The quote expires in five minutes.", generation, true, (input, signal) => tools.quote(input, signal));
  register("create_job", "Start a user-authorized generation within max_credits using a saved quote and a ready project directory. Reuse the exact client_action_id, quote and limit after interruption, including when the directory needs reconnecting. Returns immediately; query the same job. This reserves credits.", z.strictObject({ quote_id: quoteId, max_credits: z.number().positive().max(1_000_000).multipleOf(0.1), client_action_id: actionId }), false, (input, signal) => tools.create(input.quote_id, input.max_credits, input.client_action_id, signal));
  register("get_job", "Query the original task, optionally waiting up to 30 seconds. A local timeout does not fail or cancel the cloud task and must not trigger a replacement generation.", z.strictObject({ job_id: jobId, wait_seconds: z.number().int().min(0).max(30).optional() }), true, (input, signal) => tools.job(input.job_id, input.wait_seconds, signal));
  register("list_jobs", "List this account's API tasks for recovery. Does not generate or charge.", z.strictObject({ cursor: z.string().max(160).optional(), limit: z.number().int().min(1).max(100).optional(), status: status.optional() }), true, (input, signal) => tools.jobs({ ...input, signal }));
  register("download_asset", "Save an owned result to an existing allowed project directory without replacing an existing file. Retry downloads independently of generation. Returns actual path, size and a locally computed SHA-256. Does not generate; download access still applies.", z.strictObject({ asset_id: assetId, target_path: z.string().min(1).max(4096) }), false, (input, signal) => tools.download(input.asset_id, input.target_path, signal));
  return server;
}
