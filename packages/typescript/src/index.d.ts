export type GenerationOperation = "text-to-3d" | "image-to-3d";
export type ModelParameterField = {
  type: "string" | "integer" | "number" | "boolean"; title: string; description?: string;
  default?: string | number | boolean; enum?: (string | number | boolean)[];
  minimum?: number; maximum?: number; maxLength?: number;
  "x-enum-labels"?: string[]; "x-step"?: number; "x-advanced"?: boolean;
  "x-enabled-if"?: Record<string, (string | number | boolean)[]>;
};
export type ModelParameterSchema = {
  type: "object"; additionalProperties: false; "x-quady3d-schema-version": 1;
  properties: Record<string, ModelParameterField>;
  allOf?: { if: { properties: Record<string, { enum: (string | number | boolean)[] }>; required: string[] }; then: { properties: Record<string, { const?: string | number | boolean; maximum?: number }> } }[];
};
export type Model = {
  id: string; name: string; maker: string; operation: GenerationOperation; available: boolean;
  unavailable_reason: string | null; estimated_credits: number | null;
  parameter_names: string[];
  parameter_schema?: ModelParameterSchema;
  input: { type: "text"; max_characters: number } | { type: "image"; content_types: string[]; max_bytes: number; count: number };
  capabilities: { pbr: boolean; topology: boolean; rigging: boolean; geometry_quality: boolean; face_count_range?: readonly [number, number] };
};
export type ModelList = { data: Model[]; generation_operations: GenerationOperation[]; request_id: string };
export type GenerationInput = ({ operation: "text-to-3d"; inputs: { prompt: string } } | { operation: "image-to-3d"; inputs: { upload_ids: [string] } }) & { model: string; parameters?: Record<string, string | number | boolean> };
export type UploadedImage = { id: string; content_type: string; byte_size: number; sha256: string; expires_at: number; request_id: string };
export type Quote = { id: string; operation: GenerationOperation; model: string; credits: number; price_version: string; expires_at: number; download_access: boolean; request_id: string };
export type CreateJobInput = GenerationInput & { quote_id: string; max_credits: number };
export type JobStatus = "submitting" | "submission_unknown" | "queued" | "processing" | "succeeded" | "failed";
export type Asset = { id: string; format: string; role: string | null; content_type: string; byte_size: number | null; download_path: string };
export type JobSnapshot = { id: string; operation: GenerationOperation; model: string; status: JobStatus; stage?: string;
  credits: { reserved: number; charged: number; refunded: number }; assets: Asset[]; created_at: number;
  expires_at?: number | null; files_expired?: boolean; error?: { code: string; message: string } };
export type Job = JobSnapshot & { request_id: string };
export type JobList = { data: JobSnapshot[]; next_cursor: string | null; request_id: string };
export type Account = {
  /** Stable across Keys from the same API. Missing on older servers; never infer ownership from a balance. */
  account_id?: string;
  balance_credits: number; plan: string; download_access: boolean;
  key_limits: { max_job_credits: number; daily_credits: number }; request_id: string;
};
export class Quady3DError extends Error {
  code: string; status: number; requestId: string | null; retryable: boolean; jobId: string | null; retryAfterMs: number | null;
  constructor(code: string, message: string, options?: { status?: number; requestId?: string | null; retryable?: boolean; jobId?: string | null; retryAfterMs?: number | null });
}
export class Quady3D {
  constructor(options: { apiKey: string; baseUrl?: string; timeoutMs?: number; fetch?: typeof globalThis.fetch });
  models(options?: { operation?: GenerationOperation; signal?: AbortSignal }): Promise<ModelList>;
  account(options?: { signal?: AbortSignal }): Promise<Account>;
  quote(input: GenerationInput, options?: { signal?: AbortSignal }): Promise<Quote>;
  uploadFile(file: Blob | Uint8Array | ArrayBuffer, options?: { contentType?: "image/png" | "image/jpeg" | "image/webp"; signal?: AbortSignal }): Promise<UploadedImage>;
  createJob(input: CreateJobInput, options: { idempotencyKey: string; signal?: AbortSignal }): Promise<Job>;
  getJob(id: string, options?: { signal?: AbortSignal }): Promise<Job>;
  listJobs(options?: { cursor?: string; limit?: number; status?: JobStatus; signal?: AbortSignal }): Promise<JobList>;
  waitForJob(id: string, options?: { timeoutMs?: number; pollIntervalMs?: number; maxPollIntervalMs?: number; signal?: AbortSignal; onProgress?: (job: Job) => void | Promise<void> }): Promise<Job>;
  downloadAsset(id: string, options: { write: (chunk: Uint8Array) => void | Promise<void>; signal?: AbortSignal; maxBytes?: number }): Promise<{ byteSize: number; contentType: string }>;
}
