import { Quady3DError } from "@quady3d/sdk";

export class LocalError extends Error {
  constructor(public code: string, message: string, public recovery: Record<string, string> = {}) { super(message); }
}

const messages: Record<string, string> = {
  invalid_api_key: "Update your Quady3D connection key in the host settings.",
  permission_denied: "This connection does not have permission for that action.",
  insufficient_credits: "Your Quady3D balance is insufficient for this task.",
  budget_exceeded: "This task exceeds the authorized credit limit.",
  download_access_required: "This account needs download access to save the asset.",
  quote_expired: "This quote expired. Request a fresh quote before a new task.",
  quote_mismatch: "The quote no longer matches. Check the input and request a new quote.",
  upload_expired: "This image upload expired. Upload the selected file again for a new task.",
  idempotency_conflict: "This action ID belongs to a different request. Resume the original action.",
  asset_expired: "This asset is no longer available for download.",
  request_cancelled: "The local request stopped. Resume the same action or task.",
  wait_timeout: "This wait ended. Resume the same task ID.",
};

export function errorResult(error: unknown, recovery: Record<string, string> = {}) {
  const known = error instanceof LocalError || error instanceof Quady3DError;
  const code = known && /^[a-z0-9_]{1,80}$/.test(error.code) ? error.code : "operation_failed";
  const detail = {
    code,
    message: error instanceof LocalError ? error.message : messages[code] ?? "The Quady3D operation could not complete. Use the request ID for support and resume the original task.",
    retryable: error instanceof Quady3DError && error.retryable,
    ...(error instanceof Quady3DError && error.requestId && /^[a-zA-Z0-9_-]{1,128}$/.test(error.requestId) ? { request_id: error.requestId } : {}),
    ...(error instanceof Quady3DError && error.jobId ? { job_id: error.jobId } : {}),
    ...(error instanceof LocalError ? error.recovery : {}), ...recovery,
  };
  return { isError: true as const, content: [{ type: "text" as const, text: JSON.stringify({ error: detail }) }], structuredContent: { error: detail } };
}

export function successResult(value: Record<string, unknown>) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value) }], structuredContent: value };
}
