"""Bounded, credential-safe transport for the implemented Quady3D endpoints."""

import json
import math
import re
import time
from http.client import HTTPException
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener


class Quady3DError(Exception):
    def __init__(self, code, message, *, status=0, request_id=None, retryable=False, job_id=None, retry_after=None):
        super().__init__(message)
        self.code = code
        self.status = status
        self.request_id = request_id
        self.retryable = retryable
        self.job_id = job_id
        self.retry_after = retry_after


class _NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class Quady3D:
    def __init__(self, *, api_key, base_url="https://quady3d.com/api/v1", timeout=120):
        if not isinstance(api_key, str) or not api_key.strip() or "\r" in api_key or "\n" in api_key:
            raise ValueError("A Quady3D access key is required.")
        if not isinstance(base_url, str):
            raise ValueError("Use a valid Quady3D connection URL.")
        try:
            parsed = urlsplit(base_url)
            parsed.port
        except ValueError:
            raise ValueError("Use a valid Quady3D connection URL.") from None
        local_http = parsed.scheme == "http" and parsed.hostname in ("localhost", "127.0.0.1", "::1")
        if not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment or (parsed.scheme != "https" and not local_http):
            raise ValueError("Use HTTPS for your Quady3D connection.")
        if not isinstance(timeout, (int, float)) or isinstance(timeout, bool) or not 0 < timeout <= 120:
            raise ValueError("Choose a request timeout up to 120 seconds.")
        self.__key = api_key.strip()
        self.__base_url = base_url.rstrip("/")
        self.__timeout = timeout
        self.__opener = build_opener(_NoRedirect())

    def _request(self, resource, *, method="GET", body=None, idempotency_key=None, consume=None, raw_body=None, content_type=None, timeout=None):
        headers = {
            "Accept": "application/json", "Authorization": f"Bearer {self.__key}",
            "User-Agent": "quady3d-sdk/0.1.2",
            "X-Quady3D-Client": "python-sdk", "X-Quady3D-Client-Version": "0.1.2",
        }
        if raw_body is not None:
            headers["Content-Type"] = content_type
        elif body is not None:
            headers["Content-Type"] = "application/json"
        if idempotency_key is not None:
            headers["Idempotency-Key"] = idempotency_key
        req = Request(f"{self.__base_url}/{resource}", headers=headers, method=method,
                      data=raw_body if raw_body is not None else json.dumps(body, allow_nan=False).encode() if body is not None else None)
        try:
            response = self.__opener.open(req, timeout=min(self.__timeout, timeout) if timeout is not None else self.__timeout)
        except HTTPError as error:
            response = error
        except (URLError, OSError):
            raise Quady3DError("connection_failed", "Could not connect to Quady3D.", retryable=True) from None
        try:
            with response:
                status = response.getcode()
                if 300 <= status < 400:
                    raise Quady3DError("redirect_rejected", "The API connection must not redirect.", status=status)
                if 200 <= status < 300 and consume is not None:
                    return consume(response)
                body = response.read(1024 * 1024 + 1)
                request_id = response.headers.get("X-Request-Id")
                retry_after = response.headers.get("Retry-After")
        except (OSError, HTTPException):
            raise Quady3DError("connection_failed", "Could not read the Quady3D response.", retryable=True) from None
        if len(body) > 1024 * 1024:
            raise Quady3DError("response_too_large", "The API response is too large.", status=status)
        try:
            data = json.loads(body)
        except (ValueError, UnicodeError):
            raise Quady3DError("invalid_response", "Quady3D returned an unreadable response.", status=status) from None
        if not isinstance(data, dict):
            raise Quady3DError("invalid_response", "Quady3D returned an unexpected response.", status=status)
        if not 200 <= status < 300:
            problem = data.get("error")
            problem = problem if isinstance(problem, dict) else {}
            raise Quady3DError(
                problem.get("code") if isinstance(problem.get("code"), str) else f"http_{status}",
                problem.get("message") if isinstance(problem.get("message"), str) else "The Quady3D request failed.",
                status=status,
                request_id=problem.get("request_id") if isinstance(problem.get("request_id"), str) else request_id,
                retryable=problem.get("retryable") is True,
                retry_after=min(int(retry_after), 300) if retry_after and retry_after.isascii() and retry_after.isdecimal() and len(retry_after) < 10 else None,
            )
        return data

    def models(self, *, operation=None):
        query = f"?{urlencode({'operation': operation})}" if operation else ""
        result = self._request(f"models{query}")
        if not isinstance(result.get("data"), list):
            raise Quady3DError("invalid_response", "The model list is unavailable.")
        return result

    def account(self):
        result = self._request("account")
        balance = result.get("balance_credits")
        if isinstance(balance, bool) or not isinstance(balance, (int, float)) or not math.isfinite(balance):
            raise Quady3DError("invalid_response", "The account balance is unavailable.")
        return result

    def upload_file(self, file, *, content_type):
        data = file.read(8 * 1024 * 1024 + 1) if callable(getattr(file, "read", None)) else file
        size = data.nbytes if isinstance(data, memoryview) else len(data) if isinstance(data, (bytes, bytearray)) else -1
        if not 0 < size <= 8 * 1024 * 1024 or content_type not in ("image/png", "image/jpeg", "image/webp"):
            raise ValueError("Provide PNG, JPG or WebP bytes up to 8 MB and their content type.")
        return self._request("uploads", method="POST", raw_body=bytes(data), content_type=content_type)

    def quote(self, generation):
        return self._request("quotes", method="POST", body=generation)

    def create_job(self, generation, *, idempotency_key):
        if not isinstance(idempotency_key, str) or re.fullmatch(r"[\x21-\x7e]{1,128}", idempotency_key) is None:
            raise ValueError("Provide a stable Idempotency-Key for this action.")
        return self._request("jobs", method="POST", body=generation, idempotency_key=idempotency_key)

    def get_job(self, job_id):
        return self._job(job_id)

    def _job(self, job_id, timeout=None):
        if not isinstance(job_id, str) or re.fullmatch(r"int_[a-f0-9]{64}", job_id) is None:
            raise ValueError("Provide a valid Quady3D task ID.")
        return self._request(f"jobs/{job_id}", timeout=timeout)

    def list_jobs(self, *, cursor=None, limit=None, status=None):
        query = {key: value for key, value in {"cursor": cursor, "limit": limit, "status": status}.items() if value is not None}
        return self._request("jobs" + ("?" + urlencode(query) if query else ""))

    def wait_for_job(self, job_id, *, timeout=600, poll_interval=3, max_poll_interval=15, cancel_event=None, on_progress=None):
        values = (timeout, poll_interval, max_poll_interval)
        if any(isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or value <= 0 for value in values) or timeout > 86400 or poll_interval > max_poll_interval or max_poll_interval > 300:
            raise ValueError("Choose positive, bounded task waiting intervals.")
        deadline = time.monotonic() + timeout
        delay = poll_interval
        while time.monotonic() < deadline:
            if cancel_event is not None and cancel_event.is_set():
                raise Quady3DError("request_cancelled", "Waiting ended. Resume the same task ID.", job_id=job_id)
            try:
                job = self._job(job_id, timeout=max(0.001, deadline - time.monotonic()))
                if job.get("id") != job_id or job.get("status") not in ("submitting", "submission_unknown", "queued", "processing", "succeeded", "failed"):
                    raise Quady3DError("invalid_response", "The task status is unavailable.", job_id=job_id)
                if on_progress is not None:
                    on_progress(job)
                if job["status"] in ("succeeded", "failed"):
                    return job
            except Quady3DError as error:
                error.job_id = error.job_id or job_id
                if not error.retryable:
                    raise
                delay = max(delay, error.retry_after or 0)
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                break
            if cancel_event is not None:
                cancel_event.wait(min(delay, remaining))
            else:
                time.sleep(min(delay, remaining))
            delay = min(max(poll_interval, delay * 1.5), max_poll_interval)
        raise Quady3DError("wait_timeout", "Waiting ended before a final result was confirmed. Resume the same task ID.", job_id=job_id, retryable=True)

    def download_asset(self, asset_id, output, *, max_bytes=512 * 1024 * 1024):
        if not isinstance(asset_id, str) or re.fullmatch(r"[A-Za-z0-9_-]{1,128}", asset_id) is None:
            raise ValueError("Provide a valid asset ID.")
        if not callable(getattr(output, "write", None)) or isinstance(max_bytes, bool) or not isinstance(max_bytes, int) or not 0 < max_bytes <= 1024 ** 3:
            raise ValueError("Provide a binary file writer and a download limit up to 1 GB.")

        def consume(response):
            length = response.headers.get("Content-Length")
            if length and len(length) > 20 and length.isascii() and length.isdecimal():
                raise Quady3DError("download_too_large", "This asset exceeds the download limit.")
            expected = int(length) if length and length.isascii() and length.isdecimal() else None
            if expected is not None and expected > max_bytes:
                raise Quady3DError("download_too_large", "This asset exceeds the download limit.")
            received = 0
            while True:
                chunk = response.read(min(65536, max_bytes - received + 1))
                if not chunk:
                    break
                received += len(chunk)
                if received > max_bytes:
                    raise Quady3DError("download_too_large", "This asset exceeds the download limit.")
                try:
                    written = output.write(chunk)
                except (OSError, ValueError, TypeError):
                    raise Quady3DError("file_write_failed", "Could not write the downloaded asset.") from None
                if written != len(chunk):
                    raise Quady3DError("file_write_failed", "Could not write the downloaded asset.")
            if not received or (expected is not None and expected != received):
                raise Quady3DError("download_incomplete", "The asset download did not complete.")
            return {"byte_size": received, "content_type": response.headers.get("Content-Type", "application/octet-stream")}

        return self._request(f"assets/{asset_id}", consume=consume)
