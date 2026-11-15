> Warning: This is a nearly 100% vibe-coded app. Or AI-engineered, depending on your preferences.

# pdp-vscode

Yes, but will it VScode?

This is a VScode implementation of the [pdp library](https://github.com/scienceandhumanitylab/pdp). Work in progress. Not yet available on VScode marketplace.

## Keyboard shortcuts

Chords start with `alt+p`. They are off while the integrated terminal has
focus, so they never fight the shell.

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
