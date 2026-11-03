# pdp-vscode plan

A VS Code extension that exposes everything the `pdp` CLI does through a
sidebar, buttons and notifications, so users never need a terminal.

## Decisions

- **Data comes from pdp itself.** Add `--json` to `pdp status` and
  `pdp remote status`. The extension never reimplements staleness or parses
  human-readable output for state.
- **No terminal.** Commands run as child processes. Output goes to a hidden
  "PDP" Output channel; results surface as notifications.
- **One project per workspace.** `pdp.yml` at the workspace root.
- **Graph** is a webview rendered with Mermaid, shipped inside the extension.
- **No bundler, no runtime npm deps** other than Mermaid's single dist file.

## Architecture

```
src/
  extension.ts   activate: register views, commands, watcher, status bar
  pdp.ts         resolve binary, exec/spawn pdp, parse JSON + run report
  tasksView.ts   TreeDataProvider for tasks
  remoteView.ts  TreeDataProvider for remote status + background processes
  graphView.ts   Mermaid webview view (Graph, in the PDP sidebar)
media/
  mermaid.min.js copied from node_modules at compile time
```

### Talking to pdp (`pdp.ts`)

- Binary: setting `pdp.path` (default `pdp`), run with `cwd` = workspace root.
- `status()`: `pdp status --json` → `{project, tasks: [...]}`.
- `remoteStatus()`: `pdp remote status --json`.
- `run(args)`: spawn, pipe stdout/stderr to the Output channel, resolve with
  exit code and the parsed report. The report is the trailing lines
  `_print_report` prints (`Ran:`, `Current:`, `Failed:`, `No entrypoint
(failed):`, `Skipped (upstream failed):`, `Ran but wrote nothing to
output/:`).
- Cancel: send SIGINT (pdp and Dagster shut down cleanly on it).
- Env: set `COLUMNS=200` so rich does not wrap lines we parse.
- Version check on activate: `pdp --version` must be ≥ the release that adds
  `--json`; otherwise show "Upgrade pdp" with the `uv tool upgrade pdp` hint.

### Commands

Every command is in the palette (`PDP: ...`) and on a button where it fits.

| Command                       | pdp call                                                               | Where                          |
| ----------------------------- | ---------------------------------------------------------------------- | ------------------------------ |
| Init project                  | `pdp init --name <input box>`                                          | welcome view                   |
| Create task                   | `pdp create <input box>`                                               | Tasks title                    |
| Scaffold                      | `pdp scaffold`                                                         | Tasks title `...`              |
| Validate                      | `pdp validate`                                                         | Tasks title `...`              |
| Refresh                       | `pdp status --json`                                                    | Tasks title                    |
| Run all (stale)               | `pdp run`                                                              | Tasks title, status bar        |
| Run…                          | `pdp run <ids> [--only] [--force] [--slurm] [--runner]` via QuickPicks | palette                        |
| Run task                      | `pdp run <id>`                                                         | task inline                    |
| Run only                      | `pdp run <id> --only`                                                  | task context                   |
| Run to here                   | `pdp run --to <id>`                                                    | task context                   |
| Run from here                 | `pdp run --from <id>`                                                  | task context                   |
| Force run                     | `pdp run <id> --force`                                                 | task context                   |
| Run on Slurm                  | `pdp run <id> --slurm`                                                 | task context                   |
| Clean task / all              | `pdp clean [<id>]`                                                     | task inline, Tasks title `...` |
| Delete task                   | `pdp delete <id>`                                                      | task context                   |
| Open task.yml / reveal folder | n/a                                                                    | task click / context           |
| Start Dagster (local / Slurm) | `pdp dagster dev [--slurm] -p <port>`                                  | Remote/Processes view          |
| Remote start                  | `pdp remote start`                                                     | Remote view                    |
| Remote run (all / task)       | `pdp remote run [<id>]`                                                | Remote view, task context      |
| Remote push / pull / stop     | `pdp remote push                                                       | pull                           | stop` | Remote view |
| Remote status                 | `pdp remote status --json`                                             | Remote view refresh            |

### Sidebar

