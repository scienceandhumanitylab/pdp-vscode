# One project per workspace, with `pdp.yml` at the root

The extension activates on `workspaceContains:pdp.yml`, runs every pdp
command with the first workspace folder as its working directory, and shows a
single Tasks view. It does not look for `pdp.yml` in subfolders or other
workspace folders. One project per workspace is how pdp projects are used
today, and supporting several would add a project picker to every command and
view. Multi-root or nested projects would need a new ADR.
