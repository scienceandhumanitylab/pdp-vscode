# Step 11: Tasks view file tree, delete task, and keybindings

## What was done

### pdp (separate commit)

pdp repo, branch `vscode-tweaks` (stacked on the unmerged `file-dependencies`),
commit `dc3cf39` "pdp delete, load without scaffolding, status survives dangling
deps", with a CHANGELOG entry there. This isn't pushed yet, and it reaches users
only in a pdp release after `file-dependencies` merges. There was no
`MIN_PDP_VERSION` bump: an older pdp answers "No such command 'delete'" and the
extension shows that error.

- `pdp delete <id>` (`PDP.delete_task`, `PDPConfig.remove_task`) removes
  `<root>/<id>` and the `pdp.yml` entry:
  - A missing folder still removes the entry.
  - It refuses with the list of dependents if another task depends on it.
  - It exits 1 on an unknown id.
  - It works on the unresolved path: a symlinked task folder loses only the
    link, never the target.
- `PDP.initialize()` only builds `Task` objects and no longer runs
  `create_task()`/scaffolding. A deleted folder therefore stays deleted.
  `pdp init` scaffolds listed tasks explicitly, keeping its documented
  behaviour.
- `TaskConfig` getters no longer raise `UninitializedProjectError` on a missing
  `task.yml`; they return the defaults. That makes a listed task with no folder
  show as `stale` with an empty config. It also covers the plan's `is_stale`
  item: a dependency with no `task.yml` has no deps and no outputs, so it is
  stale without any config read. `validate` still reports the empty config and
  missing folders.
- `ordered_tasks()` drops `depends_on` ids missing from `pdp.yml`, so `status`
  (which now uses it) and `tree` list the remaining tasks at exit 0. A cycle
  exits 1 with the validate-style message in both. `clean`/`freshen` turn the
  now-reachable `InvalidConfigError` (a missing task folder fails validation)
  into the validate message instead of a traceback.

### Extension

