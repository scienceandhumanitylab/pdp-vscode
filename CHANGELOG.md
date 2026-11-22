# Change Log

All notable changes to the "pdp" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how
to structure this file.

## [Unreleased]

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
