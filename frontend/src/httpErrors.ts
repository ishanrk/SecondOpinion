/** Retry-After can be a delay in seconds or an HTTP date. Never use server bodies as UI copy. */
export function retryAfterSeconds(response: Response, now = Date.now()): number | null {
  const header = response.headers.get('Retry-After')?.trim()
  if (!header) return null
  if (/^\d+$/.test(header)) {
    const seconds = Number(header)
    return Number.isSafeInteger(seconds) ? Math.max(1, seconds) : null
  }
  // Do not interpret malformed numeric values as dates (e.g. "1.5" or "-1").
  if (!/^[A-Za-z]{3}, /.test(header)) return null
  const timestamp = Date.parse(header)
  if (!Number.isFinite(timestamp)) return null
  return Math.max(1, Math.ceil((timestamp - now) / 1000))
}

export function rateLimitMessage(response: Response, overview = false): string {
  const seconds = retryAfterSeconds(response)
  const wait = seconds === null ? 'Please wait a moment before trying again.'
    : `Please wait ${seconds} ${seconds === 1 ? 'second' : 'seconds'} before trying again.`
  return overview
    ? `The research overview is temporarily limited. ${wait} Your studies are still available below.`
    : `Too many research requests. ${wait} Cached searches may still be available.`
}
