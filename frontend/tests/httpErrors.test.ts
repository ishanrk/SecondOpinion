import { describe, expect, it } from 'vitest'
import { rateLimitMessage, retryAfterSeconds } from '../src/httpErrors'

function limited(header?: string) {
  return new Response(null, { status: 429, headers: header === undefined ? {} : { 'Retry-After': header } })
}

describe('Retry-After parsing', () => {
  it.each([['30', 30], [' 7 ', 7], ['0', 1]])('accepts %s seconds', (value, expected) => {
    expect(retryAfterSeconds(limited(value))).toBe(expected)
  })
  it.each([undefined, '', 'later', '-1', '1.5', 'Infinity', '9999999999999999999999'])('ignores malformed %s', value => {
    expect(retryAfterSeconds(limited(value))).toBeNull()
  })
  it('accepts HTTP dates and rounds up remaining seconds', () => {
    const now = Date.UTC(2026, 9, 29, 12)
    expect(retryAfterSeconds(limited('Thu, 29 Oct 2026 12:00:30 GMT'), now + 500)).toBe(30)
    expect(retryAfterSeconds(limited('Thu, 29 Oct 2026 11:59:00 GMT'), now)).toBe(1)
  })
  it('uses friendly copy without displaying upstream bodies', () => {
    expect(rateLimitMessage(limited('1'))).toContain('1 second before')
    expect(rateLimitMessage(limited('30'), true)).toContain('Your studies are still available')
    expect(rateLimitMessage(limited())).toContain('wait a moment')
  })
})
