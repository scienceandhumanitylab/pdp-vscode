# PDP for VS Code — setup and usage

Run your `pdp` project from the sidebar: see what is stale, run tasks, start
Dagster, push to the cluster, and browse the task graph — without a terminal.

## Requirements

- VS Code ≥ 1.140
- `pdp` ≥ **0.2.4** on your PATH (the first release with `status --json`).

  ```sh
  uv tool install "pdp[dagster]"     # first install
  uv tool upgrade pdp                # if you have an older one
  pdp --version                      # must print 0.2.4 or newer
  ```

The extension checks the version when it activates and tells you to upgrade
if it is too old.

## Install

### From a packaged .vsix

```sh
git clone https://github.com/scienceandhumanitylab/pdp-vscode.git
cd pdp-vscode
pnpm install
pnpm exec vsce package
code --install-extension pdp-0.0.1.vsix
```

### From source (development)

```sh
cd pdp-vscode
pnpm install
```

Then press **F5**. The development host opens with the demo fixture project
(`src/test/fixtures/demo`) so you immediately see the sidebar in action.
Open your own project with **File → Open Folder…** there.

Run the tests with `pnpm test`.

## Settings

| Setting           | Default | Meaning                                                |
| ----------------- | ------- | ------------------------------------------------------ |
| `pdp.path`        | `pdp`   | Path to the pdp binary, e.g. `/path/to/.venv/bin/pdp`  |
| `pdp.dagsterPort` | `3000`  | Port for the local Dagster UI started from the sidebar |

## First use

1. Open the folder that contains (or will contain) your `pdp.yml` — one
   project per workspace, at the root.
2. The **PDP icon** appears in the activity bar. If there is no `pdp.yml`
   yet, the Tasks view shows an **Init project** button (or run
   **PDP: Init Project** from the command palette) and asks for a name.
3. The Tasks view lists your tasks in topological order. Each shows a
   **stale** or **fresh** label with its own icon; expand a task to see its
   dependencies, entrypoint and Slurm flags. Click a task to open its
   `task.yml`.
4. The status bar shows `PDP: N stale` — click it to run all stale tasks.

The view refreshes automatically (file watchers on `input/`, `src/`,
`output/`, `hand/` and all `.yml`, debounced) and after every command. Every
pdp invocation and its full output goes to the **Output → PDP** channel;
error notifications have a **Show Output** button.

## Commands

Everything is in the command palette as **PDP: …**; the frequent ones are
also buttons on the views.

**Tasks view title:** Run all (stale) `▶`, Show graph, Create task, Refresh,
plus Run…, Scaffold, Validate, Init project and Clean all under `…`.

**On a task** (inline or right-click): Run, Clean, Run only this task, Run
from here, Force run, Run on Slurm, Remote run, Open task.yml, Reveal task
folder.

**Run…** asks for tasks (multi-select) and then options (Only, Force, Slurm,
runner).

**Remote & Processes view:** Start Dagster (local/Slurm), Remote start,
Remote status (manual only — it SSHes), Remote run all / push / pull / stop.

Runs show a progress notification with a **Cancel** button; cancelling
interrupts pdp _and_ its whole task tree (same as Ctrl-C in a terminal).

## The graph

**Show graph** opens a webview with a Mermaid flowchart of `depends_on`.
Nodes are labelled and coloured stale/fresh, the diagram re-renders on every
refresh and follows your colour theme. Click a node to open that task's
`task.yml`.

## Dagster and the cluster

- **PDP: Start Dagster (Local)** runs `pdp dagster dev` on
  `pdp.dagsterPort`. When the UI is up you get a notification with **Simple
  Browser** / **External Browser** buttons; the process shows in the
  Processes section with Open UI and Stop buttons.
- **Remote** commands need a `.env` in your project with at least:

  ```sh
  PDP_REMOTE_HOST=cluster.example.edu
  PDP_REMOTE_PATH=/home/me/my-project
  PDP_REMOTE_PORT=3002
  # optional, pins what gets installed on the cluster:
  # PDP_REMOTE_SPEC="pdp[dagster] @ git+https://github.com/scienceandhumanitylab/pdp@<sha>"
  ```

  `PDP_REMOTE_SPEC` matters while features are unreleased: the cluster needs
  the same pdp as your local install.

- **PDP: Remote Start** pushes, starts Dagster on the cluster in tmux and
  tunnels the UI; it keeps running as a tracked process. Stopping the tunnel
  leaves the cluster session alive by design — **PDP: Remote Stop** ends the
  sessions and cancels pdp's Slurm jobs.
- The Remote section of the view shows host, project pushed, session, last
  run (with exit code), whether the Dagster UI port is listening, and Slurm
  jobs (or "unknown" if `squeue` failed).

## Troubleshooting

- **"Could not run pdp …"** — `pdp` is not on VS Code's PATH or the version
  is < 0.2.4. Set `pdp.path` to an absolute binary path (e.g. a worktree's
  `.venv/bin/pdp`) and reload the window.
- **Nothing in the sidebar** — the workspace root must contain `pdp.yml`.
- **A command failed** — check **Output → PDP** for the full pdp output.
- **Edits to pdp itself** — if pdp is installed as an editable uv tool,
  Python edits are live immediately; reinstall
  (`uv tool install --force --editable ".[dagster]"`) only when dependencies
  or the version change.
