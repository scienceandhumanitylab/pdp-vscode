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
  graph.ts       Mermaid webview panel
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
| Run from here                 | `pdp run --from <id>`                                                  | task context                   |
| Force run                     | `pdp run <id> --force`                                                 | task context                   |
| Run on Slurm                  | `pdp run <id> --slurm`                                                 | task context                   |
| Clean task / all              | `pdp clean [<id>]`                                                     | task inline, Tasks title `...` |
| Open task.yml / reveal folder | n/a                                                                    | task click / context           |
| Show graph                    | n/a (status JSON)                                                      | Tasks title                    |
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

Webview panel. Mermaid `flowchart LR` built from `depends_on`; node class
`stale`/`fresh`, and each node's text includes a "stale" or "fresh" label. Click a node → `postMessage` → open its `task.yml`.
Re-render on every refresh while open. CSP: only `webview.cspSource` scripts
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
