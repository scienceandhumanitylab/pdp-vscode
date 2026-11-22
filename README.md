> Warning: This is a nearly 100% vibe-coded app. Or AI-engineered, depending on
> your preferences.

# pdp-vscode

Yes, but will it VScode?

This is a VScode implementation of the
[pdp library](https://github.com/scienceandhumanitylab/pdp).

Run your `pdp` project from the sidebar in VScode. Scaffold your project, run
tasks, see what is stale, run dagster, and browse the task graph, all without
using the terminal.

## Requirements

- VS Code ≥ 1.140
- `pdp` ≥ **0.2.5** on your PATH. Installation instructions at
  [pdp GitHub](https://github.com/scienceandhumanitylab/pdp).

  ```sh
  uv tool install "pdp-helper[dagster]" # full package
  uv tool install pdp-helper # core only, without dagster
  uv tool upgrade pdp-helper
  ```

## Settings

| Setting             | Default | Meaning                                                |
| ------------------- | ------- | ------------------------------------------------------ |
| `pdp.path`          | `pdp`   | Path to the pdp binary, e.g. `/path/to/.venv/bin/pdp`  |
| `pdp.dagsterPort`   | `3000`  | Port for the local Dagster UI started from the sidebar |
| `pdp.graphFontSize` | `14`    | Font size (px) of the task graph node labels           |

## Commands

Everything is in the command palette as **PDP: …**. The frequent ones are also
buttons on the views.

**Tasks view title:** Run all (stale) `▶`, Create task, Refresh, plus Run…,
Scaffold, Validate, Init project and Clean all under `…`. Validate reports pdp's
warnings (for example, a `depends_on` pattern matching no files), not just
success.

**On a task** (inline or right-click): Run, Clean, Run only this task, Run to
here, Run from here, Force run, Run on Slurm, Freshen (downstream), Freshen
only, Remote run, Open task.yml, Reveal task folder, Clean task, Delete task….
**Run to here** runs the task and everything upstream of it, so it works even
when an upstream task is stale — which **Run only this task** refuses.
**Freshen** marks tasks fresh without running them (pdp sets their output file
times to now — for a change you know doesn't affect results, like a comment). It
asks first, and if it makes downstream tasks stale the notification offers
**Freshen Downstream**. **Delete task…** asks first, then removes the task's
folder and its `pdp.yml` entry (`pdp delete`, so it needs a pdp with that
command). pdp refuses while another task depends on it.

**Run…** asks for tasks (multi-select) and then options (Only, Force, Slurm,
runner).

**Remote & Processes view:** Start Dagster (local/Slurm), Remote start, Remote
status (manual only — it SSHes), Remote run all / push / pull / stop.

Runs show a progress notification with a **Cancel** button. Cancelling
interrupts pdp _and_ its whole task tree (same as Ctrl-C in a terminal).

### Keyboard shortcuts

Chords start with `alt+p`. They are off while the integrated terminal has focus,
so they never fight the shell. Rebind them under **Keyboard Shortcuts** if
`alt+p` clashes (another extension, or `π` on macOS).

| Keys                 | Action                |
| -------------------- | --------------------- |
| `alt+p` then `p`     | Focus the Tasks view  |
| `alt+p` then `g`     | Focus the Graph view  |
| `alt+p` then `r`     | Focus the Remote view |
| `alt+p` then `space` | Run all stale tasks   |

## The graph

The **Graph view** sits under Tasks in the PDP sidebar and draws the task DAG on
an interactive canvas. Drag nodes to arrange them and drag the background to
pan. Scroll to zoom (up to 150%), or use the toolbar in the graph's top-right
corner. Your arrangement and view are remembered per project and survive runs
and refreshes; a newly added task is placed next to its neighbours without
moving the rest. The toolbar's **Layout** picks top-down, left-right or
force-directed and re-lays the graph out. **Save** keeps your arrangement as the
default, and **Reset** returns to it (or, with nothing saved, to the automatic
layout). Every toolbar action is also in the command palette. Nodes are labelled
`task ✗` / `task ✓` and coloured stale/fresh and follow your colour theme;
during a run the task being worked on shows `task ⟳` in yellow with a pulsing
dashed border (still when your system asks for reduced motion). Hover a node for
its full state. Click a node to open that task's `task.yml`. Right-click it for
the task menu (run variants, Freshen, Clean, Open task.yml, Delete…).

## Dagster and the cluster

- **PDP: Start Dagster (Local)** runs `pdp dagster dev` on `pdp.dagsterPort`.
  When the UI is up you get a notification with **Simple Browser** / **External
  Browser** buttons. The process shows in the Processes section with Open UI and
  Stop buttons.
- **Remote** commands need a `.env` in your project with at least:

  ```sh
  PDP_REMOTE_HOST=cluster.example.edu
  PDP_REMOTE_PATH=/home/me/my-project
  PDP_REMOTE_PORT=3002
  # optional, pins what gets installed on the cluster:
  # PDP_REMOTE_SPEC="pdp-helper[dagster] @ git+https://github.com/scienceandhumanitylab/pdp@<sha>"
  ```

  `PDP_REMOTE_SPEC` matters while features are unreleased: the cluster needs the
  same pdp as your local install.

- **PDP: Remote Start** pushes, starts Dagster on the cluster in tmux and
  tunnels the UI. It keeps running as a tracked process. Stopping the tunnel
  leaves the cluster session alive by design — **PDP: Remote Stop** ends the
  sessions and cancels pdp's Slurm jobs.
- The Remote section of the view shows host, project pushed, session, last run
  (with exit code), whether the Dagster UI port is listening, and Slurm jobs (or
  "unknown" if `squeue` failed).

## Troubleshooting

- **"Could not run pdp …"** — `pdp` is not on VS Code's PATH or the version is <
  0.2.5. Set `pdp.path` to an absolute binary path (e.g. a worktree's
  `.venv/bin/pdp`) and reload the window.
- **Nothing in the sidebar** — the workspace root must contain `pdp.yml`.
- **A command failed** — check **Output → PDP** for the full pdp output.
- **Edits to pdp itself** — if pdp is installed as an editable uv tool, Python
  edits are live immediately. Reinstall
  (`uv tool install --force --editable ".[dagster]"`) only when dependencies or
  the version change.

## Development

```sh
# install pnpm
curl -fsSL https://get.pnpm.io | sh -

# clone repo
git clone https://github.com/scienceandhumanitylab/pdp-vscode.git
cd pdp-vscode
pnpm install
```

- F5 or `Debug: Start Debugging` to launch development window. It opens with the
  demo fixture project (`src/test/fixtures/demo`). Open your own project with
  **File → Open Folder…** there.
- `Developer: Reload Window` in development window to update
- `pnpm test` to compile, lint and run the tests

### Publishing

Pushing a `v*` tag runs `.github/workflows/publish.yml`, which publishes to the
Marketplace with Trusted Publishing. From a clean `main`:

```sh
pnpm version patch
git push --follow-tags
```

Marketplace will reject if not bumped.
