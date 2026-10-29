# Commands run as child processes, not in a terminal

The extension exists so users never touch a terminal, so it does not use
VS Code's Tasks API or integrated terminal for pdp commands. Each command is
spawned as a child process with an argument array. Its output goes to the
hidden "PDP" Output log, progress shows as a notification with Cancel
(SIGINT), and the result shows as a Result summary. Background processes
(`dagster dev`, `remote start`) are tracked by the extension, shown in the
Remote view with Open UI and Stop, and killed when the extension deactivates.

## Considered Options

- **Tasks API / terminal.** Gives colours, Ctrl-C and an exit event for free,
  but puts a terminal in front of the user, which is what the extension is
  meant to remove.

## Consequences

- Anything pdp would ask interactively must be asked in VS Code first and
  passed as a flag, e.g. `pdp init --name` from an input box. A new prompt in
  pdp would hang the child process.
- `COLUMNS` is set wide so rich does not wrap the lines the Result summary
  reads.
