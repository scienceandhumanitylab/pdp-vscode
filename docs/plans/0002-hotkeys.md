# Plan: hotkeys, layout menu at the cursor, running-task display

Self-contained brief for an agent with no prior context. Read `AGENTS.md`
(working loop, security, accessibility, commit trailer) and `docs/plans/PLAN.md`
(architecture, steps 1–15) before starting. ADRs in `docs/adr/` still hold;
nothing here contradicts them.

## Background

- Repo: `~/repos/pdpd/pdp-vscode`, a VS Code extension for the `pdp` CLI
  (Python, repo `~/repos/pdpd/pdp`, published on PyPI as `pdp-helper`, currently
  0.2.5). The extension runs `pdp` as child processes (`src/pdp.ts` `spawnPdp`,
  argument arrays, never a shell).
- Sidebar container `pdp` with three views (`package.json` →
  `contributes.views.pdp`):
  - `pdp.tasks`: tree view, `PdpTasksProvider` in `src/tasksView.ts`, created
    with `vscode.window.createTreeView("pdp.tasks", …)` in `activate()`
    (`src/extension.ts`). Rows: a `pdp.yml` `FileItem`, then one `TaskItem` per
    task (`contextValue = "task"`, `item.task` is the `TaskStatus`,
    clicking/Enter runs `pdp.openTask`), whose children are the task folder's
    files.
  - `pdp.graph`: webview view, `PdpGraphViewProvider` in `src/graphView.ts`.
    Cytoscape graph; the whole webview HTML/JS is the template string in
    `html()`. An in-webview toolbar (`#toolbar`, buttons with `data-action` =
    `zoomIn|zoomOut|layout|save|reset`) posts `{ type: "toolbar", action }`; the
    host maps it in `toolbarAction()`. Nodes have generated ids `n0, n1, …`
    (index into `status.tasks`) so hostile task ids cannot forge element ids.
  - `pdp.remote`: remote status and background processes.
- Existing commands used below (all registered in `registerCommands()` in
  `src/extension.ts`): `pdp.runTask`, `pdp.runTo` (`pdp run --to <id>`),
  `pdp.cleanTask`, `pdp.freshenTask` (has its own modal), `pdp.deleteTask` (has
  its own modal), `pdp.openTask`, `pdp.revealTask`, `pdp.graphZoomIn`,
  `pdp.graphZoomOut`, `pdp.graphChooseLayout` (QuickPick,
  `chooseGraphLayout()`), `pdp.saveGraphLayout`, `pdp.resetGraphLayout`. Task
  commands go through `withTask(arg, action)` → `taskFromArgOrPick(arg)`, which
  accepts a `TaskItem`, a task id string (checked against `TASK_ID_PATTERN` and
  `lastStatus`), or nothing (shows a task QuickPick).
- Existing keybindings (`contributes.keybindings`): `alt+p p/g/r` focus the
  three views, `alt+p space` runs all; all `when` include `!terminalFocus`.
- Runs: `runWithProgress(args, title)` → `commandWithProgress` →
  `spawnWithProgress` (a cancellable progress notification; cancel sends SIGINT
  to the process group) → `refresh()` → `notifyRunResult`.
- Status bar: one item, `statusBar` in `src/extension.ts`, text
  `$(play) PDP: N stale`, click runs all; set in `doRefresh()`.
- Modal confirmation pattern to copy: `freshenTask()` in `src/extension.ts`
  (`showWarningMessage(msg, { modal: true, detail }, "Freshen")`).
