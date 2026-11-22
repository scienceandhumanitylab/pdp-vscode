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

## Commands

Everything is in the command palette as **pdp: …**. The frequent ones are also
buttons on the views.

**Tasks view title** (`…` holds the rest):

- **Run all (stale)** `▶`: runs every stale task.
- **Run…**: pick tasks, then options (only, force, Slurm, runner).
- **Create task**: adds a new task.
- **Refresh**: reloads the tasks and graph.
- **Scaffold**: creates any missing task folders.
- **Validate**: checks `pdp.yml` and lists pdp's warnings.
- **Init project**: creates a new pdp project.
- **Clean all**: removes every task's output.

**On a task** (inline or right-click):

- **Run**: runs the task and everything upstream.
- **Run only this task**: runs just this task; refuses if upstream is stale.
- **Run to here**: same as Run (`pdp run --to`).
- **Run from here**: runs the task and everything downstream.
- **Force run**: runs the task even if it is fresh.
- **Run on Slurm**: runs the task as a Slurm job.
- **Remote run**: runs the task on the cluster.
- **Freshen (downstream)**: marks the task and downstream fresh without running.
- **Freshen only**: marks just this task fresh without running.
- **Clean**: removes the task's output.
- **Open task.yml**: opens the task's config.
- **Reveal task folder**: shows the task's folder in the Explorer.
- **Delete task…**: removes the task's folder and its `pdp.yml` entry.

**Remote & Processes view:**

- **Start Dagster (local / Slurm)**: starts the Dagster UI.
- **Remote start**: pushes, starts Dagster on the cluster and tunnels the UI.
- **Remote status**: checks the cluster (manual only, it SSHes).
- **Remote run all / push / pull / stop**: runs, syncs or stops the cluster
  project.

Freshen and Delete ask first. Runs show a progress notification with **Cancel**,
which stops pdp and all its tasks.

### Keyboard shortcuts

Chords start with `alt+p`. They are off while the integrated terminal has focus,
so they never fight the shell. Rebind them under **Keyboard Shortcuts** if
`alt+p` clashes (another extension, or `π` on macOS).

| Keys                 | Action                |
| -------------------- | --------------------- |
| `alt+p` then `p`/`t` | Focus the Tasks view  |
| `alt+p` then `g`     | Focus the Graph view  |
| `alt+p` then `r`     | Focus the Remote view |
| `alt+p` then `space` | Run all stale tasks   |
| `alt+p` then `.`     | Re-run the last run   |

Single keys work while a view has focus. Press `?` in either view for a cheat
sheet: pick an entry to run it, or **Customize…** to rebind.

**Tasks view** (on the highlighted task):

| Key             | Action                                       |
| --------------- | -------------------------------------------- |
| `t` / `Shift+T` | Open `task.yml` / create it if missing       |
| `s` / `Shift+S` | Open the source file / create `src/main.sh`  |
| `m` / `Shift+M` | Open the Makefile / create it if missing     |
| `r` / `Shift+R` | Run the task / run all tasks (after confirm) |
| `c` / `Shift+C` | Clean the task / clean all tasks (confirm)   |
| `f`             | Freshen the task                             |
| `d`             | Delete the task…                             |
| `?`             | Cheat sheet                                  |

**Graph view:**

| Key                            | Action                 |
| ------------------------------ | ---------------------- |
| `i` / `o`                      | Zoom in / out          |
| `l`                            | Choose layout          |
| `s`                            | Save layout as default |
| `r`                            | Reset layout           |
| `Tab`, `Left`/`Right`, `j`/`k` | Cycle toolbar buttons  |
| `?`                            | Cheat sheet            |

## Settings

| Setting             | Default | Meaning                                                |
| ------------------- | ------- | ------------------------------------------------------ |
| `pdp.path`          | `pdp`   | Path to the pdp binary, e.g. `/path/to/.venv/bin/pdp`  |
| `pdp.dagsterPort`   | `3000`  | Port for the local Dagster UI started from the sidebar |
| `pdp.graphFontSize` | `14`    | Font size (px) of the task graph node labels           |

## Troubleshooting

- **"Could not run pdp …"** — `pdp` is not on VS Code's PATH or the version is <
  0.2.5. Set `pdp.path` to an absolute binary path (e.g. a worktree's
  `.venv/bin/pdp`) and reload the window.
- **Nothing in the sidebar** — the workspace root must contain `pdp.yml`.
- **A command failed** — check **Output → pdp** for the full pdp output.
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
cd pdp-vscode pnpm install
```

- F5 or `Debug: Start Debugging` to launch development window. It opens with the
  demo fixture project (`src/test/fixtures/demo`). Open your own project with
  **File → Open Folder…** there.
- `Developer: Reload Window` in development window to update
- `pnpm test` to compile, lint and run the tests

### Publishing

Pushing a `v*` tag runs `.github/workflows/publish.yml`, which publishes to the
Marketplace with Trusted Publishing. Merging or pushing to `main` does not
publish. The workflow refuses tags on commits that aren't on `main`.

1. **Prepare the release on your branch.** Bump the version first (pnpm needs a
   clean tree), then rename `## [Unreleased]` in `CHANGELOG.md` to
   `## [x.y.z] - YYYY-MM-DD`, and commit both:

   ```sh
   pnpm version patch --no-git-tag-version
   # edit CHANGELOG.md
   git commit -am "x.y.z"
   git push
   ```

2. **Merge to `main`**, on GitHub or locally and push. Any merge method works.

3. **Tag `main` to publish:**

   ```sh
   git switch main
   git pull
   git tag vx.y.z
   git push origin vx.y.z
   ```

4. **Check the release** under the repo's Actions tab, then on the Marketplace
   listing.

5. **Start the next cycle.** Add a new empty `## [Unreleased]` section to
   `CHANGELOG.md` on your branch.

The Marketplace rejects a version that was already published, so always bump.