Own activity bar container `pdp`, shown when `workspaceContains:pdp.yml`.

- **Tasks view**: topological order. Each task shows a "stale" or "fresh"
  label plus a distinct icon per state (theme colours, not colour alone);
  the task description follows the label. Children: `depends on`,
  `entrypoint`, `slurm` flags. Click opens `task.yml`.
- **Graph view**: the task DAG as a Mermaid flowchart; see "Graph" below.
- **Remote view**: rows from `remote status --json` (host, project pushed,
  session, last run, Dagster port, Slurm jobs). Manual refresh only (SSH).
  Also lists background processes the extension owns (local Dagster,
  remote tunnel) with Open UI / Stop buttons.
- **Welcome view** when no `pdp.yml`: "Init project" button.
- **Status bar**: `PDP: N stale`; click runs all.

### Refresh

`FileSystemWatcher` on `**/{input,src,output,hand}/**` and `**/*.yml`,
debounced 500 ms, plus after every finished command. One status call in
flight at a time.

### Long-running processes

`pdp dagster dev` and `pdp remote start` are spawned and tracked in a map.
Detect readiness by watching output for the UI URL, then offer Open UI
(Simple Browser or external). Stop = SIGINT. All children are killed in
`deactivate()`. Note: stopping the remote tunnel leaves the cluster session
running (by design in pdp); `Remote stop` ends it.

### Graph

Sidebar webview view (`pdp.graph`, below Tasks). Mermaid `flowchart TD` built
from `depends_on`; node class `stale`/`fresh`, and each node's text includes
a "stale" or "fresh" label. Click a node → `postMessage` → open its
`task.yml`. Re-render on every refresh while visible; the provider stores the
latest status while the view is hidden. CSP: only `webview.cspSource` scripts
plus a nonce. `media/mermaid.min.js` is copied from
`node_modules/mermaid/dist/` by the `compile` script and must not be listed
in `.vscodeignore`.

## Steps

### 1. pdp library: `pdp status --json`

In `pdp/pdp/cli.py`, add a `--json` option to `status`:

```json
{
  "project": "my-project",
  "tasks": [
    {
      "id": "clean",
      "stale": true,
      "depends_on": ["import"],
      "description": "",
      "entrypoint": "make",
      "slurm": { "mem": "16G" }
    }
  ]
}
```

- Tasks in the same topological order as plain `status`.
- Print with `json.dumps` and plain `print`, not rich (no markup, no wrap).
- `slurm` is `dict(task.task_config.slurm or {})`.
- Errors keep the existing behavior: message on stderr, exit 1.
- Test in `tests/test_cli.py` next to the existing status tests: parses as
  JSON, order, stale flag, depends_on.
- README "Additional commands": one line on `--json`.

### 2. pdp library: `pdp remote status --json`

Same fields the text output shows:

```json
{
  "host": "...",
  "path": "...",
  "port": "3002",
  "version": "...",
  "pushed": true,
  "session": { "name": "pdp-x", "running": false },
  "run": {
    "running": false,
    "last": {
      "finished": "...",
      "ran": [],
      "failed": [],
      "no_entrypoint": [],
      "exit_code": 0
    }
  },
  "dagster_listening": false,
  "jobs": ["123"]
}
```

`jobs` is `null` if `squeue` failed. Unreachable host keeps the current
error + exit 1. Test with the existing remote mocks in `tests/test_remote.py`
/ `tests/test_cli.py`.

### 3. pdp release

Bump `version` in `pyproject.toml`, CHANGELOG entry, release. The extension's
minimum pdp version is this release.

### 4. Extension scaffold cleanup

- Remove hello world command and `treeDataProvider.ts`.
- `package.json`: real `displayName`/`description`, `activationEvents`
  (`workspaceContains:pdp.yml`), `viewsContainers`, `views`, `viewsWelcome`,
  `commands`, `menus` (`view/title`, `view/item/context` with
  `viewItem == task`), `configuration` (`pdp.path`, `pdp.dagsterPort`).
- Codicons for icons (`$(play)`, `$(trash)`, `$(type-hierarchy)`), no image
  assets.

