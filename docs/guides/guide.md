# PDP for VS Code — setup and usage

Run your `pdp` project from the sidebar: see what is stale, run tasks, start
Dagster, push to the cluster, and browse the task graph — without a terminal.

## Requirements

- VS Code ≥ 1.140
- `pdp` ≥ **0.2.5** on your PATH (the first release on PyPI, as `pdp-helper`).

  ```sh
  uv tool install "pdp-helper[dagster]"  # first install
  uv tool upgrade pdp-helper             # if you have an older one
  pdp --version                          # must print 0.2.5 or newer
  ```

The extension checks the version when it activates and tells you to upgrade
if it is too old. If you installed pdp from git before it was on PyPI (as the
tool `pdp`), remove that tool first: `uv tool uninstall pdp`, then install
`pdp-helper`.

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

| Setting             | Default | Meaning                                                |
| ------------------- | ------- | ------------------------------------------------------ |
| `pdp.path`          | `pdp`   | Path to the pdp binary, e.g. `/path/to/.venv/bin/pdp`  |
| `pdp.dagsterPort`   | `3000`  | Port for the local Dagster UI started from the sidebar |
| `pdp.graphFontSize` | `14`    | Font size (px) of the task graph node labels           |

## First use

1. Open the folder that contains (or will contain) your `pdp.yml` — one
   project per workspace, at the root.
2. The **PDP icon** appears in the activity bar. If there is no `pdp.yml`
   yet, the Tasks view shows an **Init project** button (or run
   **PDP: Init Project** from the command palette) and asks for a name.
3. The Tasks view starts with a `pdp.yml` row, then lists your tasks in
   topological order. Each shows a **stale** or **fresh** label with its own
   icon; expand a task to see its dependencies, entrypoint and Slurm flags,
   then its folder's files. Click a task to open its `task.yml`, or a file to
   open it.
4. The status bar shows `PDP: N stale` — click it to run all stale tasks.

The view refreshes automatically (file watchers on `input/`, `src/`,
`output/`, `hand/` and all `.yml`, debounced) and after every command. Every
pdp invocation and its full output goes to the **Output → PDP** channel;
error notifications have a **Show Output** button. Files created in a task
folder outside those watched paths (e.g. at the task root) need a manual
**Refresh** to appear in the tree.

If a refresh fails (say, a broken `task.yml`), the sidebar keeps the last good
status, the status bar shows `PDP` with an error icon, and you get a
notification whenever the error changes.

If `pdp.yml` lists a task whose folder is gone (deleted by hand, say), the
extension asks once per session whether to remove those entries.

## Commands

Everything is in the command palette as **PDP: …**; the frequent ones are
also buttons on the views.

**Tasks view title:** Run all (stale) `▶`, Create task, Refresh, plus Run…,
Scaffold, Validate, Init project and Clean all under `…`.

**On a task** (inline or right-click): Run, Clean, Run only this task, Run to
here, Run from here, Force run, Run on Slurm, Remote run, Open task.yml,
Reveal task folder, Clean task, Delete task…. **Run to here** runs the task
and everything upstream of it, so it works even when an upstream task is
stale — which **Run only this task** refuses. **Delete task…** asks first,
then removes the task's folder and its `pdp.yml` entry (`pdp delete`, so it
needs a pdp with that command); pdp refuses while another task depends on it.

**Keyboard:** `Alt+P` then `P` focuses Tasks, `G` the Graph, `R` Remote, and
`Space` runs all stale tasks. The chords are off while the terminal has
focus. Rebind them under **Keyboard Shortcuts** if `Alt+P` clashes (another
extension, or `π` on macOS).

**Run…** asks for tasks (multi-select) and then options (Only, Force, Slurm,
runner).

**Remote & Processes view:** Start Dagster (local/Slurm), Remote start,
Remote status (manual only — it SSHes), Remote run all / push / pull / stop.

Runs show a progress notification with a **Cancel** button; cancelling
interrupts pdp _and_ its whole task tree (same as Ctrl-C in a terminal).

## The graph

The **Graph view** sits under Tasks in the PDP sidebar and draws the task DAG
on an interactive canvas. Drag nodes to arrange them and drag the background
to pan; scroll to zoom (up to 150%), or use the title-bar zoom buttons. Your
arrangement and view are remembered per project and survive runs and
refreshes — only adding a task re-lays-out once. The title bar also has a
layout picker — top-down, left-right or force-directed; picking one re-lays
the graph out and becomes the project's automatic layout — and **Reset Graph
Layout**, which clears your arrangement back to that automatic layout. Nodes
are labelled `task ✗` / `task ✓` and coloured stale/fresh and follow your
colour theme; hover a node for its full state. Click a node to open that
task's `task.yml`; right-click it for the task menu (run variants, Clean,
Open task.yml, Delete…).

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
  # PDP_REMOTE_SPEC="pdp-helper[dagster] @ git+https://github.com/scienceandhumanitylab/pdp@<sha>"
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
  is < 0.2.5. Set `pdp.path` to an absolute binary path (e.g. a worktree's
  `.venv/bin/pdp`) and reload the window.
- **Nothing in the sidebar** — the workspace root must contain `pdp.yml`.
- **A command failed** — check **Output → PDP** for the full pdp output.
- **Edits to pdp itself** — if pdp is installed as an editable uv tool,
  Python edits are live immediately; reinstall
  (`uv tool install --force --editable ".[dagster]"`) only when dependencies
  or the version change.
