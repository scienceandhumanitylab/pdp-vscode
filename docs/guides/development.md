## Development

```sh
# install pnpm
curl -fsSL https://get.pnpm.io | sh -

# clone repo
git clone https://github.com/scienceandhumanitylab/pdp-vscode.git
cd pdp-vscode pnpm install
```

- F5 or `Debug: Start Debugging` to launch development window. It opens with the
  demo fixture project (`src/test/fixtures/demo`). Open your own project with
  **File → Open Folder…** there.
- `Developer: Reload Window` in development window to update
- `pnpm test` to compile, lint and run the tests

### Publishing

Pushing a `v*` tag runs `.github/workflows/publish.yml`, which publishes to the
Marketplace with Trusted Publishing. Merging or pushing to `main` does not
publish. The workflow refuses tags on commits that aren't on `main`.

1. **Prepare the release on your branch.** Bump the version first (pnpm needs a
   clean tree), then rename `## [Unreleased]` in `CHANGELOG.md` to
   `## [x.y.z] - YYYY-MM-DD`, and commit both:

   ```sh
   pnpm version patch --no-git-tag-version
   # edit CHANGELOG.md
   git commit -am "x.y.z"
   git push
   ```

2. **Merge to `main`**, on GitHub or locally and push. Any merge method works.

3. **Tag `main` to publish:**

   ```sh
   git switch main
   git pull
   git tag vx.y.z
   git push origin vx.y.z
   ```

4. **Check the release** under the repo's Actions tab, then on the Marketplace
   listing.

5. **Start the next cycle.** Add a new empty `## [Unreleased]` section to
   `CHANGELOG.md` on your branch.

The Marketplace rejects a version that was already published, so always bump.