### 5. `pdp.ts` + Tasks view + status bar + watcher

Phase-1 commands: refresh, run variants, clean, validate, create, init,
scaffold, open task.yml.

### 6. Remote view + Dagster + remote commands

### 7. Graph webview

### 8. Tests and packaging

- `@vscode/test-cli` tests against a fixture project in
  `src/test/fixtures/demo` (pdp.yml + 3 tasks with trivial Makefiles):
  status parsing, report parsing, tree items.
- `pnpm vsce package` and install the `.vsix` locally to check `media/` ships.

### 9. Graph view in the sidebar, Run To Here

Done; see `docs/report/09-graph-view-and-run-to.md`.

- The graph moved from an editor-side `WebviewPanel` to the sidebar
  `WebviewView` `pdp.graph` (`src/graph.ts` → `src/graphView.ts`), always
  present in the PDP container; `flowchart LR` → `TD` to fit the narrow
  sidebar. The "Show graph" command and Tasks-title button were removed.
- New `pdp.runTo` ("Run To Here") on task right-click: `pdp run --to <id>`
  runs the task and everything upstream, unlike `--only`, which refuses when
  upstream is stale.
- `pdp.cleanTask` also became a labelled task context-menu entry.

### 10. Graph: sidebar fit and right-click actions

`src/graphView.ts` + `src/extension.ts`.

- Node labels shrink to `id ⚠` (stale) / `id ✓` (fresh); after render the
  webview appends an SVG `<title>` per node from a `labels` array sent with
  the render message, so the full state stays on hover. The icon keeps the
  ADR 0004 text/shape-marker rule.
- One `mermaid.initialize` (the redundant first call goes) with
  `themeVariables.fontSize: 11px` and
  `flowchart: { nodeSpacing: 30, rankSpacing: 35, padding: 8, useMaxWidth: true }`.
- Right-click a node: a `contextmenu` listener posts `taskMenu` (node index);
  the provider maps it to a task via a new `onTaskMenu(id)` callback;
  `extension.ts` shows a QuickPick — Run / Run only / Run to here / Run from
  here / Force run / Run on Slurm / Clean / Open task.yml — and dispatches
  the existing commands with the task id.
- `taskFromArgOrPick` accepts a plain task-id string (validated against
  `lastStatus`) so dispatched commands do not re-prompt.
- Tests: label assertions in `src/test/graph.test.ts` updated; a stub-webview
  test that `taskMenu` for `n1` calls back with the task id; a string-arg
  command test on the fixture. Keyboard and palette access unchanged.
- Report `docs/report/10-graph-sidebar-fit-and-context-menu.md`.

### 11. Tasks view file tree, delete task, and keybindings

`pdp/pdp/cli.py` + `pdp/pdp.py` + `pdp/pdp/task.py`, `src/extension.ts`, `src/tasksView.ts` + `package.json`.

- New `FileItem` (fs path, `folder`/`file` theme icons, files open with the
  built-in `vscode.open`). `getChildren`:
  - root: a `pdp.yml` row (opens it) before the tasks;
  - task: existing detail rows (`depends on`, `entrypoint`, `slurm`) first,
    then the real folder listing (dirs first, alphabetical);
  - dir items recurse.
- Folder lookup validates task ids the way `taskFolder()` does, silently
  skipping bad ids (no circular import into `extension.ts`).
