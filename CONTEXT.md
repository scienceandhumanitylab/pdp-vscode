# pdp-vscode

A VS Code extension that puts every `pdp` command behind the sidebar, buttons
and notifications, so a user can work on a pdp project without a terminal.

pdp's own terms (**Task**, **Task ID**, **Dependency**, **Stale**,
**Entrypoint**, **Selection**, **Runner**, **Remote**, **Local mode / Slurm
mode**) keep the meanings in [pdp's CONTEXT.md](../pdp-utils/CONTEXT.md). This
file only adds the extension's terms.

## Language

### Project

**Project**:
The pdp project open in VS Code, identified by a `pdp.yml` at the workspace
root. There is exactly one per workspace. See
[ADR-0003](docs/adr/0003-one-project-per-workspace-at-the-root.md).
_Avoid_: Workspace (the VS Code container, which may hold other things),
repo.

**Task status**:
What the extension knows about every task at one moment: its ID, whether it
is stale, its dependencies, description, entrypoint and Slurm flags. Always
whatever pdp last reported, never computed by the extension. See
[ADR-0001](docs/adr/0001-pdp-json-is-the-only-source-of-state.md).
_Avoid_: Cache, model, state (unqualified).

**Remote status**:
What pdp last reported about the project's Remote: host, whether the project
has been pushed, whether a session or run is going, the last run's result,
and pdp's Slurm jobs. Only fetched when the user asks, because each check
goes over SSH.
_Avoid_: Cluster status, connection.

**Refresh**:
Asking pdp for a new Task status. Happens on file changes in a task, after
every command finishes, and on request.
_Avoid_: Reload, sync (sync means push/pull to the Remote).

### Commands

**Command**:
A pdp CLI call started from a button, menu or the command palette. Every
pdp feature is reachable as a command.
_Avoid_: Action, job (job is a Slurm term).

**One-off command**:
A command that finishes on its own (`run`, `clean`, `validate`, `create`,
`scaffold`, `remote push|pull|run|stop`). Shows progress with a Cancel
button and ends with a Result summary.
_Avoid_: Short command, task (Task is pdp's unit of work).

**Background process**:
A command that keeps going until the user stops it: local Dagster
(`dagster dev`) or the Remote tunnel (`remote start`). Listed in the sidebar
with Open UI and Stop, and stopped when VS Code closes. Stopping the tunnel
does not stop the Remote session.
_Avoid_: Server, daemon, long-running command.

**Result summary**:
The notification shown when a one-off command ends: which tasks ran, were
current, failed, had no entrypoint or were skipped, as pdp reported them.
_Avoid_: Run report (pdp's name for the data the summary is built from),
toast.

**Output log**:
The hidden "PDP" Output panel holding the full text of every command. Opened
only when the user asks, or from a failed Result summary.
_Avoid_: Terminal, console.

### Views

**Tasks view**:
The sidebar list of every task in dependency order, showing whether each is
stale, with run and clean buttons per task.
_Avoid_: Task tree (the `pdp tree` output), explorer.

**Remote view**:
The sidebar list showing the Remote status and the Background processes.
_Avoid_: Cluster view, Slurm view.

**Graph view**:
The sidebar view that draws the dependency graph of all tasks, top to bottom,
each marked stale or fresh. Clicking a task opens its `task.yml`; right-clicking
opens its task menu.
_Avoid_: Tree, DAG view, diagram.
