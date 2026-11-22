# The Graph is drawn with Cytoscape in a webview, superseding ADR 0004

The Graph is a webview that renders the task DAG with Cytoscape, whose single
`dist/cytoscape.min.js` is copied into `media/` at build time and loaded from
there — offline, no CDN, as in ADR 0004. The reason for the swap: Cytoscape
draws on a canvas and lets users **drag nodes** (and pan/zoom), which Mermaid's
static SVG cannot.

The host/webview message contract is unchanged in shape: `render`/`rendered`,
`openTask`, `taskMenu`. The render message carries Cytoscape elements (from the
pure `graphElements(status, positions)` builder) plus saved node positions; on
drag end the webview posts the positions back and they persist in
`context.workspaceState`, keyed by project root + task id. Dragging moves pixels
only — nodes and edges always come from `pdp status`.

## Considered options

- **Keep Mermaid (ADR 0004).** Rejected: no dragging; the sidebar fit work in
  step 10 hit the limits of shrinking a static diagram.
- **Cytoscape from a CDN.** Rejected for the same reasons as in ADR 0004.

## Consequences

- `media/cytoscape.min.js` ships instead of `mermaid.min.js` (0.44 MB in, 5.2 MB
  out); `.vscodeignore` still must not exclude `media/`.
- The CSP is unchanged: only `webview.cspSource` scripts plus a nonce, no
  `unsafe-eval` — Cytoscape needs neither.
- The ADR 0004 accessibility rule carries over: stale/fresh is conveyed with a
  text marker (`✗`/`✓`) as well as colour, checked for contrast in light, dark
  and high-contrast themes. Tooltips (a small hover div) are optional.
- `breadthfirst` lays the graph out on first render; `preset` restores saved
  positions. Positions are per project and survive restarts.
- Keyboard users are unaffected (tree, palette, step-11 chords).
