#!/usr/bin/env bash
# Download a fixed version of gitleaks for Linux x64 into the given folder, and refuse it unless
# its checksum matches. Used by the Security workflow; locally, install gitleaks any way you like.
set -euo pipefail

dest="${1:?usage: install-gitleaks.sh <folder>}"
version="${GITLEAKS_VERSION:?set GITLEAKS_VERSION}"
sha256="${GITLEAKS_SHA256:?set GITLEAKS_SHA256}"
file="gitleaks_${version}_linux_x64.tar.gz"

work="$(mktemp -d)"
curl --fail --silent --show-error --location \
  --output "$work/$file" \
  "https://github.com/gitleaks/gitleaks/releases/download/v${version}/${file}"
echo "${sha256}  ${work}/${file}" | sha256sum --check --quiet
mkdir -p "$dest"
tar -xzf "$work/$file" -C "$dest" gitleaks
"$dest/gitleaks" version
