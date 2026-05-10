# Releasing CodeBurn

This document describes the actual steps a maintainer takes to cut a CLI or macOS menubar release. CLI releases are run by hand with `npm publish`; macOS menubar releases are automated by `.github/workflows/release-menubar.yml` when a `mac-v*` tag is pushed.

## Versioning

CodeBurn uses semantic versioning (major.minor.patch). The CLI and macOS menubar share the same version number for clarity.

## Before Every Release

Run the test suite to catch any regressions:

```bash
npm test
```

Verify that the build completes without errors:

```bash
npm run build
```

## CLI Release Process

### 1. Update the Version

Edit `package.json` to bump the version number. Update both the `version` field at the top and the `package-lock.json` lockfile to match (npm handles this automatically):

```bash
npm version <version>
```

For example, `npm version 0.9.8` updates both files and creates a commit.

Alternatively, edit `package.json` by hand and run `npm install` to regenerate the lockfile with the new version.

### 2. Update the Changelog

Edit `CHANGELOG.md`. Move all changes from the "Unreleased" section into a new section with the version number and today's date:

```markdown
## Unreleased

### ...

## 0.9.8 - 2026-05-10

### Added
- Feature X

### Fixed
- Bug Y
```

Commit these changes:

```bash
git add CHANGELOG.md package.json package-lock.json
git commit -m "chore: bump to 0.9.8"
```

### 3. Publish to npm

There is no GitHub Actions workflow for the CLI; the maintainer runs `npm publish` from a clean working tree:

```bash
npm publish
```

The `prepublishOnly` script in `package.json` runs `npm run build` first, which bundles the litellm pricing snapshot and then runs `tsup` to emit `dist/cli.js`.

If publishing for the first time on a new machine, run `npm login` first.

### 4. Tag the Release

After npm accepts the publish, tag the commit and push:

```bash
git tag v0.9.8
git push origin v0.9.8
```

The tag is for human reference and to anchor the GitHub Release. No workflow runs on `v*` tags for the CLI today.

### 5. Verify npm Publication

```bash
npm view codeburn version
```

### 6. Create a GitHub Release

Use the GitHub CLI to create a release with notes from the changelog:

```bash
gh release create v0.9.8 --title v0.9.8 --notes "$(sed -n '/^## 0.9.8/,/^## /p' CHANGELOG.md | head -n -1)"
```

Or use the web interface to draft a release and copy the changelog section into the body.

## macOS Menubar Release Process

The macOS menubar is released separately with its own GitHub Release, but shares the same version number as the CLI.

### 1. Same Version Bump

Follow the same version bumping process as the CLI. Both `package.json` and `CHANGELOG.md` reflect the shared version.

### 2. Tag the macOS Release

After the CLI tag is published, create a separate tag for the menubar:

```bash
git tag mac-v0.9.8
git push origin mac-v0.9.8
```

### 3. GitHub Actions Builds the Bundle

The `.github/workflows/release-menubar.yml` workflow automatically detects the `mac-v*` tag and:

1. Checks out the repo
2. Runs `mac/Scripts/package-app.sh 0.9.8`
3. Signs the app bundle (ad-hoc signing)
4. Creates a zip file: `CodeBurnMenubar-0.9.8.zip`
5. Computes a SHA-256 checksum: `CodeBurnMenubar-0.9.8.zip.sha256`
6. Uploads both to a GitHub Release named "Menubar v0.9.8"

The script output on the build machine shows:

```
✓ Built /path/mac/.build/dist/CodeBurnMenubar-0.9.8.zip
✓ Checksum /path/mac/.build/dist/CodeBurnMenubar-0.9.8.zip.sha256
<sha256-hash>  CodeBurnMenubar-0.9.8.zip
```

No manual action is needed; the workflow handles everything.

### 4. Verify the Release

