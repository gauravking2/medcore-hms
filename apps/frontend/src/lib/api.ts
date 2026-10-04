function normalizeApiBase(raw: string | undefined): string {
  const base = (raw ?? 'http://localhost:3001').trim().replace(/\/$/, '');
  // Deployment blueprints may inject a bare public hostname (no scheme);
  // public hosts always use HTTPS. Explicit values, including localhost,
  // pass through untouched.
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(base) && base.includes('.')) return `https://${base}`;
  return base;
}

const API_BASE = normalizeApiBase(process.env.NEXT_PUBLIC_API_URL);

export interface ApiSuccess<T> {
  success: true;
  data: T;
  message: string;
}

export interface ApiErrorBody {
  success: false;
  error: { code: string; message: string };
}

export class ApiError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export interface ApiPaginated<T> {
  success: true;
  data: T[];
  meta: { page: number; limit: number; total: number; totalPages: number };
  message: string;
}

async function parse<T>(response: Response): Promise<T>;
async function parse<T>(response: Response, raw: true): Promise<ApiSuccess<T> | ApiPaginated<T> | ApiErrorBody>;
async function parse<T>(response: Response, raw?: true): Promise<unknown> {
  const body = (await response.json()) as ApiSuccess<T> | ApiPaginated<T> | ApiErrorBody;
  if (!response.ok || body.success === false) {
    const error = (body as ApiErrorBody).error ?? { code: 'REQUEST_FAILED', message: 'Request failed.' };
    throw new ApiError(error.code, error.message, response.status);
  }
  if (raw) return body;
  return (body as ApiSuccess<T>).data;
}

async function request(input: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(input, init);
  } catch {
    // The server never responded (network down, wrong API base, or CORS
    // preflight blocked). Surface a distinct code so pages can show the real
    // failure instead of a generic fallback. No URLs or secrets included.
    throw new ApiError('NETWORK_ERROR', 'Cannot reach the server. Check your connection and try again.', 0);
  }
}

export async function apiPost<T>(path: string, body: unknown, init?: RequestInit): Promise<T> {
  const response = await request(`${API_BASE}/api${path}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    ...init,
  });
  return parse<T>(response);
}

export async function apiGet<T>(path: string, token?: string): Promise<T> {
  const response = await request(`${API_BASE}/api${path}`, {
    credentials: 'include',
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  return parse<T>(response);
}

export async function apiGetPage<T>(path: string, token?: string): Promise<ApiPaginated<T>> {
  const response = await request(`${API_BASE}/api${path}`, {
    credentials: 'include',
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  const body = await parse<T[]>(response, true);
  if (Array.isArray((body as ApiPaginated<T>).data) && (body as ApiPaginated<T>).meta) {
    return body as ApiPaginated<T>;
  }
  throw new ApiError('BAD_RESPONSE', 'Unexpected response shape.', response.status);
}

export async function apiPatch<T>(path: string, body: unknown, token?: string): Promise<T> {
  const response = await request(`${API_BASE}/api${path}`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  return parse<T>(response);
}

export function apiBase(): string {
  return API_BASE;
}
