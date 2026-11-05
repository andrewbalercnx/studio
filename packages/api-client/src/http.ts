/**
 * The one transport every call goes through: base URL, the caller's token,
 * a timeout, and one reading of the answer.
 *
 * Routes on the server's route wrapper answer `{ ok: true, data }` or
 * `{ ok: false, error: { code, message } }`. A few older routes answer bare
 * JSON (`raw`); their errors are `{ error | errorMessage: string }`.
 */

export type TokenProvider = () => Promise<string | null | undefined>;

export type StoryPicClientConfig = {
  /** Where the API lives: `'/api'` on the web, `'https://…/api'` on mobile. */
  baseUrl: string;
  /** The signed-in user's Firebase ID token; null sends the request without one. */
  getToken: TokenProvider;
  /** Milliseconds before a request is given up (default 60 000). */
  timeoutMs?: number;
  /** For tests, or a platform without a global `fetch`. */
  fetch?: typeof fetch;
};

/** Every failed call: the server's code and user-safe message, and the HTTP status (0 = no connection). */
export class StoryPicApiError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number
  ) {
    super(message);
    this.name = 'StoryPicApiError';
  }
}

export const NETWORK_MESSAGE = 'We could not reach StoryPic. Check the connection and try again.';

export type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export type Transport = {
  /** A wrapper route: answers `data`, throws `StoryPicApiError` on `{ ok: false }` or a non-2xx status. */
  call<T>(method: Method, path: string, body?: unknown): Promise<T>;
  /** An older route answering bare JSON. */
  raw<T>(method: Method, path: string, body?: unknown): Promise<T>;
};

type ErrorBody = { ok?: boolean; error?: unknown; errorMessage?: unknown; message?: unknown; code?: unknown };

function errorFrom(payload: ErrorBody | null, status: number): StoryPicApiError {
  const envelope = payload && typeof payload.error === 'object' && payload.error !== null ? (payload.error as { code?: unknown; message?: unknown }) : null;
  const message =
    (typeof envelope?.message === 'string' && envelope.message) ||
    (typeof payload?.errorMessage === 'string' && payload.errorMessage) ||
    (typeof payload?.message === 'string' && payload.message) ||
    (typeof payload?.error === 'string' && payload.error) ||
    'Something went wrong. Please try again.';
  const code = (typeof envelope?.code === 'string' && envelope.code) || (typeof payload?.code === 'string' && payload.code) || 'REQUEST_FAILED';
  return new StoryPicApiError(message, code, status);
}

export function createTransport(config: StoryPicClientConfig): Transport {
  const baseUrl = config.baseUrl.replace(/\/$/, '');
  const timeoutMs = config.timeoutMs ?? 60_000;

  async function send(method: Method, path: string, body: unknown): Promise<{ status: number; ok: boolean; payload: unknown }> {
    const doFetch = config.fetch ?? fetch;
    const token = await config.getToken();
    const headers: Record<string, string> = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (token) headers.Authorization = `Bearer ${token}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
      response = await doFetch(`${baseUrl}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') throw new StoryPicApiError('That took too long. Please try again.', 'TIMEOUT', 408);
      throw new StoryPicApiError(NETWORK_MESSAGE, 'NETWORK', 0);
    } finally {
      clearTimeout(timer);
    }
    let payload: unknown = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
    return { status: response.status, ok: response.ok, payload };
  }

  return {
    async call<T>(method: Method, path: string, body?: unknown): Promise<T> {
      const { status, ok, payload } = await send(method, path, body);
      const envelope = payload as ({ ok?: boolean; data?: T } & ErrorBody) | null;
      if (!ok || !envelope || envelope.ok !== true) throw errorFrom(envelope, status);
      return envelope.data as T;
    },
    async raw<T>(method: Method, path: string, body?: unknown): Promise<T> {
      const { status, ok, payload } = await send(method, path, body);
      if (!ok || payload === null || (payload as ErrorBody).ok === false) throw errorFrom(payload as ErrorBody | null, status);
      return payload as T;
    },
  };
}

/** Path segment, encoded. */
export const seg = (value: string | number): string => encodeURIComponent(String(value));

/** `?a=1&b=2` from the defined values, or `''`. */
export function query(params: Record<string, string | null | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value) search.set(key, value);
  const text = search.toString();
  return text ? `?${text}` : '';
}
