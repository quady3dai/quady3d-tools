const maximumResponseBytes = 1024 * 1024;

function withAbort(work, signal) {
  return new Promise((resolve, reject) => {
    const cleanup = () => signal.removeEventListener("abort", abort);
    const abort = () => { cleanup(); reject(new Error("Operation ended")); };
    if (signal.aborted) { abort(); return; }
    signal.addEventListener("abort", abort, { once: true });
    Promise.resolve().then(work).then(value => { cleanup(); resolve(value); }, error => { cleanup(); reject(error); });
  });
}

export class Quady3DError extends Error {
  constructor(code, message, { status = 0, requestId = null, retryable = false, jobId = null, retryAfterMs = null } = {}) {
    super(message);
    this.name = "Quady3DError";
    this.code = code;
    this.status = status;
    this.requestId = requestId;
    this.retryable = retryable;
    this.jobId = jobId;
    this.retryAfterMs = retryAfterMs;
  }
}

export class Quady3D {
  #key;
  #baseUrl;
  #fetch;
  #timeout;

  constructor({ apiKey, baseUrl = "https://quady3d.com/api/v1", timeoutMs = 120_000, fetch: fetchImplementation = globalThis.fetch }) {
    if (typeof apiKey !== "string" || !apiKey.trim() || /[\r\n]/.test(apiKey)) throw new TypeError("A Quady3D access key is required.");
    let url;
    try { url = new URL(baseUrl); } catch { throw new TypeError("Use a valid Quady3D connection URL."); }
    if (url.username || url.password || url.search || url.hash ||
      (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))) {
      throw new TypeError("Use HTTPS for your Quady3D connection.");
    }
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 120_000) throw new TypeError("Choose a request timeout up to 120 seconds.");
    if (typeof fetchImplementation !== "function") throw new TypeError("A fetch implementation is required.");
    this.#key = apiKey.trim();
    this.#baseUrl = url.href.replace(/\/$/, "");
    this.#fetch = fetchImplementation;
    this.#timeout = timeoutMs;
  }

  async #request(resource, { signal, method = "GET", body: inputBody, idempotencyKey, rawBody, contentType } = {}, consume) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.#timeout);
    const requestSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
    try {
      const response = await this.#fetch(`${this.#baseUrl}/${resource}`, {
        method, redirect: "error", credentials: "omit", cache: "no-store",
        signal: requestSignal,
        headers: { Accept: consume ? "application/octet-stream" : "application/json", Authorization: `Bearer ${this.#key}`, "X-Quady3D-Client": "typescript-sdk", "X-Quady3D-Client-Version": "0.1.2",
          ...(rawBody !== undefined ? { "Content-Type": contentType } : inputBody === undefined ? {} : { "Content-Type": "application/json" }), ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}) },
        ...(rawBody !== undefined ? { body: rawBody } : inputBody === undefined ? {} : { body: JSON.stringify(inputBody) }),
      });
      if (response.status >= 300 && response.status < 400) throw new Quady3DError("redirect_rejected", "The API connection must not redirect.", { status: response.status });
      if (response.ok && consume) return await consume(response, requestSignal);
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let body = "", bytes = 0;
      if (reader) {
        try {
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            bytes += value.byteLength;
            if (bytes > maximumResponseBytes) {
              await reader.cancel();
              throw new Quady3DError("response_too_large", "The API response is too large.");
            }
            body += decoder.decode(value, { stream: true });
          }
          body += decoder.decode();
        } finally { reader.releaseLock(); }
      }
      let data;
      try { data = JSON.parse(body); } catch { throw new Quady3DError("invalid_response", "Quady3D returned an unreadable response.", { status: response.status }); }
      if (!response.ok) {
        const error = data?.error;
        const retryAfter = response.headers.get("retry-after");
        const retryAfterMs = retryAfter !== null && /^\d+$/.test(retryAfter) ? Math.min(Number(retryAfter) * 1000, 300_000) : null;
        throw new Quady3DError(typeof error?.code === "string" ? error.code : "request_failed",
          typeof error?.message === "string" ? error.message : "The Quady3D request failed.",
          { status: response.status, requestId: typeof error?.request_id === "string" ? error.request_id : response.headers.get("x-request-id"), retryable: error?.retryable === true, retryAfterMs });
      }
      if (!data || typeof data !== "object" || Array.isArray(data)) throw new Quady3DError("invalid_response", "Quady3D returned an unexpected response.");
      return data;
    } catch (error) {
      if (error instanceof Quady3DError) throw error;
      if (signal?.aborted) throw new Quady3DError("request_cancelled", "The request was cancelled.");
      if (controller.signal.aborted) throw new Quady3DError("request_timeout", "The request timed out.", { retryable: true });
      throw new Quady3DError("connection_failed", "Could not connect to Quady3D.", { retryable: true });
    } finally { clearTimeout(timeout); }
  }

  async models({ operation, signal } = {}) {
    const query = operation ? `?${new URLSearchParams({ operation })}` : "";
    const result = await this.#request(`models${query}`, { signal });
    if (!Array.isArray(result.data)) throw new Quady3DError("invalid_response", "The model list is unavailable.");
    return result;
  }

  async account({ signal } = {}) {
    const result = await this.#request("account", { signal });
    if (typeof result.balance_credits !== "number" || !Number.isFinite(result.balance_credits)) {
      throw new Quady3DError("invalid_response", "The account balance is unavailable.");
    }
    return result;
  }

  quote(input, { signal } = {}) {
    return this.#request("quotes", { method: "POST", body: input, signal });
  }

  uploadFile(file, { contentType, signal } = {}) {
    const type = contentType ?? (file instanceof Blob ? file.type : undefined);
    const size = file instanceof Blob ? file.size : file instanceof Uint8Array || file instanceof ArrayBuffer ? file.byteLength : -1;
    if (!Number.isSafeInteger(size) || size < 1 || size > 8 * 1024 * 1024 || !["image/png", "image/jpeg", "image/webp"].includes(type)) {
      throw new TypeError("Provide PNG, JPG or WebP bytes up to 8 MB and their content type.");
    }
    return this.#request("uploads", { method: "POST", rawBody: file, contentType: type, signal });
  }

  createJob(input, { idempotencyKey, signal } = {}) {
    if (typeof idempotencyKey !== "string" || !/^[\x21-\x7e]{1,128}$/.test(idempotencyKey)) throw new TypeError("Provide a stable Idempotency-Key for this action.");
    return this.#request("jobs", { method: "POST", body: input, signal, idempotencyKey });
  }

  getJob(id, { signal } = {}) {
    if (typeof id !== "string" || !/^int_[a-f0-9]{64}$/.test(id)) throw new TypeError("Provide a valid Quady3D task ID.");
    return this.#request(`jobs/${id}`, { signal });
  }

  listJobs({ cursor, limit, status, signal } = {}) {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries({ cursor, limit, status })) if (value !== undefined) query.set(key, String(value));
    return this.#request(`jobs${query.size ? `?${query}` : ""}`, { signal });
  }

  async waitForJob(id, { timeoutMs = 600_000, pollIntervalMs = 3000, maxPollIntervalMs = 15_000, signal, onProgress } = {}) {
    if (![timeoutMs, pollIntervalMs, maxPollIntervalMs].every(value => Number.isFinite(value) && value > 0) ||
      timeoutMs > 86_400_000 || pollIntervalMs > maxPollIntervalMs || maxPollIntervalMs > 300_000) throw new TypeError("Choose positive, bounded task waiting intervals.");
    const deadline = new AbortController();
    const timer = setTimeout(() => deadline.abort(), timeoutMs);
    const combined = signal ? AbortSignal.any([signal, deadline.signal]) : deadline.signal;
    let delay = pollIntervalMs;
    try {
      while (!combined.aborted) {
        try {
          const job = await this.getJob(id, { signal: combined });
          if (job.id !== id || !["submitting", "submission_unknown", "queued", "processing", "succeeded", "failed"].includes(job.status)) {
            throw new Quady3DError("invalid_response", "The task status is unavailable.", { jobId: id });
          }
          if (onProgress) {
            try { await withAbort(() => onProgress(job), combined); }
            catch (error) {
              if (combined.aborted) throw error;
              throw new Quady3DError("progress_callback_failed", "The task progress callback failed.", { jobId: id });
            }
          }
          if (job.status === "succeeded" || job.status === "failed") return job;
        } catch (error) {
          if (combined.aborted) break;
          if (!(error instanceof Quady3DError) || !error.retryable) throw error;
          delay = Math.max(delay, error.retryAfterMs ?? 0);
        }
        await new Promise((resolve, reject) => {
          const finish = () => { clearTimeout(wait); combined.removeEventListener("abort", cancel); };
          const cancel = () => { finish(); reject(new Error("Waiting ended")); };
          const wait = setTimeout(() => { finish(); resolve(); }, delay);
          combined.addEventListener("abort", cancel, { once: true });
          if (combined.aborted) cancel();
        }).catch(error => { if (!combined.aborted) throw error; });
        delay = Math.min(Math.max(pollIntervalMs, delay * 1.5), maxPollIntervalMs);
      }
      throw new Quady3DError(signal?.aborted ? "request_cancelled" : "wait_timeout",
        "Waiting ended before a final result was confirmed. Resume the same task ID.", { jobId: id, retryable: !signal?.aborted });
    } catch (error) {
      if (error instanceof Quady3DError && !error.jobId) error.jobId = id;
      throw error;
    } finally { clearTimeout(timer); }
  }

  async downloadAsset(id, { write, signal, maxBytes = 512 * 1024 * 1024 } = {}) {
    if (typeof id !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(id)) throw new TypeError("Provide a valid asset ID.");
    if (typeof write !== "function" || !Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 1024 ** 3) throw new TypeError("Provide a file writer and a download limit up to 1 GB.");
    return this.#request(`assets/${id}`, { signal }, async (response, downloadSignal) => {
      const length = response.headers.get("content-length");
      const expected = length !== null && /^\d+$/.test(length) ? Number(length) : null;
      if (expected !== null && (!Number.isSafeInteger(expected) || expected > maxBytes)) {
        await response.body?.cancel();
        throw new Quady3DError("download_too_large", "This asset exceeds the download limit.");
      }
      const reader = response.body?.getReader();
      if (!reader) throw new Quady3DError("invalid_response", "The asset has no file content.");
      let byteSize = 0;
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          byteSize += value.byteLength;
          if (byteSize > maxBytes) throw new Quady3DError("download_too_large", "This asset exceeds the download limit.");
          try { await withAbort(() => write(value), downloadSignal); }
          catch (error) {
            if (downloadSignal.aborted) throw error;
            throw new Quady3DError("file_write_failed", "Could not write the downloaded asset.");
          }
        }
        if (!byteSize || (expected !== null && expected !== byteSize)) throw new Quady3DError("download_incomplete", "The asset download did not complete.");
        return { byteSize, contentType: response.headers.get("content-type") ?? "application/octet-stream" };
      } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
    });
  }
}