- Tests: `pnpm test` (compile, lint, `@vscode/test-cli`). Graph tests in
  `src/test/graph.test.ts` use a stub `WebviewView` (see the test "the in-graph
  toolbar replaces the title-bar buttons…"): capture the `onDidReceiveMessage`
  listener to `send()` messages in, record `postMessage` calls out. Fixture
  tests in `src/test/fixture.test.ts` run against the real `pdp` on
  `src/test/fixtures/demo` (tasks `import`, `clean`, `explore`, `filter`,
  `model`, `report`; every `src/` is empty).

## Facts this plan relies on (verified in VS Code source)

- A webview forwards every keydown to the workbench (`handleInnerKeydown` →
  `forwardKeyEvent('did-keydown', e)` in
  `src/vs/workbench/contrib/webview/browser/pre/index.html`), so
  `contributes.keybindings` fire while focus is inside the graph.
- `focusedView == pdp.graph` is **not** reliable: `WebviewViewPane` hosts the
  iframe in an overlay at the document root, outside the pane's DOM focus
  tracking. The graph therefore sets its own context key.
- `focusedView == pdp.tasks` works for tree views. Workbench lists skip
  type-to-navigate for keys bound to a keybinding, so single letters bound here
  win over type-ahead (other letters still jump).
- Keybinding `when` clauses cannot see `viewItem`, and a keybinding does not
  reliably pass the focused tree element. Commands read the tree selection
  themselves (below).

## Delivery

Three units of work, each through the full `AGENTS.md` loop (test first,
prettier, `pnpm test`, review subagent, report, commit):

1. **Step 16 (extension):** sections A–E. Report
   `docs/report/16-hotkeys-and-layout-menu.md`.
2. **pdp library:** section F, in `~/repos/pdpd/pdp`, following that repo's
   conventions, own commit and CHANGELOG entry, version bump to 0.2.6.
3. **Step 17 (extension):** section G, gated on pdp ≥ 0.2.6. Report
   `docs/report/17-running-task-display.md`.

Add steps 16 and 17 to `docs/plans/PLAN.md` "Steps" with a pointer to this file.

---

## A. Graph shortcuts

| Key | Command                 | `when`                               |
| --- | ----------------------- | ------------------------------------ |
| `i` | `pdp.graphZoomIn`       | `pdp.graphFocused && !terminalFocus` |
| `o` | `pdp.graphZoomOut`      | `pdp.graphFocused && !terminalFocus` |
| `l` | `pdp.graphChooseLayout` | `pdp.graphFocused && !terminalFocus` |
| `s` | `pdp.saveGraphLayout`   | `pdp.graphFocused && !terminalFocus` |
| `r` | `pdp.resetGraphLayout`  | `pdp.graphFocused && !terminalFocus` |

Implementation:

1. **Webview** (`html()` script): on `window` `focus` post
   `{ type: "focus", focused: true }`, on `blur` post
   `{ type: "focus", focused: false }`.
2. **Provider** (`resolveWebviewView` message handler): on `focus`, run
   `vscode.commands.executeCommand("setContext", "pdp.graphFocused", message.focused === true)`
   and store it in a `focused` field (read by section B). In
   `view.onDidDispose`, set the context key and field to `false`.
3. **`package.json`**: the five keybindings above.
4. **Toolbar hints**: titles and `aria-label`s gain the key — `Zoom in (I)`,
   `Zoom out (O)`, `Choose layout (L)`, `Save layout as default (S)`,
   `Reset layout (R)` — and each button gets `aria-keyshortcuts="i"` etc. They
   show defaults, not user rebindings.
5. **Fallback, only if hand-testing shows keys are not forwarded:** add a
   `keydown` listener in the webview that ignores events with ctrl/alt/meta or
   `repeat`, maps `i o l s r` to the toolbar action names and posts
   `{ type: "toolbar", action }`. Record which path shipped in the report.

## B. Layout menu at the cursor

The VS Code API cannot position a QuickPick, so the menu is HTML inside the
webview.

Host (`src/graphView.ts`):

- `push()` adds to the `render` message:
  `layouts: GRAPH_LAYOUTS.map(({ label, description, name }) => …)` and the
  current `layout` (already sent).
- New inbound message `{ type: "chooseLayout", name }` →
  `void this.chooseLayout(name)` (already validates with `validLayoutName`;
  anything else is ignored).
- New method `openLayoutMenu(): boolean` posts `{ type: "layoutMenu" }` and
  returns `true` if `this.view` exists and `this.focused` is true, else `false`.
- `toolbarAction`: remove the `layout` entry (the webview handles that button
  itself).
- `chooseGraphLayout()` in `src/extension.ts`: if `graphView?.openLayoutMenu()`
  returns true, stop; otherwise show the existing QuickPick (palette path).

Webview:

- Markup: `<div id="layoutMenu" role="menu" aria-label="Graph layout" hidden>`
  holding one
  `<div role="menuitemradio" tabindex="-1" aria-checked="true|false">` per
  layout, text `✓ Label — description` for the current one and
  `   Label — description` otherwise. Build with `createElement` + `textContent`
  (never `innerHTML`).
- Open on Layout button `click` at `event.clientX/clientY`; on `layoutMenu`
  message, open under the Layout button (`getBoundingClientRect()`,
  bottom-left). Clamp so the menu stays inside `window.innerWidth/innerHeight`.
- On open, focus the checked item. Keys: ArrowDown/ArrowUp (wrap), Home/End,
  Enter/Space choose, Escape closes. Tab, `blur` of the menu, or a `pointerdown`
  outside close. Closing returns focus to the Layout button.
- Choose → post `{ type: "chooseLayout", name }` and close.
- `stopPropagation` on handled keys is not needed for VS Code: the arrow and
  Enter keys have no workbench binding under `pdp.graphFocused`.
- CSS (add to the `<style>` block), theme colours only:
  `background: var(--vscode-menu-background)`,
  `color: var(--vscode-menu-foreground)`,
  `border: 1px solid var(--vscode-menu-border, var(--vscode-contrastBorder, transparent))`,
  focused item `background: var(--vscode-menu-selectionBackground)`,
  `color: var(--vscode-menu-selectionForeground)`,
  `outline: 1px solid var(--vscode-focusBorder)`;
  `position: absolute; z-index: 20`. Hide `#tip` while the menu is open.

## C. Tasks view shortcuts

| Key     | Command                      | Behaviour                                 |
| ------- | ---------------------------- | ----------------------------------------- |
| `Enter` | (tree item command)          | opens `task.yml` — unchanged, add nothing |
| `r`     | `pdp.runTaskConfirm` (new)   | modal → `pdp.runTask`                     |
| `c`     | `pdp.cleanTaskConfirm` (new) | modal → `pdp.cleanTask`                   |
| `t`     | `pdp.openTask`               | open `task.yml` (was run-to; see step 18) |
| `T`     | `pdp.createTaskYml`          | open `task.yml`, or modal → create stub   |
| `f`     | `pdp.freshenTask`            | existing modal                            |
| `d`     | `pdp.deleteTask`             | existing modal                            |
| `s`     | `pdp.openTaskSrc` (new)      | open the task's `src/` file (see below)   |

Every one: `"when": "focusedView == pdp.tasks && !terminalFocus"` and
`"args": { "selected": true }`.

Selection plumbing (`src/extension.ts`):

- Keep the tree view: `const tasksTree = vscode.window.createTreeView(…)` at
  module level (assigned in `activate`, still pushed to
  `context.subscriptions`).
- In `taskFromArgOrPick`: if `arg` is an object with `selected === true`, act
  directly on the focused row's task (a `TaskItem`, or the task owning a file
  row) with no picker; only a row with no task (`pdp.yml`) falls through to the
  QuickPick. Other argument shapes keep prompting, with the selected row's task
  leading the picker.

