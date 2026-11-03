# Step 4: Extension scaffold cleanup

## What was done

- Removed the hello-world command and `src/treeDataProvider.ts` (node
  dependencies example).
- `package.json`: real `displayName`/`description`, publisher, activation via
  `workspaceContains:pdp.yml`, activity-bar container `pdp` with a Tasks view
  and a Remote & Processes view, `viewsWelcome` (Init project button, shown
  when `!pdp.hasProject`), all 28 commands from the plan's command table,
  `menus` for `view/title`, `view/item/context` (`viewItem == task|process`)
  and configuration for `pdp.path` and `pdp.dagsterPort`.
- Icons are codicons (`$(play)`, `$(trash)`, `$(type-hierarchy)`, ...) except
  the activity-bar container, which requires an SVG: `media/pdp.svg`, a
  monochrome `currentColor` 24×24 DAG mark.
- `src/extension.ts` registers stub handlers for every contributed command
  (real implementations are steps 5-7), creates both tree views, and sets the
  `pdp.hasProject` context key from `pdp.yml` presence.
- `src/test/extension.test.ts` activates the extension and asserts every
  command in `package.json` is registered (reads the manifest, so it cannot
  drift).

## Tests added

- Extension activation + full command registration (reads
  `contributes.commands` from package.json).

## Review findings and resolution

Review subagent (fresh context) found four items, all addressed:

1. `pdp.dagsterLocal`/`pdp.remoteStart` lacked icons — icon-only navigation
   buttons would render blank. Added `$(rocket)` / `$(globe)`.
2. `pdp.hasProject` was set but unused, so the welcome view could show in a
   project workspace. Added `"when": "!pdp.hasProject"` to `viewsWelcome`.
3. `docs/plans/.PLAN.md.swp` must not be committed — added `*.swp` to
   `.gitignore`.
4. Command list duplicated in test and extension — the test now reads the
   manifest instead.

## Security and accessibility checks

- No webviews yet (graph webview is step 7, CSP noted there).
- No child processes yet (step 5+).
- All buttons/tooltips use codicons and command titles; every action is in the
  command palette; task-scoped commands prompt for a task when invoked from
  the palette (step 5).
- No hard-coded colours; theme icons only.

## Deferred

- Real command implementations (steps 5-7), graph webview (step 7), fixture
  tests and packaging (step 8).
