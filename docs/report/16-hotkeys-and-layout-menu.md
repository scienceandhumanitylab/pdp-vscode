# Step 16: hotkeys, layout menu at the cursor, running-task display

## What was done

User request: the plan in `docs/0002-hotkeys.md`. Delivered sections A–E in five
commits (one per task, each test-first, reviewed by a fresh-context subagent
before approval). Section F (pdp `--progress`) is **blocked**: the user ruled
pdp-library changes out of scope for now, so section G (step 17) is blocked
behind it and only its PLAN.md entry exists. Step 17's gate in the plan requires
pdp ≥ 0.2.6.

- **A. Graph shortcuts** (`i`/`o`/`l`/`s`/`r`, commit `6227b1a`): the webview
  posts `{type:"focus"}` on window focus/blur; the provider coerces
  `message.focused === true` into the `pdp.graphFocused` context key and a
  `focused` field, cleared in `onDidDispose`. Keybindings fire while focus is
  inside the webview (workbench forwards keydown). Toolbar buttons carry
  `aria-keyshortcuts` and hinted titles/aria-labels. The A.5 keydown fallback
  was **not** shipped: it is only for hand-testing that shows keys are not
  forwarded, which we could not run — see Hand-testing.
- **B. Layout menu at the cursor** (`6f0d2e4`): the Layout button opens an
  in-webview ARIA menu (`role=menu`, `menuitemradio` items, built with
  `createElement`/`textContent`) at the click position — under the button for
  keyboard activation (`event.detail === 0`, a review fix — the initial diff
  would have clamped keyboard clicks to the viewport corner). Arrows wrap,
  Home/End, Enter/Space choose, Escape/Tab/blur/outside-pointerdown close, focus
  returns to the button, `#tip` hides while open. The host validates
  `chooseLayout` names through `validLayoutName`; `openLayoutMenu()` posts only
  when the view exists and is focused, and `chooseGraphLayout` falls back to the
  old QuickPick for the palette path.
- **C. Tasks view shortcuts** (`d6294aa`): `r`/`c`/`t` confirm then run (new
  `…Confirm` commands via a shared `confirmThen`, hidden from the palette), `s`
  opens the task's source file, `o` reveals its `output/` folder; `f`/`d` reuse
  their existing modals. Keys pass `{selected: true}`, which `taskFromArgOrPick`
  resolves from the tree selection only for that argument shape, so palette
  calls still prompt. `pdp.openTaskSrc` (0/1/many files) and
  `pdp.revealTaskOutput` both go through `withTask` → `taskFolder`, which
  validates the id; both also appear on the task context menu (`3_open@3`) and
  the graph node menu. Unplanned but necessary: `PdpTasksProvider.getParent` (VS
  Code requires it for `TreeView.reveal`, which the selection plumbing and its
  test use).
- **D. Cheat sheet** (`e9ae117`): `?` (`shift+/`) in either view runs
  `pdp.showShortcuts`; the `SHORTCUTS` table mirrors the shipped keybindings
  (cross-checked against `contributes.keybindings` in review), tasks entries
  dispatch with `{selected: true}`, and `Customize…` opens the keybindings
  editor filtered to `pdp.`. shortcut: the extension API cannot read user
  keybindings, so the list shows the defaults; Customize… shows the real ones.
- **E. Re-run last** (`efd6361`): `alt+p .` replays the last `runWithProgress`
  args/title (remote runs are not recorded); with nothing recorded it explains
  there is no run yet this session. Review verified every `runWithProgress`
  caller — no double `run` prefix, byte-identical replay.

Follow-up requests after step 16 (one commit each, same loop):

- **`j`/`k` + Tab focus** (`8a4566f`): the layout menu takes `j`/`k` alongside
  the arrows; Tab wraps through the five toolbar buttons (a small keydown
  handler moves focus at the ends so it never leaves the webview) and
  `#toolbar button:focus-visible` outlines on `--vscode-focusBorder` (the rule
  already existed from section A). Enter/Space stay native button activation.
  Not implementable, dropped: Escape returns focus to the editor (conflicts with
  the menu's Escape), and any sash-focus/view-resize command (VS Code exposes no
  view sizes to extensions; filed as an upstream gap, and the `initialSize`
  below is the only initial-proportion lever).
- **`alt+p t` + picker default** (`19a1e20`): `alt+p t` focuses the Tasks view.
  The task QuickPick now opens with the tree's context as its first (active)
  entry — a TaskItem's id, or the task owning a selected file row via a new
  `owningTaskId` helper (ids laundered through `taskFolderPath`, default affects
  ordering only, everything downstream still validates). Benefits every command
  that prompts.
- **Sidebar proportions** (`9be82f5`): `initialSize` 1/3 on tasks/graph,
  `visibility: "collapsed"` on remote — initial state only; the workbench
  remembers the user's own layout after that.

Hand-test feedback fixes (same loop):

- **Visible focus ring** (`d2933fb`): Tab-cycling the toolbar showed no
  highlight — `:focus-visible` heuristics don't hold inside a VS Code webview
  iframe, and a theme token without a fallback can void the declaration. The
  ring is now deterministic `:focus` with `var(--vscode-focusBorder, #007fd4)`;
  the layout menu's focus outline got the same fallback.