- Delete task from the task context menu ("PDP: Delete Task…", group
  `5_delete@1` after Clean):
  - pdp library first: a `pdp delete <id>` command that removes the task's
    directory **and** its entry from `pdp.yml` (pdp owns the file; the
    extension must not edit it, and carries no YAML parser). An
    already-missing directory is not an error — the entry is still removed.
    It refuses with the list of dependents if another task depends on it,
    and exits 1 on unknown ids. No `MIN_PDP_VERSION` bump: older pdp
    answers "no such command" and the extension shows the error.
  - pdp also stops resurrecting deleted tasks: `PDP.initialize()` currently
    calls `create_task()` for every `pdp.yml` entry, which scaffolds the
    folder and writes a default `task.yml` — so a manually deleted task
    dir **and its config** are rebuilt on the next `pdp status`, before the
    extension ever sees the orphan. Load must only construct `Task`
    objects; scaffolding stays in `create_task` (`pdp create`) and
    `pdp scaffold`. A listed task with no folder then stays missing —
    `status` still lists it (empty config, stale). Update any pdp tests
    that relied on load-time scaffolding.
  - pdp stops crashing `status` on dangling `depends_on` ids: renaming a
    task in `pdp.yml`, or deleting one that others depend on, leaves a
    `depends_on` entry pointing at an unlisted id. `TopologicalSorter`
    then emits that id as its own node and `status` dies with `KeyError`
    at the `flattened[tid]` lookup (traceback, exit 1), and even past
    that `Task.is_stale` raises `UninitializedProjectError` reading the
    missing dependency's config. `status` skips unlisted ids when
    ordering and `is_stale` treats a dependency with no `task.yml` as
    stale without reading its config; a dependency cycle exits 1 with
    the `validate`-style message instead of a `CycleError` traceback.
    `pdp validate` stays the place that reports unknown deps — `status`
    is a view, not a gate.
  - Extension: `pdp.deleteTask` via `withTask`, then a native modal
    `showWarningMessage(..., { modal: true }, "Delete")` naming the task and
    its resolved folder; confirm → `execSimple(["delete", id], ...)` which
    refreshes and notifies. Cancel is a no-op.
  - Cleanup modal for manual deletions: after each refresh, tasks listed in
    status whose folder is missing (host-side `existsSync` — no JSON schema
    change) get one modal — "listed in pdp.yml but folder is missing: X, Y.
    Remove them?" Confirm deletes each via `pdp delete`; dismissed ids are
    remembered for the session so watcher refreshes do not re-prompt.
  - A failed status stops blanking the views: `doRefresh`'s catch keeps
    the last good status in the Tasks tree and graph (no `update(null)`)
    and shows the error notification when the message changes — today
    the watcher's `refresh()` passes `notifyOnError = false`, so a broken
    project silently empties the sidebar with no visible error and looks
    unrecoverable. The `$(error) PDP` status bar item stays as the
    persistent signal.
  - Tests: `pdp delete` and load-without-scaffold in pdp's
    `tests/test_cli.py` (dir and yml entry gone, missing dir tolerated,
    dependents refusal, unknown id, deleted dir stays deleted after
    `status`, status with a dangling `depends_on` lists the remaining
    tasks at exit 0, a cycle fails like `validate`); the orphan-id list
    as a pure function in the extension. The modals are hand-tested in
    the dev host — prompt-gated commands are not
    e2e-tested, as with `pdp init`.
  - Two repos, two commits: the pdp-side changes (the delete command,
    load-without-scaffold, and the status crash fix) are their own
    commit/PR in the pdp repo,
    following that repo's conventions, with a CHANGELOG entry there — the
    scaffold change affects every pdp user, not just the extension. This
    step's report links to it. Dev and tests run against the editable
    install; real users get the features only after a pdp release, which
    can follow this step rather than block it.
- Keybindings in `contributes.keybindings`, prefix `alt+p`:

  | Key           | Command                                                 |
  | ------------- | ------------------------------------------------------- |
  | `alt+p p`     | `pdp.tasks.focus` (`when: !terminalFocus`)              |
  | `alt+p g`     | `pdp.graph.focus` (`when: !terminalFocus`)              |
  | `alt+p r`     | `pdp.remote.focus` (`when: !terminalFocus`)             |
  | `alt+p space` | `pdp.runAll` (`when: pdp.hasProject && !terminalFocus`) |

  `.focus` commands are auto-generated for contributed views; `space` is an
  accepted chord key. Every binding is gated `!terminalFocus` so the chords
  never fight the integrated terminal for alt keys (zsh history-search
  bindings, `commandsToSkipShell`); worst case they pause while the terminal
  has focus. Known collisions, both user-rebindable: the Project Manager
  extension historically shipped `alt+p`, and on macOS `opt+p` types `π`,
  which a chord prefix captures.

