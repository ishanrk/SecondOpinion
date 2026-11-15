import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { researchOverview, researchResult } from './fixtures/research'

const themes = ['dark', 'light'] as const
const routes = [
  { path: '/', heading: 'Is that health claim actually true?' },
  { path: '/how-it-works', heading: 'How it works' },
  { path: '/about', heading: 'Meet the Mythbusters' },
]

async function audit(page: Page, testInfo: TestInfo, state: string) {
  await page.evaluate(() => document.fonts.ready)
  const report = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
    .analyze()
  await testInfo.attach(`axe-${state}`, {
    body: JSON.stringify(report, null, 2),
    contentType: 'application/json',
  })
  const failures = report.violations.map(violation => ({
    rule: violation.id,
    impact: violation.impact,
    nodes: violation.nodes.map(node => ({
      target: node.target,
      reason: node.failureSummary,
      html: node.html,
    })),
  }))
  // Keep the failing selectors and contrast calculations visible in CI logs.
  expect(failures, `Accessibility violations in ${state}`).toEqual([])
}

async function expectFocusRing(control: Locator) {
  await expect(control).toBeFocused()
  const ring = await control.evaluate(element => {
    const style = getComputedStyle(element)
    return { style: style.outlineStyle, width: parseFloat(style.outlineWidth) }
  })
  expect(ring.style).not.toBe('none')
  expect(ring.width).toBeGreaterThanOrEqual(2)
}

async function openResults(page: Page) {
  await page.goto('/')
  await page.getByRole('textbox', { name: 'Health claim' }).fill(researchResult.claim)
  await page.getByRole('button', { name: 'Check claim', exact: true }).click()
  await expect(page.getByText('This is a recorded interface test summary.')).toBeVisible()
  await expect(page.getByRole('article', { name: 'Recorded study A' })).toBeVisible()
}

async function checkTabPattern(page: Page, name: string) {
  const list = page.getByRole('tablist', { name, exact: true })
  const tabs = list.getByRole('tab')
  const last = (await tabs.count()) - 1
  expect(last).toBeGreaterThan(0)
  await tabs.first().focus()
  await page.keyboard.press('End')
  await expectFocusRing(tabs.nth(last))
  await expect(tabs.nth(last)).toHaveAttribute('aria-selected', 'true')
  await page.keyboard.press('ArrowRight')
  await expect(tabs.first()).toBeFocused()
  await page.keyboard.press('ArrowLeft')
  await expect(tabs.nth(last)).toBeFocused()
  await page.keyboard.press('Home')
  await expect(tabs.first()).toBeFocused()
  await expect(list.locator('[role="tab"][tabindex="0"]')).toHaveCount(1)
  await expect(list.locator('[role="tab"][aria-selected="true"]')).toHaveCount(1)
  const panelId = await tabs.first().getAttribute('aria-controls')
  expect(panelId).toBeTruthy()
  const activePanel = page.locator(`[id="${panelId}"]`)
  await expect(activePanel).toHaveAttribute('role', 'tabpanel')
  await expect(activePanel).toHaveAttribute('aria-labelledby', (await tabs.first().getAttribute('id'))!)
  await page.keyboard.press('Tab')
  await expectFocusRing(activePanel)
}

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname
    if (path === '/api/claims') {
      await route.fulfill({ json: researchResult })
    } else if (path === '/api/claims/overview/accessibility-fixture') {
      await route.fulfill({ json: researchOverview })
    } else {
      await route.fulfill({ status: 404, json: { detail: 'No recorded response for this route.' } })
    }
  })
})

