import * as z from "zod/v4";
import { modelParameterSchema } from "./model-parameters.js";

export const operation = z.enum(["text-to-3d", "image-to-3d"]);
export const jobId = z.string().regex(/^int_[a-f0-9]{64}$/);
export const quoteId = z.string().regex(/^quo_[a-f0-9]{32}$/);
export const uploadId = z.string().regex(/^upl_[a-f0-9]{32}$/);
export const assetId = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
export const actionId = z.string().regex(/^[\x21-\x7e]{1,128}$/).describe("Stable ID for this user-authorized generation. Reuse it after interruption; never replace it merely to retry.");
export const credits = z.number().finite().nonnegative();
export const status = z.enum(["submitting", "submission_unknown", "queued", "processing", "succeeded", "failed"]);
const requestId = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const parameters = z.record(z.string().max(80), z.union([z.string().max(1000), z.number().finite(), z.boolean()])).optional();
export const generation = z.discriminatedUnion("operation", [
  z.strictObject({ operation: z.literal("text-to-3d"), model: z.string().min(1).max(100), inputs: z.strictObject({ prompt: z.string().min(1).max(1000) }), parameters }),
  z.strictObject({ operation: z.literal("image-to-3d"), model: z.string().min(1).max(100), inputs: z.strictObject({ upload_ids: z.tuple([uploadId]) }), parameters }),
]);

export const quoteResponse = z.object({ id: quoteId, operation, model: z.string(), credits, price_version: z.string(), expires_at: z.number().int(), download_access: z.boolean(), request_id: requestId });
export const uploadedResponse = z.object({ id: uploadId, content_type: z.enum(["image/png", "image/jpeg", "image/webp"]), byte_size: z.number().int().min(1).max(8 * 1024 * 1024), sha256: z.string().regex(/^[a-f0-9]{64}$/), expires_at: z.number().int(), request_id: requestId });
const asset = z.object({ id: assetId, format: z.string().max(32), role: z.string().nullable(), content_type: z.string().max(100), byte_size: z.number().int().nonnegative().nullable(), download_path: z.string().regex(/^\/api\/v1\/assets\/[A-Za-z0-9_-]+$/) });
const snapshotShape = {
  id: jobId, operation, model: z.string(), status, stage: z.string().optional(),
  credits: z.object({ reserved: credits, charged: credits, refunded: credits }), assets: z.array(asset).max(100), created_at: z.number().int(),
  expires_at: z.number().int().nullable().optional(), files_expired: z.boolean().optional(),
  error: z.object({ code: z.string().regex(/^[a-zA-Z0-9_]{1,80}$/) }).transform(error => ({ ...error, message: "This task did not complete. Check its status and request ID before starting another generation." })).optional(),
};
export const jobResponse = z.object({ ...snapshotShape, request_id: requestId });
export const jobsResponse = z.object({ data: z.array(z.object(snapshotShape)).max(100), next_cursor: z.string().nullable(), request_id: requestId });
export const accountResponse = z.object({ account_id: z.string().regex(/^acc_[a-f0-9]{64}$/).optional(), balance_credits: credits, plan: z.string(), download_access: z.boolean(), key_limits: z.object({ max_job_credits: credits, daily_credits: credits }), request_id: requestId });
export const modelsResponse = z.object({ data: z.array(z.object({
  id: z.string(), name: z.string(), maker: z.string(), operation, available: z.boolean(), unavailable_reason: z.string().nullable(), estimated_credits: credits.nullable(), parameter_names: z.array(z.string()),
  parameter_schema: modelParameterSchema.optional(),
  input: z.union([z.object({ type: z.literal("text"), max_characters: z.number().int() }), z.object({ type: z.literal("image"), content_types: z.array(z.string()), max_bytes: z.number().int(), count: z.number().int() })]),
  capabilities: z.object({ pbr: z.boolean(), topology: z.boolean(), rigging: z.boolean(), geometry_quality: z.boolean(), face_count_range: z.tuple([z.number(), z.number()]).optional() }),
}).superRefine((model, context) => {
  if (!model.parameter_schema) return;
  const names = Object.keys(model.parameter_schema.properties);
  if (names.length !== model.parameter_names.length || new Set(model.parameter_names).size !== names.length || names.some(name => !model.parameter_names.includes(name))) {
    context.addIssue({ code: "custom", message: "Model parameter names do not match their definitions" });
  }
})).max(100), generation_operations: z.array(operation).max(2), request_id: requestId });

export function parseResponse<S extends z.ZodType>(schema: S, value: unknown): z.output<S> {
  const result = schema.safeParse(value);
  if (!result.success) throw new Error("Unexpected Quady3D response");
  return result.data;
}
