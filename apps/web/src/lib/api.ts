/**
 * The ONLY module in this app that calls `fetch`.
 *
 * A second place that calls fetch directly is a second place to forget the
 * Authorization header, and it fails as a confusing 401 rather than an obvious
 * mistake. If you find yourself writing `fetch(` anywhere else, add the endpoint
 * here instead.
 *
 * The session rides on the header rather than a cookie because the web app and
 * the API are on different origins — which is simpler and has no SameSite
 * problems.
 */

import type { ApiError, ErrorCode } from "@mandi/shared";

/**
 * Where the API lives.
 *
 * Blank means "same origin", which is how the dev server works when it proxies
 * /api — the setup used to test on a phone, where the page is https:// and
 * "localhost" means the phone itself. An empty string is not nullish, so `??`
 * alone would leave BASE as "" and `new URL("/api/v1/...")` would throw.
 */
const CONFIGURED = (import.meta.env["VITE_API_URL"] ?? "").trim();
const BASE = (CONFIGURED || window.location.origin).replace(/\/$/, "");
const PREFIX = "/api/v1";

/**
 * Clerk holds the session inside React context, but router loaders run outside
 * it. One provider function is registered at mount and used by every request,
 * which keeps the "exactly one place" rule intact without threading a token
 * through every call site.
 */
type TokenProvider = () => Promise<string | null>;

let getToken: TokenProvider = async () => null;

export function setTokenProvider(provider: TokenProvider): void {
  getToken = provider;
}

/**
 * The same token the fetch wrapper attaches, for the Socket.IO handshake.
 *
 * The socket is not a `fetch`, so it cannot go through `api()` — but it must use
 * the same session, and there is still exactly one place that knows how to get
 * one.
 */
export function getAuthToken(): Promise<string | null> {
  return getToken();
}

/**
 * A failed request, carrying everything the caller branches on.
 *
 * Status codes carry meaning in this API (see docs/API.md), and the machine
 * `code` narrows the reason within a status — so a 409 on a booking can say
 * *what* moved underneath the request.
 */
export class ApiRequestError extends Error {
  readonly status: number;
  readonly code: ErrorCode | "network";
  readonly fields: Record<string, string> | undefined;

  constructor(status: number, code: ErrorCode | "network", message: string, fields?: Record<string, string>) {
    super(message);
    this.name = "ApiRequestError";
    this.status = status;
    this.code = code;
    this.fields = fields;
  }

  /** The user is signed out, or the token expired. */
  get isUnauthenticated(): boolean {
    return this.status === 401;
  }

  /** Signed in, but not allowed — wrong role, or a gate not yet cleared. */
  get isForbidden(): boolean {
    return this.status === 403;
  }

  /**
   * The request was fine but the world moved. Re-fetch and show what changed,
   * rather than rendering a bare failure.
   */
  get isConflict(): boolean {
    return this.status === 409;
  }

  /**
   * We could not find out — not a negative answer. The client shows a retry
   * panel and STAYS PUT. Treating this as "no session" is what turned an outage
   * into an infinite onboarding redirect in the previous build.
   */
  get isUnavailable(): boolean {
    return this.status === 503 || this.code === "network";
  }
}

export interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  signal?: AbortSignal;
  /** Query parameters; undefined and null values are dropped. */
  query?: Record<string, string | number | undefined | null>;
}

function buildUrl(path: string, query: RequestOptions["query"]): string {
  const url = new URL(BASE + PREFIX + (path.startsWith("/") ? path : `/${path}`));
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
  }
  return url.toString();
}

export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const token = await getToken();

  const headers: Record<string, string> = { Accept: "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  if (options.body !== undefined) headers["Content-Type"] = "application/json";

  let response: Response;
  try {
    response = await fetch(buildUrl(path, options.query), {
      method: options.method ?? "GET",
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal ?? null,
    });
  } catch (error) {
    // A dead network is indistinguishable from a dead server from here, and
    // both are "could not find out" rather than "the answer is no".
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new ApiRequestError(0, "network", "We could not reach the server. Check your connection and try again.");
  }

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      // A non-JSON body from a proxy or gateway. Do not let it surface as a
      // parse error the user cannot act on.
      throw new ApiRequestError(response.status, "internal", "The server sent an unexpected response.");
    }
  }

  if (!response.ok) {
    const body = payload as Partial<ApiError> | null;
    throw new ApiRequestError(
      response.status,
      body?.code ?? "internal",
      body?.error ?? `Request failed (${response.status}).`,
      body?.fields,
    );
  }

  return payload as T;
}

export const apiGet = <T>(path: string, query?: RequestOptions["query"], signal?: AbortSignal) =>
  api<T>(path, { method: "GET", query, signal });

export const apiPost = <T>(path: string, body?: unknown) => api<T>(path, { method: "POST", body });

export const apiPatch = <T>(path: string, body?: unknown) => api<T>(path, { method: "PATCH", body });

/** `GET /health` sits outside the versioned prefix and needs no token. */
export async function health(): Promise<{ ok: boolean; db: string; dbLatencyMs: number; demoMode: boolean }> {
  const response = await fetch(`${BASE}/health`);
  return response.json();
}
