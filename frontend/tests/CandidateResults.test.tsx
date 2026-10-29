import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import CandidateResults from '../src/components/result/CandidateResults'
import type { ClaimCandidates } from '../src/types'

const result = {
  status: 'candidates', analysis_id: 'snapshot', claim: 'Does zinc prevent colds?',
  normalized: { query: 'zinc cold' }, total_results: 1, cached: false,
  coverage: { retrieved_studies: 1, abstract_only: 1, metadata_only: 0, full_text_available: 0 },
  candidates: [{
    article: { pmid: '1', title: 'A recorded study', abstract: 'Original source text.', journal: 'Test journal', year: 2024, publication_types: [], url: 'https://pubmed.ncbi.nlm.nih.gov/1/' },
    metadata: { design: 'cohort' },
    access: { level: 'abstract_only', reason: 'not_available', detail: '', pmc_id: null, source_url: null, license: null, sections: [] },
  }],
} as ClaimCandidates

const complete = {
  status: 'complete', studies: [], synthesis: null, cached: false,
  coverage: { direct: 0, related: 0, not_addressed: 0, unclear: 0, no_abstract: 0, withheld: 0, failed: 0, outside_limit: 0 },
}
const response = (status: number, body = {}, headers = {}) => new Response(JSON.stringify(body), { status, headers })

describe('overview error recovery', () => {
  it('keeps papers readable on 429 and gates manual retry until the delay passes', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(response(429, {}, { 'Retry-After': '2' }))
      .mockResolvedValueOnce(response(200, complete))
    vi.stubGlobal('fetch', fetch)
    render(<CandidateResults result={result} onRefresh={vi.fn()} />)
    await screen.findByRole('alert')
    expect(screen.getByRole('alert').textContent).toContain('Your studies are still available')
    expect(screen.getByText('A recorded study')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Retry overview in 2s' }).hasAttribute('disabled')).toBe(true)
    expect(fetch).toHaveBeenCalledTimes(1)
    // Advancing the displayed clock must never itself trigger another request.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Retry overview' }).hasAttribute('disabled')).toBe(false), { timeout: 4000 })
    expect(fetch).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Retry overview' }))
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
  })

  it('offers a manual retry when the header is absent', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(429)))
    render(<CandidateResults result={result} onRefresh={vi.fn()} />)
    expect((await screen.findByRole('alert')).textContent).toContain('wait a moment')
    expect(screen.getByRole('button', { name: 'Retry overview' }).hasAttribute('disabled')).toBe(false)
  })

  it('refreshes an expired snapshot instead of retrying its old token', async () => {
    const refresh = vi.fn()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(410)))
    render(<CandidateResults result={result} onRefresh={refresh} />)
    expect((await screen.findByRole('alert')).textContent).toContain('expired')
    fireEvent.click(screen.getByRole('button', { name: 'Refresh search' }))
    expect(refresh).toHaveBeenCalledOnce()
  })

  it('keeps original abstracts available after a provider failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(503)))
    render(<CandidateResults result={result} onRefresh={vi.fn()} />)
    expect((await screen.findByRole('alert')).textContent).toContain('studies are still available')
    expect(screen.getByText('Original source text.')).toBeTruthy()
  })

  it('aborts the previous request when the search snapshot changes', async () => {
    const signals: AbortSignal[] = []
    vi.stubGlobal('fetch', vi.fn((_url, options) => {
      signals.push(options.signal)
      return new Promise<Response>(() => {})
    }))
    const { rerender, unmount } = render(<CandidateResults result={result} onRefresh={vi.fn()} />)
    rerender(<CandidateResults result={{ ...result, analysis_id: 'new-snapshot' } as ClaimCandidates} onRefresh={vi.fn()} />)
    expect(signals[0].aborted).toBe(true)
    expect(signals[1].aborted).toBe(false)
    unmount()
    expect(signals[1].aborted).toBe(true)
  })
})