- `src/tasksView.ts`:
  - New `FileItem` (fs path, `resourceUri`, `ThemeIcon.Folder`/`File`); files
    open with `vscode.open`.
  - The root shows a `pdp.yml` row before the tasks.
  - A task shows its detail rows first, then its folder listing (folders first,
    then `localeCompare`), and folders recurse lazily.
  - A task is expandable if it has details or a folder.
  - Broken symlinks list as files.
  - `taskFolderPath()` is the shared id check: it rejects `/`, `\` and `..`, and
    is silent in the tree. `extension.ts`'s `taskFolder()` now wraps it and
    keeps the warning.
  - `missingTaskFolders()` is the pure orphan-id function.
- `pdp.deleteTask` ("PDP: Delete Task…", task context `5_delete@1`) runs via
  `withTask`, then a native modal naming the task and its folder. "Delete" runs
  `execSimple(["delete", id])`; cancel does nothing.
- Cleanup modal: after each successful refresh, `promptMissingFolders` offers
  one modal for listed tasks whose folder is missing.
  - Ids are remembered for the session as soon as they are asked about, whatever
    the answer, so neither a watcher refresh nor a refused delete loops the
    modal.
  - One prompt at a time.
  - Confirming re-checks each folder (one restored meanwhile by a git checkout
    is skipped), then deletes in reverse topological order so dependents go
    first, then refreshes once and reports.
  - `pdp.deleteTask` pre-dismisses its own id (the folder vanishes before
    `pdp.yml` is rewritten), and un-dismisses it if the folder survived (refused
    or failed).
- A failed refresh no longer blanks the views or forgets `lastStatus`, so
  dispatched ids keep working; this also closes step 10's nit 5. The error
  notification (with Show Output) fires when the message changes or when the
  user asked; `$(error) PDP` stays in the status bar.
- `contributes.keybindings`: `alt+p p|g|r` focus Tasks/Graph/Remote,
  `alt+p space` runs all stale; all gated `!terminalFocus` (run-all also
  `pdp.hasProject`).
- Docs: CHANGELOG, `CONTEXT.md` Tasks view, user guide (tree, delete, orphan
  prompt, error behaviour, keybindings, refresh limit).

## Tests added

- pdp `tests/test_cli.py` (330 passing, `ruff` clean). Each new test was seen
  failing against the old source.
  - delete: folder and entry gone; missing folder tolerated; dependents refused;
    unknown id; symlinked folder keeps its target.
  - A deleted folder stays deleted after `status`.
  - Dangling `depends_on` gives exit 0 with the rest listed, upstream first.
  - A cycle fails like validate in `status` and `tree`.
  - `init` scaffolds tasks in an existing `pdp.yml`.
  - `clean` with a missing folder gives the validation message.
- Extension (33 passing):
  - Tasks-view unit tests updated for the `pdp.yml` row and the folder listing.
  - `missingTaskFolders` as a pure function (including a traversal id).
  - A fixture tree test: `pdp.yml` first; `clean` shows `depends on`,
    `entrypoint`, then `input output src Makefile task.yml`; `output/` expands
    to `done.txt`, which opens with `vscode.open`.
  - The three `.focus` commands execute.
- Hand-tested only (prompt-gated, as with `pdp init`): the delete modal, the
  cleanup modal and the keybindings in the development host. **Not done yet in
  this session.**

## Review findings and resolution

A fresh-context review subagent read both diffs and the plan, and ran pytest,
`tsc` and lint.

1. **Critical:** `pdp delete` on a symlinked task folder emptied the symlink
   target outside the project, because `Task.task_directory` is resolved. Fixed:
   work on the unresolved `<root>/<id>`; unlink a symlink, rmtree only a real
   directory. Added a test.
2. The cleanup modal could delete a folder restored while it was open. Fixed:
   re-check existence after confirming.
3. `clean`/`freshen` on a project with a missing folder raised a traceback. This
   was newly reachable without load-time scaffolding. Fixed and tested.
4. `rmtree` `OSError` gave a traceback. Fixed: `pdp delete` catches it and exits
   1 with the message.
5. A refused delete silenced later cleanup prompts. Fixed: the id is
   un-dismissed if the folder still exists.
6. Deferred: the modal could warn about dependents before asking, since
   `depends_on` is in the status. pdp's refusal is shown, which is within spec.
7. Fixed: `tree` with a cycle raised a traceback.
8. Fixed: `lastError` reset when the project disappears.
9. Accepted: the tree follows symlinks, so `input/<dep>` shows the dependency's
   outputs. A link pointing outside the workspace would list outside files. They
   are only listed and opened in an editor, never written.

## Security and accessibility checks

- Task ids from pdp are untrusted. The tree and the folder lookups go through
  `taskFolderPath` (no separators or `..`). The delete and cleanup paths only
  dispatch ids that `withTask`/status validated, including step 10's
  `TASK_ID_PATTERN` for string args. Every pdp call uses an argv array.
- On the pdp side, `pdp.yml` task names are validated at load, so `delete` can't
  be pointed outside the project. Symlinks are unlinked, not followed.
- No webview changes and no new dependencies.
- Accessibility:
  - Tree rows have labels, tooltips (full path) and theme icons.
  - Delete and the cleanup prompt use native modals, which are
    keyboard-accessible and announced.
  - Delete is in the palette and the context menu.
  - The keybindings add keyboard access without replacing any. State still has
    text and icons, with no new colours.

## Follow-up: terminal confirmation, Delete in the graph menu

- `pdp delete` now asks
  `Delete task <id>: its folder <path> and its pdp.yml entry? [y/N]` unless
  `--yes`/`-y`. The unknown-id and dependents checks (`PDP.check_deletable`) run
  before the prompt, so a refused delete never asks. With no input (stdin
  closed) it aborts and exits 1. Tests cover yes, no, and refusal without a
  prompt.
- The extension passes `--yes` on both delete paths, because its native modal is
  the confirmation.
- The graph node menu gains **Delete…**, which dispatches `pdp.deleteTask` with
  the task id: the same string-id validation and the same modal as the Tasks
  view.
- `pdp_config.py`: the comment on the `TaskConfig` getters now explains why
  `@requires_initialization` was dropped.

## Deferred / known limits

- The watchers refresh `**/*.yml` and `**/{input,src,output,hand}/**`. Files
  created elsewhere in a task folder (for example the task root) need a manual
  Refresh to appear in the tree.
- A real pdp release is needed for users.