- **Save/reset confirmations** (`c458320`): `pdp.saveGraphLayout` and
  `pdp.resetGraphLayout` now announce on the status bar; reset says which target
  it restored (saved default or the chosen layout's label). Previously both were
  silent, which read as broken from the new `s`/`r` shortcuts.
- **Guaranteed Tab focus** (`f360279`): hand-testing still showed no mark while
  Tab-cycling even with the deterministic ring. A document-level keydown handler
  now routes Tab into the toolbar from anywhere in the webview (first on Tab,
  last on Shift+Tab; the in-toolbar wrap handler owns cycling once inside), and
  the focused button highlights like hover on top of the outline — focus lands
  deterministically AND is unmistakable, covering both remaining suspects (focus
  never entering the iframe's buttons, or the 1px outline being too subtle).
- **Stronger focus contrast** (`26085bd`): the user found the hover-style
  highlight too faint; the focused button now uses the primary button pair
  (`--vscode-button-background`/`-foreground`, which themes design to meet
  contrast) and a 2px `--vscode-focusBorder` ring.
- **Picker opens on the focused row** (`531c8e1`): arrowing to a task and
  pressing `r` showed a picker that ignored it. Probed in the test host:
  arrow-key focus never reaches `TreeView.selection`, and the API exposes no
  focused element, but `list.toggleSelection` adds the focused row to the
  selection (even single-select) and removes it on a second toggle.
  `focusedTasksRow()` toggles twice and diffs the snapshots, so the selection
  ends unchanged. `{ selected: true }` now always opens the picker with that
  row's task (or a file row's owning task) first. Review asked for the case
  where object identity matters (row X selected, focus on Y): added. The focus
  tests were flaky (a refresh re-renders the tree asynchronously and moves
  focus); a `settleTree()` wait after refresh and focus moves made them pass 3/3
  runs. shortcut: the toggle acts on the last-focused list; from a palette path
  that is not the tree, it toggles another list twice (net zero).

## Tests added

`src/test/graph.test.ts`: focus messages set/clear the context key and field
(strict coercion; dispose clears); chooseLayout stores `left-right` in the
memento and `constructor`/`42`/missing names change nothing; render lists the
three layouts; `openLayoutMenu` posts only when focused; the `toolbar` `layout`
action never reaches `pdp.graphChooseLayout`; menu markup/roles/CSS hooks
present.

`src/test/fixture.test.ts`: package.json carries every keybinding in A, C, D, E
verbatim; the tree selection backs `selected: true` (reveal `import`,
`pdp.revealTaskOutput` hits `import/output`); `openTaskSrc` with 0/1/2 files in
`fixtures/demo/import/src` (created and deleted in `finally`); confirm commands
run their target only on the modal verb; `showShortcuts "tasks"` lists tasks
keys only and dispatches with `{selected: true}`; `rerunLast` explains the empty
case and, after a real stubbed `pdp.runTask`, replays the same argv
(strengthened in review to prove the production recorder, not a hand-seeded
record).

`pnpm test`: 54 passing (compile + lint + suite). All stubs restored in
`finally`; `pnpm-lock.yaml` added to `.prettierignore` (review finding) to stop
prettier churning the lockfile.

## Review findings and resolution

Each task's diff went to a fresh-context reviewer; no blockers were found.

- Task A: CHANGELOG bullet added; `pnpm-lock.yaml` prettier churn ignored and
  reverted. Deferred (reviewer's note): if a future VS Code stops firing `blur`
  when the view is hidden, `pdp.graphFocused` could stick true —
  `onDidChangeVisibility` would harden it; not in the spec.
- Task B: keyboard-activated menu position (the `event.detail === 0` fix above)
  — applied.
- Task C: `assert.ok(ext)` before reading `packageJSON` in the keybinding test —
  applied. `getParent` element identity for nested-file reveal noted for
  hand-testing.
- Task D: no findings beyond optional test-loudness; skipped.
- Task E: test strengthened to record via production code — applied.

## Security checks

- Webview messages untrusted: `focus` coerced with `=== true`, `chooseLayout`
  names validated via `validLayoutName` (junk, non-string and missing names
  ignored, tested), unknown message types ignored.
- Menu and labels rendered with `createElement`/`textContent`, never
  `innerHTML`; CSP/nonce and `localResourceRoots` untouched.
- `openTaskSrc`/`revealTaskOutput` resolve paths only under `taskFolder(id)`
  (rejects `/`, `\`, `..`); no processes spawned.
- Spawning unchanged: argument arrays only.

## Accessibility checks

- Layout menu: `role=menu`, `menuitemradio` with `aria-checked`, roving focus
  starting on the checked item, wrap-around arrows, Home/End, Enter/Space,
  Escape/Tab/blur/outside-pointerdown close, focus returned to the Layout
  button; theme colours only (`--vscode-menu-*`, `--vscode-focusBorder`).
- Toolbar buttons: hinted titles/aria-labels plus `aria-keyshortcuts`.
- Tasks shortcuts are keyboard-only paths; every command stays reachable from
  the palette (the `…Confirm` ones deliberately hidden from the palette but
  bound to keys).
- WCAG contrast was **not** verified by machine or eye — the menu uses theme
  tokens, so it follows the user's theme; the hand-test below is still owed.

## Not done / deferred

- **Hand-testing in the development host (F5)**: every key in each view, after
  `alt+p g` / `alt+p p`; rebinding (e.g. zoom in to `=`); the layout menu by
  mouse and keyboard-only with focus return; menu contrast in Light+, Dark+ and
  both High Contrast themes; `pdp.graphFocused` false after focus moves to the
  editor (Developer: Inspect Context Keys). Not performed — needs a human at the
  dev host. The A.5 fallback decision (forwarded keys) therefore rests on the
  plan's VS Code source analysis, not observation.
- Section F (pdp `--progress`, version 0.2.6) and step 17 (section G): blocked
  on the user's pdp-library ruling.
