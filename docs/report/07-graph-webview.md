# Step 7: Graph webview

## What was done

- `src/graph.ts`: `PdpGraphPanel` — a singleton webview panel rendering
  Mermaid `flowchart LR` built from `depends_on`. Nodes get generated ids
  (`n0…`) so task ids can never break the syntax; each node's text carries
  its "stale"/"fresh" label as well as a `classDef stale`/`classDef fresh`
  class. Clicking a node posts a message back and opens that task's
  `task.yml` (through the same validated path as the tree). Re-renders on
  every refresh while open and on theme changes (Mermaid `default`/`dark`
  theme by VS Code theme kind; HighContrast maps to dark). With no project
  (or a removed one) the panel shows an explanatory message instead of a
  blank or stale graph.
- `media/mermaid.min.js`: Mermaid's single self-contained classic-script dist
  file, copied from `node_modules/mermaid/dist` by
  `scripts/copy-mermaid.mjs`, run as part of `compile`/`watch`. `mermaid` is
  a devDependency; the file is gitignored but ships (`.vscodeignore` does
  not exclude `media/`; `scripts/**` is excluded). The ESM build
  (`mermaid.esm.min.mjs`) was tried first but lazy-loads diagram chunks via
  dynamic import, which a single shipped file cannot satisfy — the classic
  build has no dynamic imports and matches the plan's "single dist file".
- CSP: `default-src 'none'; style-src <cspSource> 'unsafe-inline'; script-src
  <cspSource> 'nonce-…'; img-src <cspSource> data:` with a
  `crypto.randomBytes` nonce; `localResourceRoots` limited to `media/`.

## Tests added

- `mermaidDefinition`: flowchart shape, node labels with state, edges
  upstream→downstream, unknown dependencies skipped.
- End-to-end: the panel is opened in the test harness, Mermaid loads under
  the CSP and renders; the test fails if rendering times out. The webview
  posts a "rendered" ack, which also serves as the test hook.

## Review findings and resolution

Review subagent found 3 items:

1. Nonce generated from `Math.random()` (predictable) — now
   `crypto.randomBytes(24)`. Fixed.
2. Opening the graph with no project showed a permanently blank panel, and
   an open panel kept the deleted project's graph — `render(null)` now shows
   an explanatory message, and the no-project refresh branch clears an open
   panel. (Transient status errors keep the last graph on purpose.) Fixed.
3. classDef colours are hard-coded rather than `var(--vscode-*)`. Accepted
   deviation: the fills are fixed light backgrounds with `#111111` text —
   measured contrast 13:1 (stale) and 14:1 (fresh), above the 4.5:1 AA
   requirement in every theme since contrast is text-vs-own-fill; state is
   also conveyed as text, not colour alone; edges/strokes follow Mermaid's
   light/dark theme. Noted here instead of risking unverified theme-variable
   rendering.

Also confirmed by the reviewer: `"`-escaping of task ids is sufficient
against Mermaid label injection (`securityLevel: strict` + DOMPurify covers
the rest), node click mapping is index-validated then path-validated, CSP
and packaging are correct.

## Security and accessibility checks

- Webview: strict CSP with nonce, `localResourceRoots` = `media/` only, task
  ids escaped before entering the Mermaid definition, DOMPurify via Mermaid
  `securityLevel: strict`.
- Accessibility: node state as text in every node; diagram container has
  `role="img"` + aria-label; contrast ≥ 13:1 in light, dark and
  high-contrast themes.

## Deferred

- Fixture integration tests and `vsce package` (step 8).
