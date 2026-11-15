# Accessibility changes for issue 85

This PR builds on the navigation work for issue 81. That parent adds one
`main#main-content`, the first-focusable skip link, named navigation, page titles,
and focus movement after navigation. This PR completes controls, text styles,
and repeatable checks for the existing pages and research results.

## Changes

- NormalizeDemo now exposes a named tab panel, one tab in the Tab sequence,
  selected-state relationships, wrapping arrows, Home, and End. Tab moves into
  the active panel before its controls. The two existing result tab components
  use the same key mapping.
- Normalization and retraction actions keep the same button element when their
  labels change to Reset. Keyboard focus survives completion. Running retraction
  checks reject repeated activation and announce their status.
- Search results announce a short completion message instead of treating the
  entire results section as a live region. Study articles have accessible names;
  citation navigation can focus the selected article with a visible ring.
- Study-type and publication-flag choices have group names. The score explanation
  uses a disclosure region instead of a tooltip containing an interactive button.
  Escape closes the disclosure and restores focus to its trigger.
- Meaningful headings and explanatory text use Comfortaa and system sans fonts.
  The decorative brand mark and signature retain their existing lettering.
- Muted text uses stronger foreground colors. Success labels and the supported
  score capsule use darker hues. Excluded records remain fully readable and keep
  explicit status words and strike-through, rather than fading their text.
- Keyboard controls receive visible focus rings. Search input and submit rings
  remain inside the capsule; tab outlines remain inside their scrolling strip.
  Programmatic result scrolling respects reduced-motion preferences.

## Contrast evidence

The following ratios use the WCAG relative-luminance calculation on the listed
foreground and background colors. They are sample pairs, not a substitute for
checking every rendered gradient, transparency layer, focus state, and viewport.

| Text and surface | Before | After |
| --- | --- | --- |
| Muted ink on the light gradient's blue stop | `#5A6B8C` on `#D9EBFB`: 4.398:1 | `#4B5B77` on `#D9EBFB`: 5.626:1 |
| Green label on pale green | `#2F8F5B` on `#E5F6EC`: 3.600:1 | `#237248` on `#E5F6EC`: 5.242:1 |
| White score text on the blue capsule's light stop | White on `#3D8ED6`: 3.478:1 | White on `#28689F`: 5.881:1 |

Normal text needs at least 4.5:1; qualifying large text needs at least 3:1.
The implementation uses opaque dark-theme text tokens so background effects do
not also reduce the foreground's opacity. Inactive controls and decorative
lettering are treated separately from essential text.

## Automated checks

From `frontend`, after installing dependencies:

```sh
npm ci
npx playwright install --with-deps chromium
npm run build
npm run test:e2e -- e2e/accessibility.spec.ts
```

The browser suite uses recorded synthetic responses. It does not call Azure,
PubMed, or a database. It exercises 18 tests:

- Home, How it works, and About in both dark and light themes.
- Skip navigation, search scope, information disclosure, claim input, submission,
  status announcements, and visible keyboard focus.
- Educational tab wrapping, Home/End, one active tab stop, panel naming, and
  normalization state changes.
- Completed study-type and retraction demos, including flags and excluded rows.
- Research results, citation focus, multiple study tabs, expanded passages,
  expanded abstracts, and relevance filtering.
- Empty searches, service errors, narrow layouts, and reduced-motion rendering.

Each axe scan checks WCAG A and AA tags without disabling individual rules.
Failures print the rule, selector, HTML, and failure summary in the CI log.
The complete JSON result, including items requiring manual review, is attached
to the test result. A passing scan is not a complete accessibility certification.

## Verification record

The frontend production build and discovery of all 18 browser tests passed in
the preparation environment. Chromium could not launch there because its
process socket was denied by the host. Installing the standard Playwright
headless shell also failed because the download was not a valid archive.
Browser pass counts and rendered contrast results must come from the actual CI
run, not from successful test discovery.

The current claim checker renders candidate research results. The older verdict
view's ScoreTip and ReferralTabs receive compatible semantics changes, but the
page suite does not exercise that inactive view. Their interaction behavior
still needs an isolated component or browser check before that view is enabled.

Manual keyboard checks and a screen-reader walkthrough must be recorded
separately. In particular, check the spoken title on navigation, skip-link
destination, search labels, error announcements, selected tab names, reading
order, and return focus after a disclosure closes. No screen-reader session is
claimed in this preparation record.

## References

- [Issue 85](https://github.com/carsonful/SecondOpinion/issues/85)
- [Navigation dependency, issue 81](https://github.com/carsonful/SecondOpinion/issues/81)
- [WAI tab pattern](https://www.w3.org/WAI/ARIA/apg/patterns/tabs/)
- [WCAG 2.2 minimum text contrast](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html)

AI assistance: ChatGPT helped implement and review these changes and tests.
The three commits carry the repository's `[ai-assisted]` marker. Reviewers should
use the diff and executable checks to assess the changes.
