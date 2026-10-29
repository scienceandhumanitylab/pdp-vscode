# The Graph is drawn with Mermaid in a webview, shipped with the extension

The Graph is a webview that renders a Mermaid `flowchart` built from the Task
status. Mermaid's single `dist/mermaid.min.js` is copied into `media/` at
build time and loaded from there, so the Graph works offline and no CDN is
trusted. It is the only runtime dependency the extension carries.

## Considered Options

- **Tasks view and `pdp tree` only.** Rejected: users asked for a real drawn
  graph.
- **Load Mermaid from a CDN.** Rejected: needs network access and widens the
  webview's Content-Security-Policy.
- **A layout library such as Cytoscape or ELK.** More control, but more code
  to draw a graph Mermaid already lays out well at pdp project sizes.

## Consequences

- `media/` must not be excluded by `.vscodeignore`.
- Stale and fresh nodes must be styled with theme colours plus a text or
  shape marker, and checked for contrast in light, dark and high-contrast
  themes (see `AGENTS.md`).