for (const theme of themes) {
  test.describe(`${theme} theme`, () => {
    test.beforeEach(async ({ page }) => {
      await page.addInitScript(value => localStorage.setItem('so-theme', value), theme)
    })

    for (const route of routes) {
      test(`${route.path} has named landmarks and no axe violations`, async ({ page }, testInfo) => {
        await page.goto(route.path)
        await expect(page.getByRole('main')).toHaveCount(1)
        await expect(page.getByRole('heading', { level: 1 })).toHaveAccessibleName(route.heading)
        await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible()
        await audit(page, testInfo, `${theme}-${route.path}`)
      })
    }

    test('skip link and search controls support a complete keyboard path', async ({ page }) => {
      await page.goto('/')
      await page.keyboard.press('Tab')
      const skip = page.getByRole('link', { name: 'Skip to content' })
      await expectFocusRing(skip)
      await page.keyboard.press('Enter')
      await expect(page.getByRole('main')).toBeFocused()
      await page.keyboard.press('Tab')
      const scope = page.getByRole('switch', { name: 'PubMed Central only' })
      await expectFocusRing(scope)
      await expect(scope).toBeChecked()
      await page.keyboard.press('Space')
      await expect(scope).not.toBeChecked()
      await page.keyboard.press('Tab')
      const info = page.getByRole('button', { name: 'About PubMed Central only' })
      await expectFocusRing(info)
      await page.keyboard.press('Enter')
      await expect(info).toHaveAttribute('aria-expanded', 'true')
      const detailsId = await info.getAttribute('aria-controls')
      await expect(page.locator(`[id="${detailsId}"]`)).toBeVisible()
      await page.keyboard.press('Tab')
      const input = page.getByRole('textbox', { name: 'Health claim' })
      await expectFocusRing(input)
      await input.fill(researchResult.claim)
      await page.keyboard.press('Tab')
      await expectFocusRing(page.getByRole('button', { name: 'Check claim', exact: true }))
      await page.keyboard.press('Enter')
      await expect(page.getByRole('status').filter({ hasText: 'Research results are ready below.' })).toBeVisible()
      await expect(page.getByRole('article', { name: 'Recorded study A' })).toBeVisible()
    })

    test('educational tabs wrap, support Home/End, and label their panel', async ({ page }, testInfo) => {
      await page.goto('/how-it-works')
      await checkTabPattern(page, 'Sample claims')
      await page.keyboard.press('Tab')
      await expectFocusRing(page.getByRole('button', { name: 'Normalize it' }))
      await page.keyboard.press('Enter')
      await expect(page.getByText('Is raw milk more nutritious than pasteurized milk?', { exact: true })).toBeVisible()
      await expect(page.getByRole('button', { name: 'Reset', exact: false }).first()).toBeFocused()
      await page.getByRole('tab', { name: 'Knuckles', exact: true }).click()
      await expect(page.getByRole('button', { name: 'Normalize it' })).toBeVisible()
      await page.getByRole('button', { name: 'Normalize it' }).click()
      await expect(page.getByText('Does habitual knuckle cracking cause hand osteoarthritis?', { exact: true })).toBeVisible()
      await audit(page, testInfo, `${theme}-normalized-demo`)
    })

    test('completed demos keep publication flags and exclusions readable', async ({ page }, testInfo) => {
      await page.goto('/how-it-works')
      await page.getByRole('button', { name: 'Observational Study', exact: true }).click()
      await page.getByRole('checkbox', { name: 'Animals only' }).check()
      await page.getByRole('checkbox', { name: 'Preprint', exact: true }).check()
      await expect(page.getByText('Preclinical: animal-only evidence', { exact: true })).toBeVisible()
      await page.getByRole('button', { name: 'Run retraction check' }).click()
      await expect(page.getByText('sample sources pass this integrity screen.', { exact: false })).toBeVisible()
      await expect(page.getByText('Retracted', { exact: true })).toBeVisible()
      await expect(page.getByText('Expression of concern', { exact: true })).toBeVisible()
      await expect(page.locator('.retract__footer').getByRole('button', { name: 'Reset', exact: false })).toBeFocused()
      await audit(page, testInfo, `${theme}-completed-demos`)
    })

    test('research panels expose text labels, citations, and keyboard tabs', async ({ page }, testInfo) => {
      await openResults(page)
      await checkTabPattern(page, 'Trials')
      // The scrolling tab strip must not clip its focused tab's outline.
      const firstTab = page.getByRole('tablist', { name: 'Trials', exact: true }).getByRole('tab').first()
      await firstTab.focus()
      expect(await firstTab.evaluate(element => parseFloat(getComputedStyle(element).outlineOffset))).toBeLessThan(0)
      const citation = page.getByRole('link', { name: 'Read study 2', exact: true })
      await citation.focus()
      await page.keyboard.press('Enter')
      const cited = page.getByRole('article', { name: 'Recorded study B' })
      await expectFocusRing(cited)
      await expect(cited.getByText('Related question', { exact: true })).toBeVisible()
      await cited.getByText('Explanation and source passages', { exact: true }).click()
      await cited.getByText('Read original abstract', { exact: true }).click()
      await audit(page, testInfo, `${theme}-expanded-results`)
      await page.getByRole('combobox', { name: 'Show', exact: true }).selectOption('related')
      await expect(page.getByRole('tablist', { name: 'Trials', exact: true }).getByRole('tab')).toHaveCount(1)
      await expect(cited).toBeVisible()
      await audit(page, testInfo, `${theme}-filtered-results`)
    })

    test('empty search and error states expose messages without losing controls', async ({ page }, testInfo) => {
      await page.route('**/api/claims', route => route.fulfill({
        json: { ...researchResult, candidates: [], total_results: 0, analysis_id: null },
      }))
      await page.goto('/')
      await page.getByRole('textbox', { name: 'Health claim' }).fill('An empty test search')
      await page.getByRole('button', { name: 'Check claim', exact: true }).click()
      await expect(page.getByText('No papers were retained for this search.', { exact: false })).toBeVisible()
      await audit(page, testInfo, `${theme}-empty-results`)
      await page.route('**/api/claims', route => route.fulfill({ status: 503, json: { detail: 'Unavailable' } }))
      await page.getByRole('textbox', { name: 'Health claim' }).fill('A failed test search')
      await page.getByRole('button', { name: 'Check claim', exact: true }).click()
      await expect(page.getByRole('alert')).toContainText('An evidence service is unavailable')
      await expect(page.getByRole('button', { name: 'Try again', exact: true })).toBeVisible()
      await audit(page, testInfo, `${theme}-search-error`)
    })
  })
}

