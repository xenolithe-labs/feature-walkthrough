# Releasing

A release has two halves. A version tag makes GitHub build the package and **stage** it on npm.
Then a maintainer **approves** the staged version with their security key, and it goes live.

No npm token exists anywhere. npm trusts this repository's release workflow directly (trusted
publishing, over OpenID Connect), and the workflow is only allowed to stage, never to publish. A
leaked secret cannot ship a release, because there is no secret, and a compromised workflow cannot
either, because a person with a second factor has to approve.

## Cutting a release

```sh
pnpm version 0.2.0 --no-git-tag-version   # or edit "version" in package.json
git commit -am "Release 0.2.0" && git push  # through a pull request, as usual
git tag v0.2.0 && git push origin v0.2.0    # once it is on main
```

1. The tag runs `.github/workflows/release.yml`. It refuses to go on when the tag and the version
   in `package.json` differ, runs the checks, builds, and runs `npm stage publish`.
2. On npmjs.com, open the package's **Staged Packages** tab, look at what was staged, and click
   **Approve**. npm asks for your security key. From a terminal the same thing is
   `npm stage list feature-walkthrough`, then `npm stage approve <stage-id>`.

To rehearse without staging, run the workflow by hand from the Actions tab and leave "dry run"
ticked.

## Before a release

`pnpm release:check` does what the release workflow will do, and a little more, on your machine:
the checks, the full build, the browser tests, and a dry run of the publish that prints the
package's size and file count. Then try the package as a user would: `pnpm pack`, install the
tarball in an empty folder, and run `npx feature-walkthrough` there. Update `CHANGELOG.md` and the
version in `package.json` in the same commit.

## One-time setup

Do these once, in order, signed in to npm as an owner of the package with two-factor
authentication switched on.

1. **Create the package.** npm can only trust a workflow for a package that exists. From a clean
   checkout of the release commit:

   ```sh
   pnpm install --frozen-lockfile
   npm login                 # opens the browser; confirm with your security key
   npm publish               # builds through "prepack", then asks for the key again
   ```

   Then mark the commit: `git tag v0.1.0 && git push origin v0.1.0`. The release workflow runs,
   sees that 0.1.0 is already on npm, and stages nothing.

2. **Trust the workflow.** On npmjs.com, in the package's **Settings**, add a trusted publisher
   for GitHub Actions:

   | Field                | Value                                 |
   | -------------------- | ------------------------------------- |
   | Organization or user | `xenolithe-labs`                      |
   | Repository           | `feature-walkthrough`                 |
   | Workflow filename    | `release.yml`                         |
   | Environment name     | `npm`                                 |
   | Allowed actions      | staging only: leave `npm publish` off |

3. **Shut the token door.** In the package's **Settings**, under **Publishing access**, choose
   "Require two-factor authentication and disallow tokens", and delete any access token on your
   account that has "bypass 2FA".

4. **Protect the environment.** In this repository's settings, under Environments, limit `npm` to
   tags matching `v*`. The environment is created the first time the workflow runs.

## Other secrets

The release needs none. If the project ever needs a stored credential (for example for a
deployment), `scripts/secrets/with-op.sh` moves it from 1Password into a GitHub environment
without it touching the disk, the terminal or the clipboard:

```sh
cp scripts/secrets/mapping.example.tsv scripts/secrets/mapping.tsv   # ignored by git
scripts/secrets/with-op.sh check                   # names only, never values
scripts/secrets/with-op.sh github-sync --dry-run   # what would be set
scripts/secrets/with-op.sh github-sync
```

`mapping.tsv` holds 1Password secret references. It is ignored by git because it names your vault
and items.
