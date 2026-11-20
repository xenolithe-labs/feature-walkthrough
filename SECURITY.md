# Security

## Reporting a vulnerability

Please do not open a public issue. Use **Security → Report a vulnerability** on the
[repository](https://github.com/xenolithe-labs/feature-walkthrough/security/advisories/new), which
opens a private report that only the maintainers can read. Say what you found, how to reproduce it,
and which version you used. You should hear back within a week.

Only the newest published version is supported with fixes.

## What the project does to stay safe

- **No publish tokens.** Releases reach npm from one workflow that proves its identity to npm, and a
  maintainer approves each one with a hardware key. See [docs/release.md](docs/release.md).
- **Automated checks** on every pull request, on `main`, and weekly: secrets in the history and in
  the published files, code analysis, workflow analysis, and known vulnerabilities in dependencies.
  See [docs/security.md](docs/security.md).
- **A config is data.** The viewer renders a walkthrough config as text; it never runs code from one.