test('pages and results remain usable at a narrow viewport', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 })
  for (const route of routes) {
    await page.goto(route.path)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    const size = await page.evaluate(() => ({
      content: document.documentElement.scrollWidth,
      viewport: document.documentElement.clientWidth,
    }))
    expect(size.content, `Horizontal overflow at ${route.path}`).toBeLessThanOrEqual(size.viewport + 1)
    await audit(page, testInfo, `mobile-${route.path}`)
  }
  await openResults(page)
  await page.getByRole('button', { name: 'Refresh research', exact: false }).focus()
  await expectFocusRing(page.getByRole('button', { name: 'Refresh research', exact: false }))
  await audit(page, testInfo, 'mobile-results')
})

test('heading typography and reduced motion remain readable', async ({ page }) => {
  await page.goto('/about')
  const essential = page.getByRole('heading', { level: 1 })
  for (const node of await essential.locator(':scope, span').all()) {
    const font = await node.evaluate(element => getComputedStyle(element).fontFamily)
    expect(font).not.toContain('Homemade Apple')
  }
  await page.goto('/how-it-works')
  await page.getByRole('button', { name: 'Normalize it' }).click()
  await expect(page.getByText('Is raw milk more nutritious than pasteurized milk?', { exact: true })).toBeVisible()
  const duration = await page.locator('.norm__final').evaluate(element => getComputedStyle(element).animationDuration)
  expect(parseFloat(duration)).toBeLessThan(0.01)
})
