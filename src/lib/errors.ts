/** Present SDK/PostgREST errors without serializing arbitrary response objects. */
export function errorMessage(error: unknown): string {
  const record = error && typeof error === 'object' ? error as Record<string, unknown> : null
  const message = typeof error === 'string' ? error
    : typeof record?.message === 'string' ? record.message
    : typeof record?.error_description === 'string' ? record.error_description
    : typeof record?.error === 'string' ? record.error
    : 'The request failed. Please try again.'
  // Error details can contain row values; headers, contexts and arbitrary nested
  // objects can contain credentials. Only message and a bounded error code leave here.
  const safe = message
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[redacted token]')
    .replace(/\b(?:sb_secret_|sbp_|sk_live_|sk_test_)[A-Za-z0-9_-]+\b/g, '[redacted key]')
    .replace(/postgres(?:ql)?:\/\/\S+/gi, '[redacted database URL]')
    .slice(0, 600)
  const code = typeof record?.code === 'string' && /^[A-Z0-9_]{1,20}$/.test(record.code) ? record.code : null
  return code ? `${safe} [${code}]` : safe
}

export function requestError(action: string, error: unknown): Error {
  return new Error(`${action}: ${errorMessage(error)}`)
}
