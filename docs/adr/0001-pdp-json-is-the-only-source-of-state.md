# pdp's `--json` output is the only source of project state

The extension gets Task status from `pdp status --json` and Remote status
from `pdp remote status --json`, both added to pdp for this purpose. It never
computes staleness, dependency order or remote state itself, and never parses
pdp's human-readable status output. Staleness depends on modification times,
upstream recursion and symlinks (`pdp/task.py`), and a second copy in
TypeScript would drift from pdp's answer.

## Considered Options

- **Reimplement staleness in TypeScript.** Rejected: two sources of truth.
- **Parse `pdp status` text.** Rejected: breaks whenever rich formatting or
  wording changes.
- **Run a Python snippet with the pdp tool's interpreter** (read from the
  `pdp` script's shebang) that imports pdp internals. Works with no pdp
  change, but ties the extension to private names like `flatten_tasks` and
  `is_stale`, and fails on Windows `.exe` launchers. Rejected once a `--json`
  flag proved small.

## Consequences

- The extension needs a pdp release with `--json`, and checks `pdp --version`
  on activation.
- One exception: the Result summary is read from the `Ran:` / `Failed:` /
  `Skipped …:` lines `pdp run` prints at the end. If that wording changes in
  pdp, the summary breaks, but project state does not, because a Refresh
  follows every command. If this hurts, add `--json` to `pdp run` too.
