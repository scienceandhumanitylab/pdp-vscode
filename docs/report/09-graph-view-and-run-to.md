# Step 9: Graph view in the sidebar, Run To Here, labelled Clean Task

## What was done

- `src/graph.ts` renamed to `src/graphView.ts` (matching `tasksView.ts` /
  `remoteView.ts`). `PdpGraphPanel` (a `WebviewPanel` opened beside the
  editor) became `PdpGraphViewProvider`, a `WebviewViewProvider` registered
  for the new contributed view `pdp.graph` in the PDP sidebar container,
  below Tasks and above Remote & Processes. The graph is now always present
  in the sidebar instead of being opened by a command.
- The Mermaid definition switched from `flowchart LR` to `flowchart TD` —
  top-to-bottom, which fits the narrow sidebar and uses vertical space well.
- WebviewView lifecycle: VS Code disposes a webview view when hidden and
  calls `resolveWebviewView` again on re-show, so the provider stores the
  latest status, re-sets the HTML (new nonce) on every resolve, and pushes
  the stored status on the webview's `ready` message. `onDidDispose` nulls
  the view only if it is still the current one. `update()` is called from
  every refresh; when the view is hidden it only stores.
- Removed the `pdp.graph` command ("PDP: Show Graph") and the Tasks-title
  button that opened the panel. The graph is reached by opening the PDP
  container (or `pdp.graph.focus` from the palette). The header button was
  not re-pointed at `pdp.graph.focus` because auto-generated focus commands
  cannot carry an icon, and the view is a permanent sibling in the same
  container.
- New command `pdp.runTo` ("PDP: Run To Here") on task right-click (group
  `1_run@2`, between Run only and Run from): runs `pdp run --to <id>`,
  i.e. the task and everything upstream of it. This is the remedy for the
  reported problem: `pdp run <id> --only` refuses when an upstream task is
  stale ("Stale upstream outside the selection"), while `--to` includes the
  stale upstream, so it always runs.
- `pdp.cleanTask` added to the task context menu as a labelled entry (group
  `4_clean@1`) in addition to the existing inline trash icon, so a single
  task can be cleaned discoverably from right-click.
- Docs: guide updated (graph section, Tasks-title buttons, task menu list),
  CHANGELOG entries, CONTEXT.md "Graph view" term.

ADR-0004 still holds: the graph is a webview rendered with Mermaid shipped
inside the extension; only its docking (editor panel → sidebar view) and
direction changed.

## Tests added

- `mermaidDefinition` now asserted to be `flowchart TD` (was LR).
- End-to-end: `pdp.graph.focus` resolves the view in the test host, and the
  webview renders the graph with Mermaid under the CSP (`rendered` ack
  within 15 s).
- Fixture integration: `run clean --only` exits non-zero when `fetch` is
  stale; `run --to clean` then exits 0, runs exactly `fetch, clean`, and
  leaves `report` stale — proving `--to` includes stale upstream and stops
  at the target. Self-contained (cleans first) so it does not depend on the
  preceding test's state.

## Review findings and resolution

Review subagent (fresh context) verified compile/lint/typecheck and the
WebviewView lifecycle, `--to` semantics against `pdp/cli.py`, menu validity
and command count (28). Findings:

1. The new fixture test was order-dependent (only failed for `--only`
   because the previous test left tasks stale). Fixed: it now runs
   `pdp clean` first, like the other stateful test.
2. The guide still documented the removed "Show graph" command. Fixed, and
   this step report written.
3. The Tasks-title header button pointed at `pdp.graph.focus`, which cannot
   carry an icon — it would render as text. Resolved by removing the button:
   the Graph view is a permanent sibling view in the same container, so the
   button added nothing.
4. Nit (accepted): the e2e render test would pass even if `update()` were
   broken, since activation's own refresh renders the fixture graph. Kept as
   a resolve→ready→render smoke test; tightening it would need exposed view
   state for little gain.

## Security and accessibility checks

- Webview unchanged in substance: strict CSP with `crypto.randomBytes` nonce,
  `localResourceRoots` limited to `media/`, Mermaid `securityLevel: strict`,
  task ids escaped in the definition, node click mapping index-validated
  then path-validated (unchanged code path).
- `pdp run --to <id>` spawned with an argument array, never a shell string;
  `pdp.path` still untrusted-input-handled by `pdp.ts`.
- Accessibility: node state stays text-in-label ("stale"/"fresh") as well as
  colour; container keeps `role="img"` + aria-label; new menu entries are
  labelled commands reachable from the palette and keyboard; classDef
  contrast unchanged (≥ 13:1, verified in step 7).
- No new runtime or dev dependencies.

## Deferred

- A right-click context menu on graph nodes inside the webview (the
  task-level actions live in the Tasks view; the user confirmed the tree
  right-click was the ask).
- `--to`/`--from` are not offered in the `Run…` QuickPick flow.
