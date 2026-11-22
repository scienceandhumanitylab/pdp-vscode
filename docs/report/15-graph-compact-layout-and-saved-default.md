# Step 15: graph compact layout, saved default, new tasks join in place

## What was done

User request: pack the graph's boxes closer and fill the sidebar better (narrow
and tall), let users save their manual arrangement as the default Reset returns
to, and add new tasks without re-laying out the whole graph. Plan-mode
decisions: choosing a layout drops the saved default; the default lives in
`workspaceState` (no new ADR, it extends ADR 0005's storage).

- **Compact tiered layouts** (`layoutOptions`, webview): breadthfirst runs with
  a collapsed `boundingBox`, `avoidOverlap` and `spacingFactor: 1`, so every
  step is the largest box side; `transform` rescales each axis to widest/tallest
  box plus `GAP_ACROSS` (12 px) / `GAP_DOWN` (40 px). The old default
  `spacingFactor` 1.75 and sidebar-sized box were what spread the graph.
  `maximal: true` pushes each task to the tier below its deepest upstream, so
  edges point down one tier where possible. `fit()` then fills the sidebar
  width, still capped by `maxZoom`.
- **Saved default**: `pdp.saveGraphLayout` ("PDP: Save Graph Layout as Default",
  `$(save)`, title bar `navigation@4`, palette). The host posts `saveDefault`;
  the webview cancels its pending debounced save and answers with its
  `positions` message flagged `asDefault`, so an untouched automatic layout or a
  just-made zoom is captured. Stored as `GraphLayout.saved` (`positions`,
  `viewport`). `resetLayout` restores it, else clears to the chosen automatic
  layout. `chooseLayout` drops it. A status-bar message confirms the save.
- **New tasks join in place**: the host now renders `preset` when _any_ task has
  a saved position (was: all). `placeNew` (webview) puts each unplaced task one
  tier past its placed upstream tasks, else one before its downstream ones,
  centred on them, else beside the last tier; then steps along the tier until it
  overlaps nothing. The result is persisted through the usual `positions`
  message. If a placed task lands outside the saved viewport, the view refits.
  Reset to a saved default uses the same path for tasks added since the save.
- Pre-existing breakage fixed: the tests looked up the extension as
  `scienceandhumanitylab.pdp`, but 0.0.2 renamed it `pdp-vscode`, so the
  activation tests failed on HEAD.

## Tests added

- `a saved default survives drags, reset restores it, and choosing a layout drops it`
  (host, stub memento): save-default round trip with a ghost id dropped; a later
  drag (with an unrequested `asDefault`) leaves `saved` untouched; reset renders
  the saved positions and viewport as preset; junk in a persisted default is
  dropped; `chooseLayout` clears it.
- `top-down packs siblings and tiers close, and a new task joins without moving the rest`
  (real webview): sibling spacing 40–100 px, tier spacing 30–100 px; adding
  `tail` under `leaf1` keeps all four existing positions, places `tail` directly
  below `leaf1`, and the placement survives the next refresh.
- Updated: a partly saved arrangement is now a preset render.

Red → green: the host test failed to compile (`saveDefault` missing); the layout
test failed on sibling spacing 136 px until `spacingFactor: 1`. `pnpm test`: 40
passing.

## Review findings and resolution

Fresh-context subagent review; no blocking issues. Fixed:

1. New tasks could land off-screen (fit ran before placement) — placement now
   runs first; with a saved viewport the view refits only if a new task falls
   outside it.
2. A chain of new tasks above existing ones started beside the graph —
   `placeNew` now picks pending tasks that touch the placed graph first.
3. Save with no view or no tasks did nothing silently — now an information
   message.
4. Any `asDefault` message was honoured — the host accepts it only after it
   asked (`defaultRequested`), covered by the test.
5. `Math.max` over all positions moved into the only branch that needs it;
   `spacing()` returns `unit` instead of re-measuring; `chooseLayout` comment
   updated; the layout test clears stored state first instead of relying on test
   order.

Accepted:

- Once a default is saved, Reset no longer reaches the automatic layout; Choose
  Layout does (and drops the default). This was the user's decision.
- In the force layout, new tasks are placed with the tier rules (top-down axes).
  Good enough for one task; Choose Layout re-runs force.
- The 700 ms wait for the debounced save in the end-to-end tests stays, as in
  step 12's test.

## Security checks

The `saved` arrangement is validated on read and write like the current one:
only task ids in the current status, finite coordinates, positive finite zoom;
junk is dropped. `asDefault` is honoured only when requested. No HTML is built
from data (canvas rendering), CSP and `localResourceRoots` are unchanged, no
processes spawned, no new dependencies.

## Accessibility

The new command has a title, a codicon, a title-bar button with that title as
its tooltip, and is in the palette. Feedback is a status-bar text message or an
information message. No colours changed; stale/fresh still carry the ✗/✓ text
marker.

## Deferred

- No separate "Clear saved default" command (Choose Layout covers it).
- Force layout spacing unchanged; cose's defaults were already compact and the
  spread came from `fit()`.
- Placement does not avoid edge crossings.
