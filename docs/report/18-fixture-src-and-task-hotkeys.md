# Step 18: fixture src scripts and task-bar hotkeys

## What was done

- **Fixtures** (`src/test/fixtures/demo/*`): every task's Makefile only
  delegates (`<id>:\n\tbash src/main.sh`); the output touch moved into a tracked
  `src/main.sh` (`clean` → `done.txt`, `import`/`filter`/`explore`/ `model` →
  `data.csv`, `report` → `report.txt`); `model` sleeps 3 s first. The empty
  untracked `src/main.py` files are gone.
- **Hotkeys** (`src/extension.ts`, `package.json`): `m` opens the task's
  Makefile or explains its absence; `M` opens it or confirm-creates the stub;
  `S` opens the src files or confirm-creates `src/main.sh`; `R`/`C`
  modal-confirm then run/clean the whole project. Task-scoped keys carry
  `{ selected: true }`; `R`/`C` take no argument. All five are in the `?` cheat
  sheet.
- The `run all` fixture test gained `.timeout(20000)` (model's sleep) and the
  `openTaskSrc` test restores `import/src/main.sh` in its `finally`.
- Docs: `CHANGELOG.md`, `docs/0002-hotkeys.md` section H, `docs/plans/PLAN.md`
  step 18.

Note: the extension-side of this step (commands, keybindings, cheat-sheet
entries) was already present uncommitted in the working tree from a prior
session; this step completed it with fixtures and tests.

## Tests added

- Keybinding exact-list test now pins m / shift+m / shift+s / shift+r / shift+c
  with the right `when` and args shapes.
- `runAllConfirm` / `cleanAllConfirm`: dismissed modal runs nothing; "Run all" /
  "Clean all" dispatch `pdp.runAll` / `pdp.cleanAll`.
- `openTaskMakefile`: opens the Makefile; info message when absent.
- `createTaskMakefile`: existing → opens without prompting; missing + dismissed
  → nothing written; missing + accepted → exact stub written and opened.
- `createTaskSrc`: same three-way behaviour for `src/main.sh`.
- Cheat-sheet test covers the five new keys.

## Review findings and resolution

A fresh-context review subagent found four issues; all addressed:

1. **Makefile content injection (security)**: the keybinding/QuickPick paths
   hand the task id over straight from pdp output, which is untrusted — an id
   containing `:` or a newline would have been interpolated into executable
   Makefile content. `createTaskMakefile` now validates the id against
   `TASK_ID_PATTERN` before writing anything.
2. **Crash on a missing task folder**: both create commands now check the folder
   exists and inform instead of throwing `ENOENT` (or silently scaffolding the
   whole folder in `createTaskSrc`'s case).
3. **Layout menu leaked focus on Left/Right** (step 19 fallout, fixed there):
   the open menu now closes deliberately on those keys.
4. Docs were missing the prettier pass — done.

## Security and accessibility checks

- Task ids from pdp output are validated (`TASK_ID_PATTERN`, `taskFolderPath`)
  before any path is built or any content is written; the created Makefile
  target is safe.
- No processes spawned by the new commands; file writes are two fixed stubs.
- All actions reachable from the command palette (QuickPick fallback) and the
  keyboard; no new colours, dialogs use standard VS Code modals.

## Follow-up: picker regression, skipped tests, running state

### Root cause of the "skipped tree-focus tests"

They were not environment drift. The same two tests fail at the previous commit
(`ccda568`) too, with `'import' !== 'clean'`. `'import'` is the first task in
the picker, so the toggle trick that reads the focused row found nothing and the
picker came up in plain order. The retry loops added here also ran past mocha's
2 s timeout, so they failed even when run on their own. The real bug was the
behaviour under test: step 16 made every task key open a picker (with the
highlighted task first) instead of acting on the task, unlike
`docs/0002-hotkeys.md` section C.

### What changed

- `taskFromArgOrPick`: a `{ selected: true }` key on a task row (or a file row
  inside a task) acts on that task directly, so `r` goes straight to
  `Run "clean"?`. The picker is left for rows with no task (`pdp.yml`) and the
  palette.
- The two skipped tests, the `focusTaskRow` retry helper and the retry loops are
  gone, replaced by `task keys act on the tree's task without a picker`
  (`reveal({ select, focus })`, then asserts the modal names the task and no
  picker opens; the `pdp.yml` row still opens the picker).
- `t` opens `task.yml` (user change to the cheat sheet; bound in
  `package.json`); `pdp.runToConfirm` is removed (Run to here stays on the
  context and graph menus). `T` (`pdp.createTaskYml`) opens `task.yml` or, after
  a modal, writes the stub `pdp create` writes. Makefile and task.yml creation
  share `createTaskFile`.
- `f` was checked: `freshenTask` already confirms with a modal.
- `o` (`pdp.revealTaskOutput`, reveal the task's `output/` folder) is removed
  entirely: command, keybinding, cheat-sheet entry and tests. `o` is now only
  the graph's zoom-out key, and the cheat-sheet test checks it stays out of the
  Tasks list. Report 16 still describes it as it was then.
- Running state: pdp prints nothing when a task starts, so a run records its
  scope (`runScope`: the tasks its arguments can touch) and `runningTaskIds`
  marks tasks in scope that are stale with all upstream fresh. The graph shows
  them yellow with a dashed border that pulses, a `⟳` marker and hover
  `(running)`; the tree shows a spinner and "running". The scope is dropped
  before the post-run refresh.
- Fixture: `input/` folders are now tracked with `.gitkeep` (`.gitignore`
  ignores only their contents). Without them `pdp run` fails validation on a
  fresh clone, so the earlier "self-contained in git" claim was wrong. The stale
  `clean/input/fetch` symlink is gone.

### Tests added

- `task keys act on the tree's task without a picker`.
- `createTaskYml opens existing, prompts before creating`.
- `a run marks model running while its script sleeps, then clears` (real pdp,
  the fixture's 3 s sleep).
- `runningTaskIds` (in scope / out of scope / stale upstream) and `runScope` (no
  ids, ids, `--to`, `--only`, `--from`, `--runner` value) unit tests; graph
  marker, class and hover text for running nodes.
- Keybinding and cheat-sheet tests updated for `t`/`T`. The cheat-sheet test now
  picks `r` by label, not by position.

### Review findings and resolution

1. Scope covered every stale task, so single-task runs marked unrelated tasks
   running: fixed with `runScope`.
2. `createTaskFile` checked and then wrote: it now writes with `flag: "wx"`, so
   it never follows or overwrites a file that appears while the modal is open.
3. Stale ✗/✓ comment and README wording: updated for ⟳ and the running state.
4. `refresh()` returned the in-flight call when another was already running, so
   its caller could continue while a queued refresh was still to come. That left
   the running marks briefly after a run, and made
   `the task picker defaults to the tree's selection context` flaky (1 run in 3
   failed): the late re-render dropped the selection the test had just made.
   Queued callers now wait for the re-run; 5 full runs in a row passed after.
5. Not changed: `pdp create` writes `name:` unquoted too, so the stub matches.
   The pulse cannot be paused (WCAG 2.2.2) apart from reduced motion; it lasts
   only as long as the run.

### Security and accessibility checks

- Task ids written into `task.yml` and the Makefile pass `TASK_ID_PATTERN`
  first; YAML injection is impossible with that pattern.
- No new processes; no new webview data paths (labels go through cytoscape's
  text rendering, as before).
- Running state is shown in text (`⟳`, "running", hover) and an icon, not only
  colour. Black on `#fabd2f` is about 12:1; the dark border outlines the node on
  light themes. The pulse honours `prefers-reduced-motion`.
- `T` is reachable from the keyboard, the `?` cheat sheet and the palette.
