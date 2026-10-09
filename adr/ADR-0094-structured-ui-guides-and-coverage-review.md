# ADR-0094 — Structured UI Lab user guides, engine-rendered formats and coverage review

Status: Accepted
Date: 2026-10-06

## Context

The user guide of a UI Lab run (`adr/ADR-0088`) was free Markdown written by
GPT. In practice:

- captures were shown whole, with no marker on the control a step used and no
  numbered legend, so the reader had to find the button in a full screenshot;
- steps were long prose, and redundant captures (the same form after each
  field) were all kept, because the contract required every capture in order;
- the PDF was that Markdown printed verbatim inside a `<pre>` block followed by
  an image gallery: monotonous and hard to read;
- there was no HTML guide, and a guide could not be expanded or opened in a
  browser;
- the catalog under-covered detail pages, forms and individual buttons: nothing
  checked the elements visible in a run against the test plan.

## Decision

1. **The guide is a structured document.** A guide request is
   `wharnex.ui-test-guide-input/v2`. Besides the run, each capture carries its
   pixel size and the elements measured on the page when it was taken. Each
   element has a stable id, label and text, a box in viewport fractions, and
   `acted_on` for the element the step targeted. The request also carries
   `catalog/planned-tests.json`, the environment's current test plan. The
   answer is a single `guide.json` (`wharnex.ui-test-guide/v2`). It holds the
   content: title, subtitle, purpose, audience, prerequisites, chapters of
   short imperative steps, expected result, troubleshooting and related
   features. It holds the design choices, each from a closed set: step
   `layout` (`split`, `hero`, `focus`, `compact`), theme `accent`, `cover`
   style and callout kinds. Per step it holds `annotations` (1..6, on a
   measured element id or, for anything unlisted, an explicit region), a
   `view` (`focus` or `full`) with an optional crop region, and a caption. It
   also carries the legend of every capture, the visual verdict and
   `proposed_tests`.
2. **Captures are curated.** A capture appears at most once, in the order
   taken; redundant or duplicate captures are omitted. Every capture still
   receives a legend, because the run history uses them.
3. **The engine resolves and renders.** The backend validates the answer
   fail-closed and resolves every annotation to the measured box. It resolves
   every focused view to a crop around the markers, with a minimum size and a
   readable aspect ratio. An explicit crop must contain every marker. The
   resolved document is the only input of one renderer (`uitesting/guidedoc`)
   that produces the Markdown used by the manual and the HTML page. The page
   has a cover, an index, reading progress, alternating step compositions,
   numbered markers linked to their legend, a full-capture lightbox,
   reveal-on-scroll and light/dark themes. The same page, under its print
   stylesheet, is what the Desktop prints to PDF. GPT never writes markup: its
   text is escaped, and only `**label**` emphasis becomes an interface-label
   chip.
4. **HTML is rendered when served.** The run stores `guide.json` beside its
   captures, and `guide.html` is rendered from it on every request as one
   self-contained page with the captures inlined. The design therefore applies
   to every stored v2 guide. The page is served with a CSP that allows only its
   own inline script and style and embedded images.
5. **Coverage review.** For every capture, GPT inventories the elements and
   features the interface offers and compares them with the plan. For each one
   no test exercises, it proposes a test. Proposals must name the environment
   that was run: that environment is the one proven testable in a web
   browser. They follow the discovery field rules, and are merged as new
   `discovered` tests only. An existing id is never revised and nothing is
   retired. A merge the catalog refuses is reported and never costs the
   guide. Discovery prompts likewise require detail pages, forms field by
   field and every interactive element to be covered, for web environments
   only.
6. **Viewing.** Each guide shows HTML (sandboxed `allow-scripts` frame, no
   same-origin access), PDF and Markdown. Each format can be expanded into an
   application dialog or opened in the Wharnex-owned browser through the
   narrow `wharnex:ui-testing:open-guide` IPC. That IPC accepts a session id,
   run id and format from a closed set, and the main process derives the URL
   from the allowlisted backend.

## Consequences

- Guides read as a modern manual: shorter instructions, markers on the real
  controls and focused crops instead of full screens.
- Element measurement adds one bounded page script per capture.
- An answer to a v1 request already in flight across a deploy is still
  accepted, with v1 semantics and no HTML version. Guides stored under v1 keep
  their Markdown and PDF.
- Coverage grows with every run, at most 12 proposals per guide, and every
  proposal stays inside a web environment the operator already configured.
