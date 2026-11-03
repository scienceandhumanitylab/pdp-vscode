# Step 5: pdp.ts, Tasks view, status bar, watcher, phase-1 commands

## What was done

- `src/pdp.ts`: binary from the `pdp.path` setting, `exec`/`spawnPdp` with
  argument arrays, `cwd` = workspace root and `COLUMNS=200`; `status()` via
  `pdp status --json`; `parseReport` for the `_print_report` lines
  (`Ran:`, `Current:`, `Failed:`, `No entrypoint (failed):`,
  `Skipped (upstream failed):`, `Ran but wrote nothing to output/:`);
  `reportFromOutput` merges the stdout/stderr halves; `versionAtLeast` for the
  ≥ 0.2.4 check with the `uv tool upgrade pdp` hint; output goes to the "PDP"
  Output channel.
- `src/tasksView.ts`: `PdpTasksProvider` + `TaskItem`. Topological order from
  status JSON, "stale"/"fresh" in the description plus a distinct icon per
  state (`$(sync)` amber / `$(check)` green via theme colours), children for
  depends on / entrypoint / slurm, click opens `task.yml`, `contextValue`
  `task`.
- `src/extension.ts`: version check on activate; status bar `PDP: N stale`
  (click = run all, warning background on error); FileSystemWatchers on
  `**/{input,src,output,hand}/**` and `**/*.yml` debounced 500 ms, one status
  call in flight (queued requests coalesce, manual-refresh error flag is
  carried through); refresh after every finished command; phase-1 commands:
  refresh, run all, Run… (task + option QuickPicks), run task / only / from
  here / force / on Slurm, clean task / all, validate, create, init,
  scaffold, open task.yml, reveal task folder. Task-scoped commands prompt
  with a QuickPick when run from the palette. Runs show progress with a
  cancel button (SIGINT to the process group) and a report notification with
  a "Show Output" action.

## Tests added

- `versionAtLeast` comparisons; `parseStatus` (order, flags, malformed
  rejection); `parseReport` full and false-positive (report-like task output
  before the trailing block); `reportFromOutput` merge; `reportSummary`;
  tree items: order, labels, description, contextValue, click command, child
  detail items, no-detail tasks.

## Review findings and resolution

Review subagent found 7 issues, all fixed:

1. Cancel signalled only the pdp pid, orphaning the task tree — verified live
   by the reviewer with `make`/`sleep`. Fixed: spawn `detached: true` and
   SIGINT the whole process group; re-verified live (pdp exits 130, no
   orphans).
2. `parseReport` matched prefixes anywhere in task output — now only the
   trailing contiguous report block is parsed.
3. Task ids from status JSON were joined into paths unvalidated —
   `taskFolder()` rejects ids containing `/`, `\` or `..`.
4. `spawnPdp` ran without a workspace root (silently inheriting the host cwd)
   — now rejects like `exec`.
5. A manual refresh queued behind a watcher refresh lost its
   notify-on-error flag — the flag is now carried through the queue.
6. `exec` mislabelled EACCES etc. as "pdp not found" — error now includes the
   real reason.
7. The watcher debounce timer could fire after disposal — cleared by a
   Disposable.

## Security and accessibility checks

- Argument arrays only, never shell strings; `pdp.path` treated as untrusted
  (failures surface with the OS reason).
- Task ids validated before path joins (no traversal out of the workspace).
- State shown as text ("stale"/"fresh") as well as icons/colour; all commands
  in the palette and reachable by keyboard (QuickPicks for task-scoped
  commands); status bar has name + tooltip; theme colours/icons only, no
  hard-coded colours.

## Deferred

- Remote view, Dagster and remote commands (step 6), graph webview (step 7),
  fixture-based integration tests and packaging (step 8).
- Slurm paths implemented but untested here (per instruction, user will test
  Slurm).
