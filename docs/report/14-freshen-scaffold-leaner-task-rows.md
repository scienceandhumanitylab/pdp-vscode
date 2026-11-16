# Step 14: freshen UI, scaffold in the missing-folder dialog, leaner task rows

## What was done

Implements plan step 14 against pdp 0.2.5 (`pdp freshen`, load-without-
scaffold, validate warnings). Plan-mode discussion added a user decision:
the Tasks view's `depends on:` / `entrypoint:` rows are removed entirely —
task.yml, one click away, is where they are read.

- **Freshen**: `pdp.freshenTask` ("Freshen Task (and Downstream)",
  `pdp freshen <id>`) and `pdp.freshenOnly` (`pdp freshen <id> --only`) on
  the task context menu (group `6_freshen`), the graph node menu and the
  palette. A modal confirms and says outputs are not recomputed.
  `parseFreshen` (src/pdp.ts) reads `Freshened:` / `Still stale:` /
  `Freshening made other tasks stale:`; `notifyFreshenResult` shows the
  summary and, after a real freshen, a **Freshen Downstream** button running
  `pdp freshen --from <first>` (pdp's own suggestion). Exit 1 with a report
  (still stale) is a warning; a bare non-zero exit (stale upstream, empty
  `output/`) is an error.
- **Missing-folder dialog**: now offers **Scaffold** (recreate the folders
  from `pdp.yml`) before **Remove**, matching 0.2.5's load-without-scaffold.
- **Validate**: `validateProject` shows pdp's stdout `Warning:` lines (e.g.
  a `depends_on` pattern matching no files) as a warning instead of hiding
  them behind "Valid project".
- **Task rows**: `depends on:` / `entrypoint:` rows and their tooltip lines
  removed (src/tasksView.ts); slurm stays. `hasDetail` is slurm-only.
  Showing `dependency_entries` is moot with the rows gone.
- The uncommitted long-entrypoint experiment in
  `src/test/fixtures/demo/import/task.yml` was reverted (`git checkout`) —
  it broke every run-based fixture test; the sidebar no longer shows
  entrypoints at all, which was its point.
- Docs: guide (task menu, first-use, missing-folder, validate, graph menu),
  CHANGELOG, CONTEXT (freshen/delete added to one-off commands), PLAN step
  14.

## Tests added

- `parseFreshen` unit tests: full report (stdout + stderr halves) and the
  "Nothing to freshen." no-op.
- Fixture: `freshen marks a stale task fresh without running it` — makes
  `import` stale via `utimes` on its Makefile, freshens `--only`, asserts
  exit 0, `{freshened: ["import"], newlyStale: ["clean"]}` and the resulting
  status (import fresh, clean stale).
- Fixture: `freshen reports tasks that stay stale instead of failing
  silently` — a future-dated Makefile pins the exit-1-with-report contract
  (`stillStale: ["import"]`), then restores the fixture mtime.
- Tasks view: `task children show slurm flags only` (details = slurm row;
  tooltip free of depends on/entrypoint); fixture tree test asserts
  children are folder files only.
- The registration test still gates every new command (it enumerates
  package.json).

Red → green: `parseFreshen` tests failed to compile first; the tasks-view
and fixture expectations failed at runtime until the code changed.
`pnpm test`: 38 passing; `prettier --check .` clean.

## Review findings and resolution

Fresh-context subagent reviewed the diff against the pdp 0.2.5 source and
probed the real CLI in a scratch copy of the fixture. Correctness and
behavior/regression categories passed (freshen arg shapes, all five output
line shapes, exit-code split, validate warnings on stdout; no dangling
references to the removed rows; no promptMissingFolders re-entrancy).
Findings:

1. The Freshen Downstream button passed a parsed (untrusted) id to pdp
   ungated — fixed: it must pass `TASK_ID_PATTERN` like every dispatched id.
   The reviewer verified typer consumes it as `--from`'s value, so nothing
   was exploitable today; this is defense-in-depth.
2. PLAN.md had a prettier violation from a post-format edit — fixed; the
   final run is `prettier --check .` clean.
3. The button was offered even when nothing was freshened, where
   `--from <id>` is guaranteed to refuse on the still-stale upstream —
   fixed: offered only after a real freshen.
4. Long id lists truncate in notifications (rich wraps at COLUMNS=200) —
   accepted, same class as parseReport's documented shortcut; the button id
   is always on the first line. Noted under Security.
5. Exit-1-with-report contract unpinned — fixed (the future-dated fixture
   test above).
6. Untracked `LICENSE` — left out of this commit deliberately.

## Security checks

Task ids reach pdp as bare argv words everywhere; the one new path that
re-dispatches an id parsed from pdp output (Freshen Downstream) now passes
the same `TASK_ID_PATTERN` gate as user-picked ids. Argument arrays only,
no shell strings, no new dependencies, no webview changes. Freshen's
notification renders ids as notification text only (no HTML). Truncation of
very long id lists in notifications is display-only (finding 4).

## Accessibility

Commands are in the palette and context menus; the freshen modal names the
task and the exact effect. State changes still surface through
notifications and the stale/fresh labels with distinct icons, never colour
alone. No hard-coded colours introduced.

## Deferred

- No "freshen all" entry: bare `pdp freshen` at the project root was not
  verified against 0.2.5, and freshening everything in one click is easy to
  regret; the per-task paths cover the described use case.
- `pdp freshen --from`/`--to` are reachable only through the Freshen
  Downstream button, not as palette commands; add if users ask.
- The modal and notification UI are hand-tested in the development host,
  per the repo's prompt-gating convention.
