import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useClaimChecker } from '../src/hooks/useClaimChecker'

const result = { status: 'candidates', claim: 'Does zinc prevent colds?', candidates: [], total_results: 0 }
const response = (body: unknown, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers })

describe('claim request recovery', () => {
  it('shows a 429 delay and allows another cached search', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(response({}, 429, { 'Retry-After': '10' }))
      .mockResolvedValueOnce(response({ ...result, cached: true }))
    vi.stubGlobal('fetch', fetch)
    const { result: hook } = renderHook(() => useClaimChecker())
    await act(() => hook.current.checkClaim('Does zinc prevent colds?'))
    expect(hook.current.status).toBe('error')
    expect(hook.current.errorMessage).toContain('10 seconds')
    await act(() => hook.current.checkClaim('Another previously cached claim'))
    expect(hook.current.status).toBe('success')
    expect(hook.current.candidates?.cached).toBe(true)
    expect(hook.current.errorMessage).toBe('')
  })

  it.each([[422, 'one clear health claim'], [503, 'unavailable'], [500, 'Something went wrong']])(
    'preserves the existing %s message', async (status, message) => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({}, status)))
      const { result: hook } = renderHook(() => useClaimChecker())
      await act(() => hook.current.checkClaim('A health claim'))
      expect(hook.current.errorMessage).toContain(message)
    },
  )

  it('handles a 429 without a Retry-After header', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({}, 429)))
    const { result: hook } = renderHook(() => useClaimChecker())
    await act(() => hook.current.checkClaim('A health claim'))
    expect(hook.current.errorMessage).toContain('wait a moment')
  })

  it('preserves network failure recovery', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')))
    const { result: hook } = renderHook(() => useClaimChecker())
    await act(() => hook.current.checkClaim('A health claim'))
    expect(hook.current.errorMessage).toContain("Can't reach the server")
  })

  it('ignores a stale 429 after a newer successful search', async () => {
    let release!: (value: Response) => void
    const first = new Promise<Response>(resolve => { release = resolve })
    vi.stubGlobal('fetch', vi.fn().mockReturnValueOnce(first).mockResolvedValueOnce(response(result)))
    const { result: hook } = renderHook(() => useClaimChecker())
    let pending!: Promise<void>
    act(() => { pending = hook.current.checkClaim('First claim') })
    await act(() => hook.current.checkClaim('Second claim'))
    await act(async () => { release(response({}, 429)); await pending })
    expect(hook.current.status).toBe('success')
    expect(hook.current.activeClaim).toBe('Second claim')
    expect(hook.current.errorMessage).toBe('')
  })

  it('does not restore a result after reset', async () => {
    let release!: (value: Response) => void
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(new Promise<Response>(resolve => { release = resolve })))
    const { result: hook } = renderHook(() => useClaimChecker())
    let pending!: Promise<void>
    act(() => { pending = hook.current.checkClaim('A health claim') })
    act(() => hook.current.reset())
    await act(async () => { release(response(result)); await pending })
    expect(hook.current.status).toBe('idle')
    expect(hook.current.candidates).toBeNull()
  })
})
