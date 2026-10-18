export class ApiError extends Error {
  status: number
  fields: Record<string, string[]>
  constructor(status: number, message: string, fields: Record<string, string[]> = {}) {
    super(message)
    this.status = status
    this.fields = fields
  }
}

/** Set once the realtime connection is up, so the server can tell this tab apart from others. */
let connectionId: string | null = null
export const setConnectionId = (id: string | null) => { connectionId = id }

/** Called on any 401 so the app can drop back to the sign-in screen. */
let onUnauthorized: (() => void) | null = null
export const setUnauthorizedHandler = (fn: () => void) => { onUnauthorized = fn }

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { 'X-Requested-With': 'taskboard' }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (connectionId) headers['X-SignalR-Connection'] = connectionId

  const res = await fetch(url, {
    method,
    headers,
    credentials: 'same-origin',
    body: body === undefined ? undefined : JSON.stringify(body),
  })

  if (res.status === 204) return undefined as T
  const text = await res.text()
  const data = text ? safeJson(text) : null

  if (!res.ok) {
    if (res.status === 401 && !url.startsWith('/api/auth/')) onUnauthorized?.()
    const fields: Record<string, string[]> = data?.errors ?? {}
    const first = Object.values(fields).flat()[0]
    const message = res.status === 429
      ? 'محاولات كثيرة. انتظر دقيقة وحاول مرة ثانية.'
      : (first as string | undefined) ?? data?.detail ?? data?.title ?? `تعذّر تنفيذ الطلب (${res.status})`
    throw new ApiError(res.status, message, fields)
  }
  return data as T
}

function safeJson(text: string) {
  try { return JSON.parse(text) } catch { return null }
}

export const api = {
  get: <T>(url: string) => request<T>('GET', url),
  post: <T>(url: string, body: unknown = {}) => request<T>('POST', url, body),
  patch: <T>(url: string, body: unknown) => request<T>('PATCH', url, body),
  del: <T = void>(url: string) => request<T>('DELETE', url),
}

/** Minutes east of UTC, which the server uses to work out "today" for this viewer. */
export const tz = () => -new Date().getTimezoneOffset()
