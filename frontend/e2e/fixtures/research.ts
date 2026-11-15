import type { Overview, SearchResult } from '../../src/components/result/researchTypes'

// Synthetic records exercise UI states. They make no medical claims and are
// never submitted to PubMed, Azure, or the application database.
const papers = [
  { pmid: '90000001', name: 'Recorded study A', design: 'randomized_controlled_trial' },
  { pmid: '90000002', name: 'Recorded study B', design: 'randomized_controlled_trial' },
  { pmid: '90000003', name: 'Recorded study C', design: 'cohort' },
]

export const researchResult: SearchResult = {
  status: 'candidates',
  claim: 'A sample research question',
  normalized: { query: 'fixture query' },
  analysis_id: 'accessibility-fixture',
  total_results: papers.length,
  pmc_only: false,
  cached: false,
  coverage: {
    retrieved_studies: papers.length,
    full_text_available: 0,
    abstract_only: papers.length,
    metadata_only: 0,
  },
  candidates: papers.map(paper => ({
    article: {
      pmid: paper.pmid,
      title: paper.name,
      abstract: 'Recorded passage for an interface test. This is not a clinical finding.',
      journal: 'Example journal',
      year: 2024,
      publication_types: ['Journal Article'],
      url: `https://example.test/papers/${paper.pmid}`,
    },
    metadata: { design: paper.design, population: 'human' },
    access: {
      level: 'abstract_only',
      reason: 'fixture',
      detail: 'Recorded abstract',
      pmc_id: null,
      source_url: null,
      license: null,
      sections: [],
    },
    integrity: { status: 'no_notice_found', label: 'No notice found', notices: [] },
  })),
  excluded_retracted: [],
}

export const researchOverview: Overview = {
  basis: 'abstracts',
  status: 'complete',
  coverage: {
    full_text: 0,
    abstracts: 3,
    retrieved: 3,
    analyzed: 3,
    direct: 2,
    related: 1,
    not_addressed: 0,
    unclear: 0,
    no_abstract: 0,
    withheld: 0,
    failed: 0,
    outside_limit: 0,
    excluded_retracted: 0,
  },
  studies: papers.map((paper, index) => ({
    pmid: paper.pmid,
    status: 'analyzed',
    source_basis: 'abstract',
    source_note: null,
    reason: null,
    explanation: {
      summary: { text: 'Recorded explanation for the interface test.', passage: 'Recorded passage.' },
      relevance: index === 1 ? 'related' : 'direct',
      relationship: { text: 'This record is included in the test set.', passage: 'Recorded passage.' },
      gaps: ['The record is synthetic and cannot support a medical conclusion.'],
    },
  })),
  synthesis: {
    observations: [{ text: 'This is a recorded interface test summary.', pmids: ['90000002'] }],
    qualifications: [{ text: 'These records are synthetic.', pmids: ['90000001'] }],
  },
  cached: false,
}
