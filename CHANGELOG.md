# Change Log

All notable changes to the "pdp" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [Unreleased]

- Initial release
- The graph moved from a separate editor panel into a **Graph view** in the
  PDP sidebar (below Tasks), drawn top-to-bottom to fit the narrow view.
- New **PDP: Run To Here** task command (`pdp run --to`): runs a task and
  everything upstream of it, which works even when upstream tasks are stale
  (where **Run Only This Task** refuses).
- Right-clicking a task in the Tasks view now has a labelled **Clean Task**
  entry in addition to the inline trash icon.
- Graph nodes are compact (`task ✗` / `task ✓`), colour-coded gruvbox-style
  red (stale) / blue (fresh), with snug boxes and a configurable font size
  (**`pdp.graphFontSize`**, default 14px, re-renders live) so more of the DAG
  fits the narrow sidebar; hovering a node shows its full state
  (stale/fresh).
- Right-clicking a graph node opens a menu of task actions (Run, Run only,
  Run to here, Run from here, Force run, Run on Slurm, Clean, Open task.yml,
  Delete…).
- The Tasks view starts with a `pdp.yml` row, and each task expands to its
  details and then its folder's files (folders first); click a file to open
  it.
- **PDP: Delete Task…** on a task's right-click menu: after a confirmation
  dialog, `pdp delete` removes the task's folder and its `pdp.yml` entry.
  Needs a pdp with `pdp delete`.
- Tasks listed in `pdp.yml` whose folder is missing get one dialog per session
  offering to remove them from `pdp.yml`.
- A failed refresh keeps the last good tasks and graph on screen instead of
  emptying the sidebar, and shows an error notification whenever the error
  changes.
- Keyboard chords: `Alt+P P` Tasks, `Alt+P G` Graph, `Alt+P R` Remote,
  `Alt+P Space` run all stale (not while the terminal has focus).