New commands (register in `registerCommands()`, add to `contributes.commands`;
hide the three `…Confirm` commands from the palette with
`contributes.menus.commandPalette` entries `"when": "false"`):

- `confirmThen(arg, verb, detail, command)`:
  `withTask(arg, async (id) => { const choice = await showWarningMessage(`${verb}
  "${id}"?`, { modal: true, detail }, verb); if (choice === verb) await executeCommand(command, id); })`.
  - `pdp.runTaskConfirm`: verb `Run`, detail
    `Runs pdp run <id>: the task and any stale upstream tasks.`, command
    `pdp.runTask`.
  - `pdp.cleanTaskConfirm`: verb `Clean`, detail
    `Runs pdp clean <id>, which removes the task's outputs.`, command
    `pdp.cleanTask`.
  - Confirmation applies to the keyboard path only; inline buttons and
    context-menu entries keep calling the unconfirmed commands.
- `pdp.openTaskSrc` ("PDP: Open Task Source File"): `withTask` →
  `taskFolder(id)` (validates the id) → `src = path.join(folder, "src")` →
  `vscode.workspace.findFiles(new vscode.RelativePattern(src, "**/*"))`.
  - 0 files:
    `showInformationMessage("PDP: No files in <id>/src", "Reveal Folder")`; the
    button runs `pdp.revealTask` with `id`.
  - 1 file: `showTextDocument(uri)`.
  - more: `showQuickPick` of `path.relative(src, uri.fsPath)` labels, sorted
    with `localeCompare`, placeholder `Source file for <id>`; open the pick.
  - Also add it to the task context menu (`view/item/context`,
    `"when": "view == pdp.tasks && viewItem == task"`, group `3_open@3`) and to
    `TASK_MENU_ACTIONS` (graph right-click QuickPick) after "Open task.yml" as
    `Open source file`.

