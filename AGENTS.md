# AGENTS.md

## Before you start

- Read the plan in `docs/plans/` for the step you are on, and the decisions
  in `docs/adr/`. Follow them; when a change contradicts an ADR, stop and ask,
  or write a new ADR that supersedes it.

## Working loop, per plan step

1. **Test first.** Write a failing test for the behaviour, watch it go red,
   then write the smallest code that turns it green, then refactor.
2. **Format.** `pnpm exec prettier --write .`
3. **Verify.** `pnpm test` (compiles, lints, runs the suite). Commit only on
   green.
4. **Review.** Before approving a commit, hand the diff to a separate review
   subagent with fresh context. Address its findings, then re-run step 3.
5. **Report.** Write `docs/report/<step-number>-<slug>.md`: what was done,
   tests added, review findings and how they were resolved, security and
   accessibility checks performed, anything deferred.
6. **Commit.**

## Code style

- Self-documenting code: names carry the meaning. Write a comment only for a
  _why_ the code cannot express, in one line.

## Commits

- End every commit you make with a co-author trailer naming opencode and
  the model ID you are running as:
  `Co-authored-by: opencode (<model-id>) <219766164+opencode-agent[bot]@users.noreply.github.com>`
  for example `opencode (claude-opus-5-5)`. Keep the email exactly as shown;
  GitHub links co-authors by email.

## Security, every step

- Treat workspace files, `pdp` output and settings such as `pdp.path` as
  untrusted input.
- Spawn processes with an argument array, never a shell string.
- Webviews: strict Content-Security-Policy with a nonce, `localResourceRoots`
  limited to the extension's `media/`, and escape all data rendered into HTML.
- Add no runtime dependencies beyond those the plan allows.
- Note in the step report what was checked.

## Accessibility, every UI change

- Tree items, buttons and status bar entries have accessible labels and
  tooltips; every action is reachable by keyboard and the command palette.
- Use VS Code theme colours (`var(--vscode-*)`, `ThemeColor`) rather than hard-coded
  colours, so high-contrast themes work.
- Check contrast meets WCAG 2.2 AA (4.5:1 text, 3:1 large text and UI
  components) in light, dark and high-contrast themes, including Mermaid
  graph output.
- Convey state with text or icons as well as colour.
