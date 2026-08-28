import type { ApiErrorCode, MaintenanceClass } from "./constants";
import type { ApiErrorBody, Env, LogEvent, RequestContext } from "./types";

const statusByCode = {
  invalid_request: 400,
  unauthorized: 401,
  revoked_device: 403,
  clock_skew: 401,
  replay: 409,
  idempotency_conflict: 409,
  not_found: 404,
  stale_revision: 409,
  upload_incomplete: 409,
  chunk_conflict: 409,
  integrity_failed: 422,
  unsupported_version: 400,
  quota_exceeded: 413,
  rate_limited: 429,
  dependency_unavailable: 503,
  cursor_expired: 410,
} satisfies Record<ApiErrorCode, number>;

export class ApiProblem extends Error {
  readonly code: ApiErrorCode;
  readonly dependency: "d1" | "r2" | "queue" | undefined;
  readonly retryAfter: number | undefined;
  readonly status: number;

  constructor(
    code: ApiErrorCode,
    options: {
      dependency?: "d1" | "r2" | "queue";
      retryAfter?: number;
      status?: number;
    } = {},
  ) {
    super(code);
    this.code = code;
    this.dependency = options.dependency;
    this.retryAfter = options.retryAfter;
    this.status = options.status ?? statusByCode[code];
  }
}

export function problem(code: ApiErrorCode): ApiProblem {
  return new ApiProblem(code);
}

export function dependencyProblem(
  dependency: "d1" | "r2" | "queue",
): ApiProblem {
  return new ApiProblem("dependency_unavailable", {
    dependency,
    retryAfter: 5,
  });
}

function baseHeaders(now: number): Headers {
  return new Headers({
    "Cache-Control": "no-store",
    Date: new Date(now).toUTCString(),
    "Permissions-Policy":
      "camera=(), geolocation=(), microphone=(), payment=(), usb=()",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
  });
}

export function jsonResponse<Value>(
  value: Value,
  status = 200,
  now = Date.now(),
): Response {
  const headers = baseHeaders(now);
  headers.set("Content-Type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(value), { status, headers });
}

export function bytesResponse(
  value: BodyInit,
  status = 200,
  headers: HeadersInit = {},
  now = Date.now(),
): Response {
  const responseHeaders = baseHeaders(now);
  responseHeaders.set("Content-Type", "application/octet-stream");
  new Headers(headers).forEach((headerValue, name) => {
    responseHeaders.set(name, headerValue);
  });
  return new Response(value, { status, headers: responseHeaders });
}

export function errorResponse(
  problemValue: ApiProblem,
  requestId: string,
  now = Date.now(),
): Response {
  const body: ApiErrorBody = {
    code: problemValue.code,
    request_id: requestId,
    retryable:
      problemValue.code === "dependency_unavailable" ||
      problemValue.code === "rate_limited",
  };
  const response = jsonResponse(body, problemValue.status, now);
  if (problemValue.retryAfter !== undefined) {
    response.headers.set("Retry-After", String(problemValue.retryAfter));
  }
  return response;
}

function latencyBucket(elapsed: number): LogEvent["latency_bucket"] {
  if (elapsed < 10) return "lt_10ms";
  if (elapsed < 100) return "lt_100ms";
  if (elapsed < 1000) return "lt_1s";
  return "gte_1s";
}

export function logRequest(
  env: Env,
  context: RequestContext,
  status: number,
  options: {
    dependency?: "d1" | "r2" | "queue";
    error?: ApiErrorCode;
  } = {},
): void {
  const event: LogEvent = {
    request_id: context.requestId,
    route: context.route,
    status,
    latency_bucket: latencyBucket(Date.now() - context.startedAt),
    worker_version: env.WORKER_VERSION ?? "unknown",
  };
  if (options.dependency !== undefined) event.dependency = options.dependency;
  if (options.error !== undefined) event.error = options.error;
  console.log(JSON.stringify(event));
}

export function logMaintenance(
  env: Env,
  jobClass: MaintenanceClass,
  status: number,
  error?: ApiErrorCode,
): void {
  const event: LogEvent = {
    request_id: "maintenance",
    route: "maintenance",
    status,
    latency_bucket: "lt_1s",
    maintenance_class: jobClass,
    worker_version: env.WORKER_VERSION ?? "unknown",
  };
  if (error !== undefined) event.error = error;
  console.log(JSON.stringify(event));
}