- Tests: fixture tree tests (pdp.yml first row, task children order,
  `output/` expanding to its files); execute the `.focus` commands.
  Keybindings are hand-verified in the development host.
- Known limit, note in the report: the watchers refresh `**/*.yml` and
  `**/{input,src,output,hand}/**`, so files created elsewhere in a task
  folder need a manual Refresh.
- Report `docs/report/11-tasks-file-tree-delete-and-keybindings.md`.

### 12. Interactive graph with Cytoscape (supersedes ADR 0004)

Do this last; steps 10–11 land on the Mermaid renderer first.

- New `docs/adr/0005-…` superseding 0004: the graph renders with Cytoscape
  because users can drag nodes; the text/shape-marker rule carries over.
- Swap the shipped bundle: `cytoscape` devDependency, the copy script ships
  `cytoscape.min.js` into `media/`, Mermaid is deleted (~5.5 MB out, ~1.2 MB
  in). CSP unchanged (local script + nonce, no `unsafe-eval`).
- Only the webview script in `html()` is rewritten; the provider/host message
  contract (`render`/`rendered`, `openTask`, `taskMenu`) stays identical, so
  step 10's right-click work and the render smoke test survive.
  `mermaidDefinition` is replaced by a pure `graphElements(status, positions)`
  builder, tested directly.
- Layout: `breadthfirst` on first render; `preset` when saved positions
  exist. Tap → `openTask`, `cxttap` → `taskMenu`, `dragfree` → post
  positions. Dragging moves pixels only: edges always come from
  `pdp status`, and nothing but node position is editable by default.
- Positions persist in `context.workspaceState` keyed by project root +
  task id: sent with the render message, saved on drag end. Per-project,
  survives restarts.
- Tooltips become optional (canvas needs a small hover div); the ⚠/✓ label
  marker already satisfies the accessibility rule. Keyboard users unchanged
  (tree, palette, step-11 chords).
- Report `docs/report/12-graph-cytoscape-interactive.md` with vsix size
  before/after.

## Development

### Live pdp edits

pdp is installed as an editable uv tool:

```sh
cd ~/repos/pdpd/pdp
uv tool install --force --editable ".[dagster]"
```

`~/.local/bin/pdp` runs the tool venv, whose `pdp.pth` points at this repo.
So edits to `pdp/*.py` are live in the terminal and in the extension
development host immediately, with no reinstall.

Reinstall (same command) only when:

- `pyproject.toml` dependencies or entry points change.
- The **version** changes. `pdp --version` reads installed metadata, so the
  extension's version check sees the old version until you reinstall.

Check what is installed:

```sh
cat ~/.local/share/uv/tools/pdp/uv-receipt.toml   # editable = <path>
pdp --version
```

### Before the pdp release exists

While `--json` is only on a branch, the version check fails against the
editable install's old version. Bump `version` in `pyproject.toml` as part of
step 1 and reinstall once.

To point the extension at a different pdp (e.g. a worktree), set `pdp.path`
to that environment's binary, e.g. `/path/to/worktree/.venv/bin/pdp` after
`uv sync` there.

### Remote runs need the same pdp on the cluster

`pdp remote` installs pdp on the cluster from `PDP_REMOTE_SPEC` (default:
latest release). To test unreleased `remote status --json` or run changes,
pin the branch in the project `.env`:

```sh
PDP_REMOTE_SPEC="pdp[dagster] @ git+https://github.com/scienceandhumanitylab/pdp@<sha>"
```

`remote status --json` itself runs locally, so it only needs the editable
install.

### Extension loop

```sh
cd ~/repos/pdpd/pdp-vscode
pnpm install
pnpm watch          # or let F5 run the default build task
```

- F5 opens the development host. Add the fixture folder to `launch.json`
  `args` so it opens a pdp project: `"${workspaceFolder}/src/test/fixtures/demo"`.
- `Developer: Reload Window` in the host picks up extension changes.
- `Output → PDP` shows every pdp invocation and its output.
- `pnpm test` runs the extension tests; `uv run pytest` in `pdp/` runs the
  library tests.