After the workflow completes, the GitHub Release page shows the zip and sha256 files. The menubar installer command in the CLI calls `npx codeburn menubar`, which fetches the latest release from GitHub and installs it into `~/Applications`.

## Homebrew Tap Update

The Homebrew tap lives at `https://github.com/getagentseal/homebrew-codeburn`. A maintainer with access to that repository must manually update the formula.

### 1. Fetch the npm Tarball

When the CLI is published to npm, get its download URL and SHA-256 hash:

```bash
npm view codeburn@0.9.8 dist.tarball
npm view codeburn@0.9.8 dist.shasum
```

This returns a URL like `https://registry.npmjs.org/codeburn/-/codeburn-0.9.8.tgz` and a SHA-256 hash.

Alternatively, compute the hash yourself:

```bash
curl -sL https://registry.npmjs.org/codeburn/-/codeburn-0.9.8.tgz | shasum -a 256
```

### 2. Update the Formula

Edit `Formula/codeburn.rb` in the homebrew-codeburn tap:

```ruby
class Codeburn < Formula
  desc "See where your AI coding tokens go"
  homepage "https://github.com/getagentseal/codeburn"
  url "https://registry.npmjs.org/codeburn/-/codeburn-0.9.8.tgz"
  sha256 "<computed-hash>"
  license "MIT"

  depends_on "node"

  def install
    system "npm", "install", *Language::Node.std_npm_install_args(libexec)
    bin.install_symlink Dir[libexec/"bin/*"]
  end

  test do
    system "#{bin}/codeburn", "--version"
  end
end
```

Update the `url` and `sha256` fields with the new version's values.

### 3. Test Locally

Before pushing, test the formula locally:

```bash
brew install --build-from-source Formula/codeburn.rb
codeburn --version
```

### 4. Commit and Push

Commit the formula change:

```bash
git add Formula/codeburn.rb
git commit -m "codeburn: bump to 0.9.8"
git push origin main
```

Users can now install with:

```bash
brew tap getagentseal/codeburn
brew install codeburn
```

Or upgrade an existing installation:

```bash
brew upgrade codeburn
```

## Replacing Assets on an Existing Release

If a release is published with broken assets (e.g., a menubar zip with a build error), re-run the build and upload the fixed assets without creating a new tag.

Use `gh release upload` with the `--clobber` flag to overwrite existing files:

```bash
# After re-running mac/Scripts/package-app.sh 0.9.8 to regenerate the zip and sha256
gh release upload mac-v0.9.8 mac/.build/dist/CodeBurnMenubar-0.9.8.zip --clobber
gh release upload mac-v0.9.8 mac/.build/dist/CodeBurnMenubar-0.9.8.zip.sha256 --clobber
```

The GitHub Release page will now serve the fixed assets. The menubar installer fetches from the Release by tag, so users who run `npx codeburn menubar` after the replacement get the fixed version automatically.

## Rollback

If a released version has a critical bug, the fastest path is to fix the bug and cut a new patch release (e.g., 0.9.8 -> 0.9.9). Delete the broken tag locally and on GitHub if it has not yet been widely distributed:

```bash
git tag -d v0.9.8
git push origin --delete v0.9.8
```

npm does not allow republishing to the same version. If you must unpublish from npm, use `npm unpublish codeburn@0.9.8 --force` (requires Owner role), but this is discouraged and all users who installed that version retain it.

For the menubar, tag a new mac-v0.9.9 and let the workflow build and upload it. Users will see the update pill in the menubar settings and upgrade automatically (or manually via `npx codeburn menubar --force`).

## Summary

The CLI release is manual: bump the version, update `CHANGELOG.md`, commit, run `npm publish`, then tag and create a GitHub Release. The macOS menubar release is automated: pushing a `mac-v*` tag fires `.github/workflows/release-menubar.yml`, which builds, signs, zips, and publishes the bundle. The Homebrew formula at `getagentseal/homebrew-codeburn` is updated by hand after each CLI publish.
