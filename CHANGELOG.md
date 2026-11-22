# Change Log

## [0.0.7] - 2026-11-22

### Changed

- Moved development out of `README.md` and into `docs/development.md`.
- Cleaned up `CHANGELOG.md'

## [0.0.6] - 2026-11-22

### Added

- Single-key shortcuts in the Tasks view, acting on the highlighted task (the
  row you clicked or arrowed to):
  - `t` opens `task.yml`; `Shift+T` offers to create a missing one with the stub
    `pdp create` writes.
  - `s` opens the task's source file; `Shift+S` offers to create a missing
    `src/main.sh`.
  - `m` opens the task's Makefile (explaining its absence); `Shift+M` offers to
    create a missing one.
  - `r` / `c` run / clean the task after a confirmation ("Run "clean"?");
    `Shift+R` / `Shift+C` run / clean every task.
  - `f` freshens and `d` deletes the task (both ask first).
- `?` in the Tasks or Graph view shows a cheat sheet of its keys; picking an
  entry runs it, and **Customize…** opens the Keyboard Shortcuts editor filtered
  to `pdp.`.
- Graph keyboard shortcuts while the graph is focused: `i`/`o` zoom, `l` choose
  layout, `s` save layout, `r` reset (the toolbar buttons show the keys). `Tab`,
  `Left`/`Right` and `j`/`k` cycle the toolbar buttons (wrapping) with a visible
  focus ring; Enter activates the focused button. The layout menu takes `j`/`k`
  for up/down.
- **Save Graph Layout as Default** (graph toolbar, palette) remembers your
  arrangement, and **Reset Graph Layout** returns to it, even after you try
  another layout. Saving and resetting confirm on the status bar; reset names
  its target (saved default or the chosen automatic layout).
- A running task is visible: during a run the task pdp is working on turns
  yellow with a dashed, pulsing border and a ⟳ marker in the graph (hover says
  "running"), and shows a spinning icon and "running" in the Tasks view. The
  pulse respects reduced motion.
- `Alt+P .` re-runs the last run.
- `Alt+P T` focuses the Tasks view (like `Alt+P P`).

### Changed

- The graph packs its boxes closer, so it fills the sidebar narrow and tall. A
  newly added task is placed next to its neighbours instead of re-laying out the
  whole graph.
- The Layout button opens its menu right at the click (or under the button when
  activated by keyboard) instead of a QuickPick in the middle of the screen; the
  palette command keeps the QuickPick.
- The task picker (from the `pdp.yml` row or the palette) opens with the tree's
  selected task as the highlighted first entry.
- The sidebar starts as 1:3 Tasks:Graph with Remote collapsed (initial layout
  only; VS Code remembers whatever you drag).

### Fixed

- The graph's zoom, layout and reset buttons no longer collapse the view when
  clicked: they moved from the view's title bar into a toolbar inside the graph.

## [0.0.5] - 2026-11-20

### Added

- **pdp: Freshen Task (and Downstream)** and **pdp: Freshen Only This Task** on
  a task's right-click menu, the graph node menu and the palette: mark tasks
  fresh without running them, after a confirmation that outputs are not
  recomputed. When freshening makes downstream tasks stale, the result offers a
  **Freshen Downstream** button (`pdp freshen --from`, pdp's own suggestion).
- **pdp: Run To Here** task command (`pdp run --to`): runs a task and everything
  upstream of it, which works even when upstream tasks are stale (where **Run
  Only This Task** refuses).
- **pdp: Delete Task…** on a task's right-click menu: after a confirmation
  dialog, `pdp delete` removes the task's folder and its `pdp.yml` entry. Needs
  a pdp with `pdp delete`.
- Right-clicking a task in the Tasks view has a labelled **Clean Task** entry in
  addition to the inline trash icon.
- Right-clicking a graph node opens a menu of task actions (Run, Run only, Run
  to here, Run from here, Force run, Run on Slurm, Clean, Open task.yml,
  Delete…).
- The Tasks view starts with a `pdp.yml` row, and each task expands to its
  details and then its folder's files (folders first); click a file to open it.
- Tasks listed in `pdp.yml` whose folder is missing get one dialog per session
  offering to **Remove** them from `pdp.yml` or **Scaffold** (recreate the
  folders).
- Keyboard chords: `Alt+P P` Tasks, `Alt+P G` Graph, `Alt+P R` Remote,
  `Alt+P Space` run all stale (not while the terminal has focus).
- **`pdp.graphFontSize`** setting (default 14px, re-renders live).
- Graph nodes can be dragged, the canvas pans and zooms (capped at 150%, also
  from title-bar buttons), and your arrangement and zoom/pan are remembered per
  project across runs and refreshes. A layout picker on the title bar switches
  between top-down, left-right and force-directed, and **Reset Graph Layout**
  clears your arrangement back to the chosen layout.

### Changed

- pdp ≥ 0.2.5 (the first release on PyPI, as `pdp-helper`) is now the minimum;
  the upgrade hint says `uv tool upgrade pdp-helper`.
- Run notifications say `fresh:` where they said `current:`, matching pdp
  0.2.5's run report (`Current:` became `Fresh:`).
- The graph moved from a separate editor panel into a **Graph view** in the pdp
  sidebar (below Tasks), drawn top-to-bottom to fit the narrow view.
- The graph is drawn with Cytoscape instead of Mermaid; the extension ships one
  0.4 MB script instead of a 5.2 MB one.
- Graph nodes are compact (`task ✗` / `task ✓`), colour-coded gruvbox-style red
  (stale) / blue (fresh), with snug boxes so more of the DAG fits the narrow
  sidebar; hovering a node shows its full state (stale/fresh).
- The Tasks view no longer shows `depends on` / `entrypoint` rows, nor lists
  them in the tooltip — clicking the task opens `task.yml`, where they are
  configured. Slurm flags still show.
- **pdp: Validate** surfaces pdp's warnings (e.g. a `depends_on` pattern
  matching no files) instead of a bare "Valid project".

### Fixed

- Remote runs show their real result summary; the trailing "`pdp remote pull` to
  fetch output." line used to cut the report off, so every remote run reported
  "nothing to run".
- A failed refresh keeps the last good tasks and graph on screen instead of
  emptying the sidebar, and shows an error notification whenever the error
  changes.
