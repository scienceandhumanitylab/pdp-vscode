> Warning: This is a nearly 100% vibe-coded app. Or AI-engineered, depending on
> your preferences.

# pdp-vscode

Yes, but will it VScode?

This is a VScode implementation of the
[pdp library](https://github.com/scienceandhumanitylab/pdp). Work in progress.

## Installation

Not yet available on VScode marketplace. Until then, install locally:

```sh
# clone repository to your machine
git clone https://github.com/scienceandhumanitylab/pdp-vscode.git
cd pdp-vscode

# install extension with pnpm (or npm or what have you)
pnpm install

# package it, install into vscode
pnpm exec vsce package --no-dependencies
code --install-extension pdp-0.0.1.vsix
```

## Usage

Open the task view either from the command palette (`PDP: Focus on Tasks View`)
or with the `alt + p,  p` chord. From here, you can initialize a project, in the
tasks view. Then you can create tasks and edit the `task.yml` files to include
entrypoints. Tasks can be run, cleaned, and freshened either from the task view
by clicking the buttons, or by right clicking on a task.

As you add tasks and dependencies, the Graph view should show the DAG of tasks
in your project. You can click on a task to open its `task.yml` file, or right
click on a task to open the command palette of actions for that task. The graph
can be zoomed, dragged, rearranged, and you can set a preference for layout, all
using the included buttons.

### Keyboard shortcuts

Chords start with `alt+p`. They are off while the integrated terminal has focus,
so they never fight the shell.

| Keys                 | Action                |
| -------------------- | --------------------- |
| `alt+p` then `p`     | Focus the Tasks view  |
| `alt+p` then `g`     | Focus the Graph view  |
| `alt+p` then `r`     | Focus the Remote view |
| `alt+p` then `space` | Run all stale tasks   |

## Development

```sh
# install pnpm
curl -fsSL https://get.pnpm.io | sh -

# clone repo
git clone https://github.com/scienceandhumanitylab/pdp-vscode.git
cd pdp-vscode
```

- F5 or `Debug: Start Debugging` to launch development window
- `Developer: Reload Window` in development window to update
