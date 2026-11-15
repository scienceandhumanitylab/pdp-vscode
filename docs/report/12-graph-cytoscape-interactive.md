# Step 12: Interactive graph with Cytoscape

## What was done

Implements plan step 12; ADR 0005 supersedes ADR 0004 (a "Superseded by"
note was added to 0004). Only `pdp-vscode` changed; no pdp-library work.

- **Bundle swap:** devDependency `mermaid` removed (117 packages out of the
  lockfile), `cytoscape` 3.35.0 added. `scripts/copy-mermaid.mjs` →
  `scripts/copy-cytoscape.mjs`, copying `dist/cytoscape.min.js` (UMD, sets
  `window.cytoscape`) into gitignored `media/`. `compile`/`watch` and
  `.gitignore` updated. The `diff`/`serialize-javascript` overrides were kept
  (still relevant for mocha's transitive deps).
- **`src/graphView.ts` rewritten, same message contract:** `render`,
  `rendered`, `openTask`, `taskMenu` are unchanged in shape; one new message,
  `positions`, flows webview → host on drag end. The render message now
  carries `elements`, `ids` (task ids in node order), `labels`, `dark`,
  `fontSize` and a `preset` flag instead of a Mermaid definition.
  - `graphElements(status, positions)` is the pure builder: nodes `n0…`
    (hostile task ids cannot forge element ids) with `label` and
    `classes: stale/fresh`, saved positions attached per task id; edges from
    each `depends_on`, upstream → downstream, unknown deps skipped.
  - Webview: one Cytoscape instance per render (destroy + rebuild — listeners
    are per-instance, so nothing accumulates). `breadthfirst` (directed,
    roots = zero-indegree nodes) on first render, `preset` when every task
    has a saved position; after `destroy()` resets pan/zoom, both branches
    `cy.fit(undefined, 30)` so the arrangement stays in view. Tap →
    `openTask`, cxttap → `taskMenu` (cytoscape preventDefaults the native
    contextmenu), dragfree → posts all positions. Hover shows a small div
    (`--vscode-editorHoverWidget-*` colours) with the node's full state; the
    empty state and tooltip use `textContent`, and node labels are canvas
    text — no data ever enters HTML. `window` resize only calls
    `cy.resize()`, preserving zoom.
  - Positions persist in `context.workspaceState` under
    `pdp.graph.positions:<workspace root>` (new `storage: vscode.Memento`
    constructor parameter, passed from `activate`). Both the read path and
    the webview echo go through `validPositions` (finite numbers only) and
    the echo is additionally filtered to ids in the current status. Dragging
    moves pixels only; nodes and edges always come from `pdp status`.
  - Zero-task projects now get the empty-state text ("No tasks in this
    project yet…") instead of a blank canvas; `pushEmpty` gained a message
    parameter.
- **`src/extension.ts`:** one line — pass `context.workspaceState`.
- **Docs:** ADR 0005; guide "The graph" section (drag/pan/zoom, remembered
  layout, re-layout on new tasks); CHANGELOG entry.
- **Sizes** (`pnpm exec vsce package`, same 14 files):
  - before (mermaid): vsix **1,610,826 bytes (1.54 MB)**; `media/mermaid.min.js`
    5.24 MB raw.
  - after (cytoscape): vsix **167,691 bytes (164 KB)**; `media/cytoscape.min.js`
    0.44 MB raw. ~90% smaller vsix.

## Tests added

`src/test/graph.test.ts` rewritten; 33 passing, exit 0 (compile + lint +
suite). Each new behavior was watched failing before implementation
(`graphElements` did not exist → compile red).

- `graphElements`: node order/labels/classes, saved positions attached,
  edges upstream → downstream, unknown deps skipped.
- Stub-webview: `taskMenu` still maps node → task id; the render message
  carries `elements`/`ids`/`labels`/`fontSize`; the font-size setting still
  re-renders on its own; junk persisted in workspaceState (read path) is
  dropped and does not flip `preset`; a `positions` echo drops unknown ids
  and non-finite values and persists the rest; completing the positions
  switches the next render to `preset`; zero tasks posts the empty state.
- Real-webview smoke test (renamed): the sidebar view renders with the
  shipped cytoscape.min.js under the CSP and acks `rendered`.

## Review findings and resolution

A fresh-context review subagent read the diff, the changed files, both ADRs
and AGENTS.md, checked the webview script against cytoscape 3.35 semantics
in `node_modules/cytoscape/dist/cytoscape.umd.js`, and re-ran tsc, eslint,
prettier and the suite (33 passing). Findings:

1. **Major — preset renders could show the graph clipped/off-screen.**
   destroy() resets pan/zoom and the preset branch never re-fitted, while
   refreshes re-render often. Fixed: `cy.fit(undefined, 30)` in the preset
   branch (re-review-confirmed pan/zoom reset makes fit strictly better).
2. **Minor — the workspaceState read path had no test.** Fixed: the stub
   test pre-seeds junk and asserts only finite, valid positions attach and
   `preset` stays false.
3. **Nit — zero-task project showed a blank canvas.** Fixed: routed to the
   empty-state message; asserted in the stub test.
4. **Nit — tooltip can clip near the sidebar edge.** Deferred: cosmetic,
   no clamping; the hover div is optional per ADR 0005.
5. **Nit — ADR size numbers ambiguous.** Fixed: now "0.44 MB in, 5.2 MB
   out".
6. Verified as correct by the reviewer (no change needed): tap is suppressed
   after a drag so dragging never opens `task.yml`; cytoscape's own
   contextmenu preventDefault; `roots` as bare node ids; `layoutstop` fires
   synchronously with `animate: false`, so the old async-label race is gone
   for good; per-instance listeners can't accumulate; `width/height: "label"`
   still works in 3.35 (logs a deprecation warning; marked with the
   in-code `shortcut:` comment).

## Security and accessibility checks

- CSP unchanged and strict: `default-src 'none'`, scripts only from
  `webview.cspSource` with a nonce (cytoscape needs no `unsafe-eval`),
  `localResourceRoots` = `media/`. `media/` not excluded by `.vscodeignore`;
  verified shipped in both packaged vsix files.
- Untrusted data: task ids from pdp never enter HTML — labels are canvas
  text; empty-state and tooltip text via `textContent`; `taskAt` still
  enforces `^n\d+$`; positions (webview echo and persisted workspaceState)
  validated as finite numbers and filtered to known task ids. No new runtime
  dependency; no spawn changes.
- Accessibility: state is conveyed by the `✗`/`✓` text marker as well as
  colour (ADR 0005 carries over ADR 0004's rule); `role="img"` +
  `aria-label` kept on the container. Contrast (reviewer-computed): black on
  `#f48f84` 9.1:1 and on `#83a598` 7.8:1 (AA); borders ≥ 3:1; edges
  `#9aa0a6` on dark 6.3:1, `#6e7681` on light 4.6:1. Keyboard access
  unchanged (tree, palette, step-11 chords); hover is supplementary only.
- Not hand-checked in a dev host this session: the drag feel, right-click
  menu on the canvas, and theme switches. The automated smoke test covers
  the load/render handshake only.

## Deferred / known limits

- `width: "label"` is deprecated in cytoscape 3.35; if a future cytoscape
  drops it, measure label text in the webview instead (comment in code).
- Tooltip does not clamp to the sidebar edge.
- Zoom/pan are re-fit on every re-render (a consequence of destroy+rebuild;
  mermaid behaved the same by re-inserting its SVG). Persisting the viewport
  is possible later via the same `positions` channel.
- Graph positions are keyed by workspace root; a project moved to another
  root starts from `breadthfirst` again.

## Follow-up: readable boxes, capped zoom, stable view, reset button

Post-step polish on the same graph (unreleased), reviewed by a fresh-context
subagent that verified the Cytoscape 3.35 semantics below in the dist and
re-ran the suite.

- **Node padding:** the deprecated `width/height: "label"` hugged (and
  clipped) the text, and the label side-spaces had no effect. The webview now
  measures each label with the same font and sizes boxes from it — `PAD_X` /
  `PAD_Y` are the knobs. Commit `647f5a0`.
- **Zoom capped at 1.5×** (`maxZoom`): `fit()` can zoom out to fit big graphs
  but never past 150%, so `pdp.graphFontSize` maps to real pixel sizes. Fit
  still fills small graphs up to the cap.
- **The view stays put across refreshes (resolves the deferred item above):**
  the `positions` message now carries `zoom` + `pan`; the stored value became
  `{positions, viewport?}` (old flat data degrades to a one-time re-layout).
  Saved on drag end and debounced 400 ms after zoom/pan (skipped while a
  render applies a layout), restored with `cy.zoom()`/`cy.pan()` on preset
  renders instead of `fit()`. The first automatic layout is auto-adopted as
  the baseline, so even a never-touched graph keeps its view; only adding a
  task (or the reset) re-lays-out.
- **`pdp.resetGraphLayout`** ("PDP: Reset Graph Layout", `$(discard)` button
  on the Graph view title bar, palette + keyboard reachable) clears the
  remembered arrangement and view and re-renders `breadthfirst` + fit. Runs
  and refreshes never reset anything.
- Review findings addressed: the debounce timer is cleared at both teardown
  points (it could fire on a destroyed instance — a real TypeError). Accepted
  as-is with a `shortcut:` comment: a zoom/pan ≤400 ms before a re-render is
  overwritten once and self-corrects; zoom/pan remain mouse/wheel-only (the
  tree, palette, chords and the reset button carry keyboard access).
- **Fixed: refreshes re-laid the graph out as a grid.** The Cytoscape
  constructor runs an implicit `grid` layout when none is configured
  (`umd.js:20188`), silently overwriting the saved preset positions on every
  re-render — the earlier viewport work was correct but looked broken. The
  constructor now gets `layout: { name: "preset", fit: false }`. The
  regression test is real: with the fix compiled out, the smoke test fails
  with "refresh moved the nodes".
- **Zoom buttons:** `pdp.graphZoomIn` / `pdp.graphZoomOut` (`$(zoom-in)` /
  `$(zoom-out)`, Graph title bar) zoom ±25% about the view's centre within
  the 1.5 cap; the result persists like a wheel zoom. Zoom is now keyboard-
  and palette-reachable, closing the reviewer's deferred accessibility item.
- **Layout picker:** `pdp.graphChooseLayout` (`$(layout)`, Graph title bar)
  offers Top-down, Left-right (breadthfirst with an x/y swap transform) and
  Force-directed (`cose`). Picking one clears the old geometry and re-renders;
  the choice is stored per project, arrangement saves preserve it, and
  **Reset Graph Layout** returns to the chosen layout, not always top-down.
  Unknown names are rejected host-side. A DAG-specialised layout (dagre)
  was considered and deferred — it would add a shipped dependency and needs
  an ADR.
- Tests: zoom command posting, default layout in the render message,
  chooseLayout store/clear/re-render, unknown-name rejection, reset
  preserving the choice, and the refresh-keeps-positions regression —
  33 passing.
