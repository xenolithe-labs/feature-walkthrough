# Security checks

`.github/workflows/security.yml` runs on every pull request, on every push to `main`, and once a
week. Every job must pass.

| Job                          | Looks for                                                                                             | Tool                            |
| ---------------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------- |
| Secrets in the history       | Keys, tokens and passwords in any commit, including ones later removed                                | gitleaks                        |
| Secrets in what is published | The same, in the files of the npm package as built; and files that must never ship (`.env`, keys, …)  | gitleaks, `check-package-files` |
| Workflow files               | Actions not pinned to a commit, injection through `${{ }}`, wide permissions, leaked credentials      | zizmor                          |
| Dependencies                 | Known vulnerabilities in what is installed, and ones a pull request would add                         | `pnpm audit`, dependency review |
| Code analysis                | Injection, unsafe HTML, path handling and similar flaws in the TypeScript, and flaws in the workflows | CodeQL                          |

CodeQL files what it finds under **Security → Code scanning**. The other jobs fail with the finding
in their log.

## Run them locally

```sh
gitleaks git . --redact          # every commit (brew install gitleaks)
uvx zizmor .github/workflows     # the workflows (or: pipx run zizmor)
pnpm audit                       # dependencies
```

## When the secret scan flags a demo value

Demos show sample tokens, and a scanner cannot tell a sample from a real one. First check that the
value is published example data (an RFC's, or made up for the demo). Then add that one value to
`.gitleaks.toml` with a line saying where it comes from. Never allow a whole file or folder.

## If a real secret is committed

1. **Revoke it first**, where it was issued. Removing it from the repository does not help: the
   repository is public and the commit has been copied.
2. Issue a new one and store it outside the repository.
3. Remove it from the code in a normal commit. Rewriting history is optional once it is revoked.

## Rules for workflows

- Every action is pinned to a full commit hash, with the version in a comment. Dependabot proposes
  updates.
- `permissions` start at `contents: read`; a job asks for more only where it needs it, with a
  comment saying why.
- A checkout does not keep its token (`persist-credentials: false`).
- Values from an event (a branch name, a title) reach a script through `env`, never through
  `${{ }}` inside `run`.
- No `pull_request_target`.

## Settings on GitHub

These are repository settings, not files: secret scanning with push protection, Dependabot alerts
and security updates, private vulnerability reporting, and a rule on `main` that requires the `CI`
and `Security` checks.
