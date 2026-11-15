#!/usr/bin/env bash
# Pin the Dockerfile to an upstream CLIProxyAPI release and check the backend patches.
# Usage: scripts/update-backend.sh [vX.Y.Z]   (default: latest v8 release tag)
set -euo pipefail
cd "$(dirname "$0")/.."

upstream=https://github.com/router-for-me/CLIProxyAPI.git
image=eceasy/cli-proxy-api

tag=${1:-$(git ls-remote --tags --refs --sort=-version:refname "$upstream" 'v8.*' \
  | head -1 | sed 's#.*refs/tags/##')}
[[ $tag =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "Invalid release tag: $tag" >&2; exit 1; }

# The peeled entry (^{}) of an annotated tag is listed last.
commit=$(git ls-remote "$upstream" "refs/tags/$tag" "refs/tags/$tag^{}" | tail -1 | cut -f1)
[[ $commit =~ ^[0-9a-f]{40}$ ]] || { echo "Tag $tag not found upstream" >&2; exit 1; }
digest=$(docker buildx imagetools inspect "$image:$tag" | awk '/^Digest:/ {print $2; exit}')
[[ $digest =~ ^sha256:[0-9a-f]{64}$ ]] || { echo "Image $image:$tag not found" >&2; exit 1; }

mapfile -t patches < <(grep -m1 '^COPY backend-patches/' Dockerfile | grep -o 'backend-patches/[^ ]*\.patch')

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
git -C "$work" init -q
git -C "$work" fetch -q --depth 1 "$upstream" "$commit"
git -C "$work" checkout -q --detach FETCH_HEAD
for patch in "${patches[@]}"; do
  if ! git -C "$work" apply "$PWD/$patch"; then
    echo "$patch does not apply to $tag. Rebase it (see FORK.md); Dockerfile left unchanged." >&2
    exit 1
  fi
done
if command -v go >/dev/null; then
  (cd "$work" && go test ./internal/runtime/executor/helps \
    && go test ./sdk/cliproxy/auth -run 'QuotaRecheck|CapQuotaCooldown')
else
  echo "go not found: patch tests will run in the image build only." >&2
fi

sed -i -E \
  -e "s/^ARG BACKEND_COMMIT=.*/ARG BACKEND_COMMIT=$commit/" \
  -e "s/main\.Version=v[0-9.]+-triggerlab/main.Version=$tag-triggerlab/" \
  -e "s#^FROM $image:[^ ]+#FROM $image:$tag@$digest#" \
  Dockerfile
echo "Pinned backend $tag ($commit), base image $digest."
