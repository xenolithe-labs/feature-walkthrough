# Releasing

A release is a version tag. Pushing it runs `.github/workflows/release.yml`, which checks, builds
and publishes the package to npm with a provenance statement.

```sh
pnpm version 0.2.0 --no-git-tag-version   # or edit "version" in package.json
git commit -am "Release 0.2.0" && git push  # through a pull request, as usual
git tag v0.2.0 && git push origin v0.2.0    # once it is on main
```

The workflow refuses to publish when the tag and the version in `package.json` differ. To rehearse
without publishing, run the workflow by hand from the Actions tab and leave "dry run" ticked.

## Credentials

The workflow needs one secret, `NPM_TOKEN`, in the GitHub environment named `npm`. Nothing secret
is kept in this repository.

| Secret      | What it is                                                                      |
| ----------- | ------------------------------------------------------------------------------- |
| `NPM_TOKEN` | An npm granular access token that can publish the `feature-walkthrough` package |

### The npm token

On npmjs.com, under Access Tokens, create a **granular access token**:

- Packages and scopes: read and write. Before the first release the package does not exist yet, so
  the token has to cover all packages; afterwards replace it with one limited to
  `feature-walkthrough`.
- Bypass two-factor authentication: on. A workflow cannot answer a 2FA prompt.
- Expiration: as short as you are willing to rotate.

### From 1Password to GitHub

For maintainers who keep the token in 1Password, `scripts/secrets/with-op.sh` moves it to GitHub
without it touching the disk, the terminal or the clipboard.

1. Save the token in a 1Password item.
2. Copy `scripts/secrets/mapping.example.tsv` to `scripts/secrets/mapping.tsv` and put in the
   secret reference of the field (in 1Password: right-click the field, Copy Secret Reference).
   `mapping.tsv` is ignored by git, because it names your vault and items.
3. Check that it resolves, then push it:

```sh
scripts/secrets/with-op.sh check                   # names only, never values
scripts/secrets/with-op.sh github-sync --dry-run   # what would be set
scripts/secrets/with-op.sh github-sync             # creates the "npm" environment if needed
```

To rotate the token, replace the value in 1Password and run `github-sync` again.

The script needs the 1Password CLI (`op`) with the desktop-app integration switched on, `jq`, and
`gh` signed in with admin rights on the repository.

### Protecting the environment

In the repository settings, under Environments, `npm` can be limited to tags that match `v*` and
can require a reviewer's approval before each publish.

### Without a token

Once the package exists on npm, it can be published with no stored token at all: add this
repository and `release.yml` as a trusted publisher in the package's settings on npmjs.com, then
remove `NODE_AUTH_TOKEN` from the workflow and delete the secret.