`r` and `s` mean different things in the graph (reset/save) and the tasks tree
(run/source). Accepted; the contexts never overlap.

## D. Shortcut cheat sheet (`?`)

- Command `pdp.showShortcuts` ("PDP: Keyboard Shortcuts").
- Keybindings: `shift+/` with `"args": "graph"` when
  `pdp.graphFocused && !terminalFocus`, and with `"args": "tasks"` when
  `focusedView == pdp.tasks && !terminalFocus`.
- A const table in `src/extension.ts`:
  `SHORTCUTS: Record<"graph" | "tasks", { key: string; label: string; command: string }[]>`
  mirroring sections A and C (tasks entries also list `Enter  Open task.yml` →
  `pdp.openTask`).
- Handler: arg `"graph"`/`"tasks"` shows that list; any other arg (palette)
  shows both with `QuickPickItemKind.Separator` headings "Graph" and "Tasks".
  Item: `label: key`, `description: label`. A last item `Customize…` runs
  `workbench.action.openGlobalKeybindings` with `"pdp."`.
- Choosing an entry runs its command; tasks entries pass `{ selected: true }` so
  they act on the selection.
- shortcut: the extension API cannot read user keybindings, so the list shows
  the defaults; Customize… shows the real ones.

## E. Re-run the last run (`alt+p .`)

- Command `pdp.rerunLast` ("PDP: Re-run Last Run"), keybinding `alt+p .`,
  `when: pdp.hasProject && !terminalFocus`.
- Module-level `let lastRun: { args: string[]; title: string } | null`.
  `runWithProgress` sets it before running. Remote runs do not go through
  `runWithProgress` and are not recorded.
- Handler: `lastRun` null →
  `showInformationMessage("PDP: No run yet this session")`; else
  `runWithProgress(lastRun.args, lastRun.title)`. No confirmation (a deliberate
  two-key chord). A task deleted since then makes pdp fail and the usual error
  shows.

## Step 16 tests (write first)

`src/test/graph.test.ts` (stub webview):

- `{ type: "focus", focused: true }` then `false` set `pdp.graphFocused` to
  true/false (stub `vscode.commands.executeCommand` or read the provider's
  `focused` field); disposing the view sets it false.
- `{ type: "chooseLayout", name: "left-right" }` stores `layout: "left-right"`
  in the memento under `positionsKey(root)`; `"constructor"`, `42` and a missing
  `name` change nothing.
- The `render` message includes `layouts` with the three names.
- `openLayoutMenu()` posts `{ type: "layoutMenu" }` and returns true when
  focused; returns false and posts nothing when not focused.
- The HTML has `aria-keyshortcuts` on all five toolbar buttons and the `toolbar`
  action `layout` no longer runs `pdp.graphChooseLayout`.

`src/test/fixture.test.ts`:

- `package.json` contains every keybinding in A, C, D, E with the exact
  `command`, `key`, `when` (and `args` where listed).
