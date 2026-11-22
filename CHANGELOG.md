# Change Log

All notable changes to the "pdp" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how
to structure this file.

## [Unreleased]

- `t` in the Tasks view opens the task's `task.yml` (it used to run to the task;
  **Run to here** stays on the right-click menus), and `Shift+T` offers to
  create a missing `task.yml` with the stub `pdp create` writes.
- Task keys in the Tasks view (`r`, `c`, `s`, …) act on the highlighted task
  straight away: `r` asks only "Run "clean"?" instead of opening a task picker
  first. The picker remains for the `pdp.yml` row and the palette.
- A running task is visible: during a run the task pdp is working on turns
  yellow with a dashed, pulsing border and a ⟳ marker in the graph (hover says
  "running"), and shows a spinning icon and "running" in the Tasks view. The
  pulse respects reduced motion.
- The Tasks view gets Makefile/source keys: `m` opens the task's Makefile
  (explaining its absence), `Shift+M`/`Shift+S` offer to create a missing
  Makefile/`src/main.sh` (opening the existing file when there is one),
  `Shift+R` and `Shift+C` run/clean every task after a confirmation, and the `?`
  cheat sheet lists them all.
- The graph toolbar cycles with `Left`/`Right` (and `j`/`k`; `l` stays the
  layout key) in addition to `Tab`.
- Initial release
- pdp ≥ 0.2.5 (the first release on PyPI, as `pdp-helper`) is now the minimum;
  the upgrade hint says `uv tool upgrade pdp-helper`.
- Run notifications say `fresh:` where they said `current:`, matching pdp
  0.2.5's run report (`Current:` became `Fresh:`).
- Remote runs now show their real result summary; the trailing
  "`pdp remote pull` to fetch output." line used to cut the report off, so every
  remote run reported "nothing to run".
- **PDP: Freshen Task (and Downstream)** and **PDP: Freshen Only This Task** on
  a task's right-click menu, the graph node menu and the palette: mark tasks
  fresh without running them, after a confirmation that outputs are not
  recomputed. When freshening makes downstream tasks stale, the result offers a
  **Freshen Downstream** button (`pdp freshen --from`, pdp's own suggestion).
- The Tasks view no longer shows `depends on` / `entrypoint` rows, nor lists
  them in the tooltip — clicking the task opens `task.yml`, where they are
  configured. Slurm flags still show.
- The missing-folder dialog offers **Scaffold** (recreate the folders) as well
  as **Remove**.
- **PDP: Validate** surfaces pdp's warnings (e.g. a `depends_on` pattern
  matching no files) instead of a bare "Valid project".
- The graph moved from a separate editor panel into a **Graph view** in the PDP
  sidebar (below Tasks), drawn top-to-bottom to fit the narrow view.
- New **PDP: Run To Here** task command (`pdp run --to`): runs a task and
  everything upstream of it, which works even when upstream tasks are stale
  (where **Run Only This Task** refuses).
- Right-clicking a task in the Tasks view now has a labelled **Clean Task**
  entry in addition to the inline trash icon.
- Graph nodes are compact (`task ✗` / `task ✓`), colour-coded gruvbox-style red
  (stale) / blue (fresh), with snug boxes and a configurable font size
  (**`pdp.graphFontSize`**, default 14px, re-renders live) so more of the DAG
  fits the narrow sidebar; hovering a node shows its full state (stale/fresh).
- Right-clicking a graph node opens a menu of task actions (Run, Run only, Run
  to here, Run from here, Force run, Run on Slurm, Clean, Open task.yml,
  Delete…).
- The Tasks view starts with a `pdp.yml` row, and each task expands to its
  details and then its folder's files (folders first); click a file to open it.
- **PDP: Delete Task…** on a task's right-click menu: after a confirmation
  dialog, `pdp delete` removes the task's folder and its `pdp.yml` entry. Needs
  a pdp with `pdp delete`.
- Tasks listed in `pdp.yml` whose folder is missing get one dialog per session
  offering to remove them from `pdp.yml`.
- A failed refresh keeps the last good tasks and graph on screen instead of
  emptying the sidebar, and shows an error notification whenever the error
  changes.
- Keyboard chords: `Alt+P P` Tasks, `Alt+P G` Graph, `Alt+P R` Remote,
  `Alt+P Space` run all stale (not while the terminal has focus).
- The graph is drawn with Cytoscape instead of Mermaid: nodes can be dragged and
  their positions are remembered per project; the canvas pans and zooms, and the
  extension ships one 0.4 MB script instead of a 5.2 MB one. Hovering a node
  still shows its full state; click and right-click work as before.
- The graph keeps your arrangement and zoom/pan across runs and refreshes; zoom
  is capped at 150% and also available from the graph toolbar. A layout picker
  on the toolbar switches between top-down, left-right and force-directed, and
  **Reset Graph Layout** clears your arrangement back to the chosen layout.
- The graph packs its boxes closer, so it fills the sidebar narrow and tall.
  **Save Graph Layout as Default** (graph toolbar, palette) remembers your
  arrangement, and **Reset Graph Layout** returns to it, even after you try
  another layout. A newly added task is placed next to its neighbours instead of
  re-laying out the whole graph.
- The graph's zoom, layout, save and reset buttons moved from the view's title
  bar into a toolbar inside the graph: clicking them on the title bar often
  collapsed the view.
- The graph responds to keyboard shortcuts while focused: `I`/`O` zoom, `L`
  choose layout, `S` save layout, `R` reset (the toolbar buttons show the keys).
- The Layout button opens its menu right at the click (or under the button when
  activated by keyboard) instead of a QuickPick in the middle of the screen; the
  palette command keeps the QuickPick.
- The Tasks view gets single-key shortcuts on the selected task: `R`/`C`/`T`
  run/clean/run-to after a confirmation, `S` opens the task's source file, `O`
  reveals its `output/` folder, plus the existing `F` freshen and `D` delete
  modals.
- `?` in either view shows a cheat sheet of these keys; picking an entry runs
  it, and **Customize…** opens the Keyboard Shortcuts editor filtered to `pdp.`.
- `Alt+P .` re-runs the last run.
- The layout menu also takes `J`/`K` for up/down, and `Tab` cycles the graph
  toolbar buttons (wrapping) with a visible focus outline; Enter activates the
  focused button.
- `Alt+P T` focuses the Tasks view (like `Alt+P P`).
- The task picker opens with the tree's task as the highlighted first entry —
  select a task (or one of its files) in the Tasks view, press `S`, hit Enter.
- The sidebar starts as 1:3 Tasks:Graph with Remote collapsed (initial layout
  only; VS Code remembers whatever you drag).
- Focused graph toolbar buttons show a visible ring — `:focus-visible`
  heuristics proved unreliable inside the webview, so the ring is now
  deterministic, with a fallback colour for themes without the token. The layout
  menu's focus outline got the same fallback.
- Saving or resetting the graph layout confirms on the status bar; reset names
  its target (saved default or the chosen automatic layout).
- Tab in the graph reliably focuses the toolbar buttons with a clear highlight:
  a document-level handler routes Tab into the buttons from anywhere in the
  webview, and the focused button takes the primary button colours with a 2px
  focus outline.
- In the Tasks view, `R`/`C`/`T`/`F`/`D`/`S`/`O` open the task picker on the row
  you arrowed to, so Enter confirms it (arrow-key focus used to be ignored
  unless the row was clicked).
