#!/usr/bin/env bash
# Download MxBuild (it contains modeler/mx) for one exact Mendix version from the Mendix CDN, for mx check on Linux.
#
#   bash scripts/get-mxbuild.sh <version> [root]     root: default $MXBUILD_ROOT or ~/.mendix/mxbuild
#
# Installs into <root>/<version>/ (mxlocal finds ~/.mendix/mxbuild/<version>/modeler/mx by itself) and prints the mx
# path as the LAST line of stdout; everything else goes to stderr, step by step.
# Writes to $GITHUB_OUTPUT (when set): mx, version (the CDN's full version), dotnet (the .NET runtime version mx
# needs when it is not self-contained, else empty).
#
# CDN names (from mendixlabs/mxcli, docker/download.go + version_resolve.go):
#   https://cdn.mendix.com/runtime/mxbuild-<version>.tar.gz        (x86_64; arm64: arm64-mxbuild-<version>.tar.gz)
#   Mendix 9/10 use four parts (10.24.0.73019), Mendix 11 three (11.12.2). A three-part 9/10 version is resolved
#   through the bucket listing https://cdn.mendix.com/?list-type=2&prefix=runtime/mxbuild-<version>. (highest build).
set -euo pipefail

log() { printf '%s\n' "$*" >&2; }
V="${1:?usage: get-mxbuild.sh <mendix version> [root]}"
ROOT="${2:-${MXBUILD_ROOT:-$HOME/.mendix/mxbuild}}"
case "$(uname -m)" in aarch64 | arm64) STEM="arm64-mxbuild-" ;; *) STEM="mxbuild-" ;; esac
CDN="https://cdn.mendix.com"
out() { [ -n "${GITHUB_OUTPUT:-}" ] && printf '%s=%s\n' "$1" "$2" >> "$GITHUB_OUTPUT"; return 0; }

find_mx() { find -H "$1" -maxdepth 4 -type f -name mx -path '*/modeler/mx' 2>/dev/null | head -n1; }

mx=""
if [ -d "$ROOT/$V" ]; then mx="$(find_mx "$ROOT/$V")"; fi
if [ -n "$mx" ]; then
    log "MxBuild $V already installed (cache): $mx"
    FULL="$V"
else
    FULL="$V"
    url="$CDN/runtime/$STEM$V.tar.gz"
    log "Looking for MxBuild $V: $url"
    code="$(curl -sS -o /dev/null -w '%{http_code}' -I "$url" || true)"
    log "  HEAD -> HTTP $code"
    if [ "$code" != 200 ]; then
        # three-part 9.x/10.x versions: the CDN names them with the build number; take the highest
        list="$CDN/?list-type=2&prefix=runtime/$STEM$V."
        log "  not under that name; listing $list"
        keys="$(curl -fsS "$list" | grep -o "<Key>runtime/$STEM$V\.[0-9]*\.tar\.gz</Key>" || true)"
        log "  found: $(printf '%s' "$keys" | sed 's/<[^>]*Key>//g' | tr '\n' ' ')"
        build="$(printf '%s\n' "$keys" | sed -n "s/.*$STEM$V\.\([0-9]*\)\.tar\.gz.*/\1/p" | sort -n | tail -n1)"
        [ -n "$build" ] || { log "ERROR: no MxBuild archive for Mendix $V on $CDN (HTTP $code, listing empty)"; exit 1; }
        FULL="$V.$build"
        url="$CDN/runtime/$STEM$FULL.tar.gz"
        log "  resolved to $FULL: $url"
    fi
    tmp="$(mktemp -d)"
    trap 'rm -rf "$tmp"' EXIT
    log "Downloading $url"
    curl -fL --retry 3 --retry-delay 5 -sS -o "$tmp/mxbuild.tar.gz" "$url"
    log "  $(du -h "$tmp/mxbuild.tar.gz" | cut -f1), sha256 $(sha256sum "$tmp/mxbuild.tar.gz" | cut -c1-16)..."
    # the CDN has a .sha256 next to each archive (mxcli): compare when it is there
    if curl -fsS -o "$tmp/sum" "$url.sha256" 2>/dev/null; then
        want="$(grep -o '[0-9a-f]\{64\}' "$tmp/sum" | head -n1)"
        have="$(sha256sum "$tmp/mxbuild.tar.gz" | cut -d' ' -f1)"
        if [ -n "$want" ] && [ "$want" != "$have" ]; then log "ERROR: sha256 mismatch (CDN $want, download $have)"; exit 1; fi
        log "  sha256 matches $url.sha256"
    else
        log "  (no .sha256 next to the archive)"
    fi
    dest="$ROOT/$FULL"
    rm -rf "$dest"
    mkdir -p "$dest"
    log "Extracting to $dest"
    tar -xzf "$tmp/mxbuild.tar.gz" -C "$dest"
    log "  top level: $(ls "$dest" | head -n 12 | tr '\n' ' ')"
    mx="$(find_mx "$dest")"
    [ -n "$mx" ] || { log "ERROR: no modeler/mx in the archive"; find "$dest" -maxdepth 3 -name 'mx*' >&2; exit 1; }
    # mxlocal finds <root>/<version>/modeler/mx: the version the .mpr names must be in the path
    if [ "$FULL" != "$V" ] && [ ! -e "$ROOT/$V" ]; then ln -s "$dest" "$ROOT/$V"; log "  linked $ROOT/$V -> $dest"; fi
fi
chmod +x "$mx" 2>/dev/null || true
log "mx: $mx"
log "  $(file -b "$mx" 2>/dev/null || echo '(file not installed)')"

# .NET: a framework-dependent mx needs the runtime its runtimeconfig.json names; a self-contained one lists
# "includedFrameworks" (or has no runtimeconfig at all)
dotnet=""
cfg="$(ls "$(dirname "$mx")"/mx.runtimeconfig.json 2>/dev/null || ls "$(dirname "$mx")"/*.runtimeconfig.json 2>/dev/null | head -n1 || true)"
if [ -n "$cfg" ]; then
    log "runtime config: $cfg"
    log "  $(tr -d '\n ' < "$cfg" | cut -c1-300)"
    if grep -q includedFrameworks "$cfg"; then
        log "  self-contained (.NET included)"
    else
        dotnet="$(tr -d '\n ' < "$cfg" | grep -o '"name":"Microsoft.NETCore.App","version":"[0-9.]*"' | grep -o '[0-9][0-9.]*' | head -n1 || true)"
        log "  framework-dependent: needs .NET runtime ${dotnet:-?}; installed: $(dotnet --list-runtimes 2>/dev/null | grep NETCore | tr '\n' ' ' || echo none)"
    fi
else
    log "no runtimeconfig.json next to mx: a native / self-contained executable"
fi
out mx "$mx"
out version "$FULL"
out dotnet "$dotnet"
printf '%s\n' "$mx"