- `taskFromArgOrPick` with `{ selected: true }`: tested through a command, e.g.
  reveal `tasksTree` selection via `tasksTree.reveal(item, { select: true })` on
  the `import` task, then `pdp.runTaskConfirm` with `{ selected: true }` names
  that task in its modal, with no picker.
- `pdp.openTaskSrc` on `import`: create files in `fixtures/demo/import/src/`
  inside the test and delete them in `finally`. One file → active editor is that
  file. Two files → QuickPick shown (stub `vscode.window.showQuickPick` to
  return the second; assert it opened). None → information message (stub
  `showInformationMessage`).
- Confirm commands: stub `showWarningMessage` to return `undefined`; assert the
  target command did not run (stub/spy on `executeCommand` for `pdp.runTask`).
  Return the verb; assert it ran with the id.
- `pdp.rerunLast` with nothing recorded shows the message; after a stubbed run,
  replays the same args (spy on the spawn or expose `lastRun` for tests the way
  `graphView.lastAck` is exposed).
- `pdp.showShortcuts` with `"tasks"` lists the tasks keys only.

Restore every stub in `finally`/`teardown`.

Hand-test in the development host (F5, fixture folder open) and record in the
report:

- Each key in each view, including after `alt+p g` / `alt+p p`.
- Rebind one key (e.g. graph zoom in to `=`) and confirm it works.
- Layout menu: mouse open/choose; keyboard only (`l`, arrows, Enter, Escape)
  with focus returning to the button.
- Menu contrast (WCAG 2.2 AA: 4.5:1 text, 3:1 focus outline) in Light+, Dark+,
  and High Contrast (dark and light).
- `pdp.graphFocused` false after focus moves to the editor (Developer: Inspect
  Context Keys).

---

## F. pdp library: `pdp run --progress`

Repo `~/repos/pdpd/pdp`. Today `pdp run` prints only the final report
(`_print_report` in `pdp/cli.py`); nothing per task while running.

Behaviour:

