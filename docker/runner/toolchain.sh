#!/usr/bin/env sh
# kernl-toolchain prints the runner image's own executable inventory as JSON.
#
# The image describes itself so Wharness never maintains a second, drifting
# copy of this list: `sandboxenv` runs this entrypoint once per image and
# publishes the result to the planner, which then proposes only executables
# that genuinely exist. Before this existed, plans routinely proposed absent
# tools and lost a whole request round trip to exit code 127.
#
# Output shape: {"tools":[{"name":"git","version":"2.39.5","path":"/usr/bin/git"}]}
# A tool that is absent is simply omitted — the planner treats the list as the
# closed set of available executables.
set -eu

first_line() {
  # Version banners are multi-line and noisy; the first line is the useful one.
  head -n 1 | tr -d '\r' | sed 's/[[:space:]]\{1,\}$//'
}

json_escape() {
  sed 's/\\/\\\\/g; s/"/\\"/g'
}

emit() {
  name="$1"
  shift
  path="$(command -v "$name" 2>/dev/null || true)"
  [ -n "$path" ] || return 0
  version="$("$@" 2>/dev/null | first_line || true)"
  [ -n "$version" ] || version="present"
  printf '%s{"name":"%s","version":"%s","path":"%s"}' \
    "$separator" \
    "$(printf '%s' "$name" | json_escape)" \
    "$(printf '%s' "$version" | json_escape)" \
    "$(printf '%s' "$path" | json_escape)"
  separator=','
}

printf '{"tools":['
separator=''

# Language toolchains and build drivers.
emit go go version
emit gofmt echo "bundled with go"
emit node node --version
emit npm npm --version
emit npx npx --version
emit yarn yarn --version
emit pnpm pnpm --version
emit make make --version
emit cc cc --version
emit g++ g++ --version
emit pkg-config pkg-config --version

# Source control and patching.
emit git git --version
emit patch patch --version
emit diff diff --version

# Structured-data and search tooling a verification step commonly needs.
# jq in particular was proposed by a real plan and did not exist, failing the
# request; it is now installed rather than merely denied.
emit jq jq --version
emit yq yq --version
emit rg rg --version
emit grep grep --version
emit sed sed --version
emit awk awk --version

# Archive and inspection utilities.
emit unzip unzip -v
emit zip zip -v
emit tar tar --version
emit xz xz --version
emit gzip gzip --version
emit file file --version
emit find find --version
emit sha256sum sha256sum --version
emit tree tree --version

printf ']}\n'
