export type ApiSuccess<T> = { success: true; data: T; message: string };
export type ApiError = { success: false; error: { code: string; message: string } };
export type ApiPaginated<T> = {
  success: true;
  data: T[];
  meta: { page: number; limit: number; total: number; totalPages: number };
};

export function ok<T>(data: T, message = 'OK'): ApiSuccess<T> {
  return { success: true, data, message };
}

export function paginated<T>(data: T[], page: number, limit: number, total: number): ApiPaginated<T> {
  return {
    success: true,
    data,
    meta: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
  };
}

export function parsePagination(query: Record<string, unknown>) {
  const page = Math.max(1, Number(query.page ?? 1) || 1);
  const limit = Math.min(100, Math.max(1, Number(query.limit ?? 20) || 20));
  const search = typeof query.search === 'string' && query.search.trim() ? query.search.trim() : undefined;
  return { page, limit, search, skip: (page - 1) * limit };
}