- New option on `run` in `pdp/cli.py`: `--progress` (bool, help "Print
  machine-readable progress lines to stderr."). When set, the CLI sets
  `os.environ["PDP_PROGRESS"] = "1"` before running; the env var reaches Dagster
  step processes (they inherit the environment, see `_environ` in
  `pdp/dagster_run.py`).
- A helper in `pdp/utils.py`: `emit_progress(event: dict) -> None` writes
  `"pdp-progress " + json.dumps(event) + "\n"` to `sys.stderr` and flushes, only
  when `os.environ.get("PDP_PROGRESS") == "1"`. Plain write, not rich.
- Events:
  - `{"event": "plan", "tasks": [ordered ids]}` once, before the first task.
  - `{"event": "start", "task": id}` right before a task's entrypoint runs.
  - `{"event": "end", "task": id, "result": r}`, `r` in
    `ran | failed | fresh | skipped | no_entrypoint`. Tasks that never start
    (fresh, skipped, no entrypoint) get only an `end`.
- pdp runner: in `PDP._run_many` (`pdp/pdp.py`), emit `plan` with `order`, and
  `start`/`end` at each branch of the loop.
- Dagster runner: `plan` from `run_dagster` (selection in `ordered_tasks()`
  order); `start`/`end` inside `_asset` in `pdp/dagster_assets.py` (start before
  `pipes.run`, end `ran` after it, `fresh` on the early return, `failed` around
  a raised failure via `try/except: emit; raise`). Upstream-failed skips in
  Dagster never call `_asset`; emit their `end` `skipped` from `run_dagster`
  after the run, from the report's `skipped` list.
- Must verify: Dagster's compute-log capture may swallow step stderr. If lines
  do not reach the terminal in `pdp run --runner dagster --progress`, write with
  `os.write(2, line.encode())` instead of `sys.stderr`; if they still do not
  arrive, ship the pdp runner only and document Dagster as not emitting progress
  (the extension handles a missing stream, section G).
- Tests in `tests/test_cli.py` (pdp runner, and Dagster if the suite already
  runs it): lines parse as JSON after the prefix; `plan` first; one `end` per
  selected task; `start` precedes `end` for ran/failed; results match the final
  report; without `--progress` no `pdp-progress` lines appear.
- README "Additional commands": one line on `--progress`. CHANGELOG entry. Bump
  `version` in `pyproject.toml` to `0.2.6`.

## G. Step 17: show the running task (extension)

Gate: `const PROGRESS_PDP_VERSION = [0, 2, 6]` in `src/pdp.ts`. `checkVersion()`
stores the found version; a helper `supportsProgress(): boolean` uses
`versionAtLeast`.

Parsing (`src/pdp.ts`, pure, exported for tests):

- `parseProgressLine(line: string, known: Set<string>): ProgressEvent | undefined`
  — requires the `pdp-progress ` prefix, `JSON.parse` in try/catch, accepts only
  the three event shapes, string ids present in `known` (from `lastStatus`), and
  the five result values. Anything else → `undefined`.
- `spawnPdp` already takes `onOutput(chunk)`; add a line buffer in the caller
  (split on `\n`, keep the trailing partial) rather than changing `spawnPdp`.
  Progress lines still go to the Output channel (harmless) and are already
  ignored by `parseReport`, which looks for its own prefixes — confirm with a
  test.

Run state (`src/runState.ts`, new, pure):

- `interface RunState { plan: string[]; running: string | null; done: Set<string> }`
  and `reduce(state, event)`: `plan` sets plan, clears the rest; `start` sets
  running; `end` adds to done and clears running if it matches. `queued(state)`
  = plan minus done minus running.
- One tracked run at a time; a new run replaces the state. shortcut: concurrent
  runs show only the latest; track per run if users start several.

Wiring (`src/extension.ts`):

- `runWithProgress` adds `--progress` to the args when `supportsProgress()`, and
  passes a line handler that reduces events into a module-level `runState` and
  calls `showRunState()`. Each `end` also calls `refresh()` (debounced by its
  existing coalescing) so finished tasks turn fresh live. On exit (`finally`),
  clear `runState` and `showRunState()`.
- Store a `cancelCurrentRun: (() => void) | null` set in `spawnWithProgress`
  (sets `cancelled = true` and SIGINTs the child, same as the notification's
  Cancel); cleared on exit.
- New command `pdp.cancelRun` ("PDP: Cancel Run") calls it; hidden from the
  palette when no run is active via a context key `pdp.running`.

Display:

- **Status bar** (`showRunState()`): while a run is active, text
  `$(sync~spin) PDP: <running id> (<done+1>/<plan length>)`, tooltip
  `Running <id> — click to cancel`, `command = "pdp.cancelRun"`,
  `name = "PDP run"`. Between tasks (running null) show
  `$(sync~spin) PDP: running (<done>/<plan>)`. With an old pdp or before the
  `plan` event: `$(sync~spin) PDP: running…`. On exit restore the stale-count
  text and `pdp.runAll` command (call the existing `doRefresh` path, which sets
  them).
- **Tasks view** (`src/tasksView.ts`): `PdpTasksProvider.setRunState(state)`
  stores it and fires the change event; `TaskItem` takes an optional
  `run: "running" | "queued" | undefined`. Running: icon
  `new vscode.ThemeIcon("sync~spin")`, description starts with `running`;
  queued: icon `ThemeIcon("clock")`, description starts with `queued`; tooltip
  first line uses the same word. Text and icon, not colour alone.
- **Graph** (`src/graphView.ts`):
  - `graphElements(status, positions, run?)` and `nodeLabels(status, run?)` take
    the run state. Running node: label `${id} ▶`, classes `running` plus
    stale/fresh; hover `${id} (running)`. Queued node: label unchanged, class
    `queued`, hover `${id} (queued)`.
  - `PdpGraphViewProvider.setRunState(state)` stores it and calls `push()`. A
    re-render keeps positions and viewport (the existing preset path), so
    nothing moves; the webview re-measures labels as it already does.
  - Webview styles: read
    `getComputedStyle(document.documentElement).getPropertyValue("--vscode-focusBorder").trim()`
    once per render (fallback `#007fd4`) and add
    `node.running { border-width: 3, border-style: "dashed", border-color: focus }`
    and `node.queued { border-width: 2, border-style: "dotted" }`.
  - Update the ADR 0005 marker note in the step report: `▶` joins `✗`/`✓` as a
    text marker.

Step 17 tests (write first):

- `parseProgressLine`: valid plan/start/end; missing prefix; bad JSON; unknown
  event; unknown result; id not in `known`; non-string id.
- `reduce`/`queued`: a plan → start a → end a → start b sequence.
- `parseReport` ignores `pdp-progress` lines.
- `graphElements` with a run state: running node label and classes, queued
  class; ids still `n<i>`; `nodeLabels` hover words.
- `TaskItem` with `run` set: icon id and description.
- Status bar text for: running with plan, between tasks, old pdp.
- Fixture e2e (requires pdp ≥ 0.2.6 installed; skip with a clear message
  otherwise): `pdp.runTask` on `report` with stubbed modals produces a `plan`
  then a `start`/`end` per task, in order.

Hand-test: run all in the fixture and watch the status bar, tree and graph;
cancel from the status bar; repeat with `pdp.path` pointing at pdp 0.2.5 (status
bar shows `running…`, no per-task marks); contrast of the dashed and dotted
borders against both node colours in light, dark and high-contrast themes (3:1
for UI components).

## H. Step 18: Makefile and source keys, run/clean all

Delivered; see `docs/report/18-fixture-src-and-task-hotkeys.md`.

| Key | Command                  | Behaviour                                            |
| --- | ------------------------ | ---------------------------------------------------- |
| `m` | `pdp.openTaskMakefile`   | open `<task>/Makefile`, or explain its absence       |
| `M` | `pdp.createTaskMakefile` | open the Makefile, or confirm-then-create the stub   |
| `S` | `pdp.createTaskSrc`      | open the src files, or confirm-then-create `main.sh` |
| `R` | `pdp.runAllConfirm`      | modal → `pdp.runAll` (`pdp run`)                     |
| `C` | `pdp.cleanAllConfirm`    | modal → `pdp.cleanAll` (`pdp clean`)                 |

- Task-scoped keys (`m`, `M`, `S`) carry `{ selected: true }` like the others;
  `R`/`C` act on the project and take no argument.
- Created files match the fixture convention: a Makefile whose `<id>` target
  runs `bash src/main.sh`, and a `main.sh` that creates `output/` and touches
  `done.txt`. The id is `TASK_ID_PATTERN`-validated before it becomes a Makefile
  target.
- The fixture project moved the same way: every task's Makefile only delegates,
  the touch lives in `src/main.sh`, and `model` sleeps 3 s first so a run takes
  a visible moment.

## I. Step 19: graph toolbar arrows and j/k

Delivered in the "Sidebar shortcuts" commit; the stale test assertion was
repaired later. Left/Right (and `j`/`k`; `l` is the layout key, so the vim pair
is j/k, not h/l) move between the graph toolbar buttons the way `Tab` does,
wrapping, from anywhere in the webview; the open layout menu keeps its own
ArrowUp/Down + j/k keys.

## Security checklist (both steps; record in each report)

- Webview messages are untrusted: `focus` coerced with `=== true`,
  `chooseLayout` names validated, unknown message types ignored.
- Menu and labels rendered with `textContent` / Cytoscape data, never
  `innerHTML`.
- `openTaskSrc` resolves paths only under `taskFolder(id)`, which validates the
  id; no processes spawned.
- pdp progress lines are untrusted: strict parse, ids checked against the latest
  status, nodes addressed by generated `n<i>` ids.
- `--progress` is a fixed argv word; spawning stays argument-array.
- No new runtime dependencies.

## Out of scope

- Throttling key-repeat zoom (keybindings repeat; acceptable).
- Tooltips/cheat sheet showing user rebindings.
- Progress for remote runs (`pdp remote run`).
- Graph node keyboard navigation, tree/graph selection sync, graph `f` (fit) and
  `0` (100% zoom): candidate follow-ups.
