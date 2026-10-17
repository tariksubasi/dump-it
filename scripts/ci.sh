#!/usr/bin/env bash
# CI for dump-it: agent docs check, export smoke test and the mxlocal selftest on public Mendix projects
# (MPR v2, Mendix 10.22 - 11.14), pinned to exact commits so a red run always means a change in dump-it.
#
#   bash scripts/ci.sh                 # clones the projects into .ci-projects (about 1 GB, kept between runs)
#   CI_PROJECTS=/some/dir bash scripts/ci.sh
#   CI_ONLY=Badge,minimal bash scripts/ci.sh       # only these projects (name or .mpr name, case-insensitive)
#   CI_STAGES=export,selftest bash scripts/ci.sh   # only these stages (default: docs,guard,mxcheck-fake,export,selftest)
#   CI_SELFTEST_ARGS="--mxcheck" bash scripts/ci.sh  # extra selftest arguments (mx check: MX_PATH or a Studio Pro)
#   bash scripts/ci.sh --list          # the project names as a JSON list (GitHub Actions matrix), nothing cloned
#   bash scripts/ci.sh --path Badge    # check the project out, print its .mpr path (nothing else runs)
#
# Layout under $CI_PROJECTS: tp/all (mendix/testProjects), tp/wt/<name> (one worktree per project), mxcli (testdata).
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="${CI_PROJECTS:-$ROOT/.ci-projects}"
MXLOCAL="$ROOT/mxlocal/mxlocal.js"

# name  commit  .mpr   (branches of https://github.com/mendix/testProjects)
TEST_PROJECTS="
badge-web-mx11 37cbf3aaca7b0f95006d75b38c9fcbd80c060f33 Badge.mpr
barcode-generator-web 9054f05e2a0289658d7b634d615dcd257debabc9 BarcodeGenerator.mpr
bubble-chart-web b68cc22eb3df6344d26aeddc0b5f0db9a9415d88 BubbleChart.mpr
checkbox-radio-selection-web 7be18e4b66816dfad5fcdce8954def261d0aab52 CheckboxRadioSelection.mpr
combobox-web e6d058b56924adc7366467a81a9aa3c0c518278d ComboboxTest.mpr
datagrid-web_data-widgets-3.0_2 997d8d2cef9bb0b3e1f9036757fec21457775b19 DataGrid.mpr
gallery-web_gallery-web-mx11 868abd64232373966ad82bccfe8814104df72f91 Gallery.mpr
image-cropper-web e07eb0bb25ad996c2e1409f68a00dee22b23c7b2 ImageCropper.mpr
image-viewer-web ca94cbea9eeb532dd6d76e348a1e50f22d66d35a ImageViewer.mpr
maps-web-2026-05-29 4d5569dd3110a4b72c5e88781dd941f7b2091d53 Maps.mpr
rich-text-web d697c5f75ac1c47fa12722bfb20337a84cd533c7 RichText.mpr
skiplink-web 3c6d0aa08108a6d7fcf664503aba02d72558059e skiplink-web.mpr
tree-node-web_v2 7580d82c8320a6402ce6c0cf7fdddc1ecdb34f70 TreeView.mpr
"
# https://github.com/mendixlabs/mxcli testdata (Apache-2.0)
MXCLI_COMMIT=91ae198de7dd391ce250edb4c4ed99d336adaf81
MXCLI_PROJECTS="expr-checker/minimal.mpr pedapp/PedApp.mpr testapp-views/TestApp.mpr"

say() { printf '%s\n' "$*"; }
fail=0
STAGES=",${CI_STAGES:-docs,guard,mxcheck-fake,export,selftest},"
stage() { case "$STAGES" in *",$1,"*) return 0 ;; *) return 1 ;; esac; }
# CI_ONLY: comma-separated names; a project is selected when its name or .mpr base name matches one (any case)
selected() {
    [ -z "${CI_ONLY:-}" ] && return 0
    local want n
    IFS=',' read -ra want <<< "$CI_ONLY"
    for n in "${want[@]}"; do
        n="$(printf '%s' "$n" | tr '[:upper:]' '[:lower:]' | xargs)"
        for x in "$@"; do [ "$(printf '%s' "$x" | tr '[:upper:]' '[:lower:]')" = "$n" ] && return 0; done
    done
    return 1
}
mxcli_name() { basename "$1" .mpr; }

if [ "${1:-}" = "--list" ]; then
    names=()
    while read -r name commit mpr; do [ -n "$name" ] && names+=("\"$(basename "$mpr" .mpr)\""); done <<< "$TEST_PROJECTS"
    for p in $MXCLI_PROJECTS; do names+=("\"$(mxcli_name "$p")\""); done
    (IFS=','; printf '[%s]\n' "${names[*]}")
    exit 0
fi
PATH_ONLY=""
if [ "${1:-}" = "--path" ]; then
    [ -n "${2:-}" ] || { say "usage: ci.sh --path <name>"; exit 2; }
    PATH_ONLY=1; CI_ONLY="$2"; STAGES=","
fi

# ------------------------------------------------------------------------------------------------ projects
mkdir -p "$WORK/tp/wt"
PROJECTS=()
need_tp=0
while read -r name commit mpr; do [ -n "$name" ] && selected "$name" "$(basename "$mpr" .mpr)" && need_tp=1; done <<< "$TEST_PROJECTS"
if [ "$need_tp" = 1 ] && [ ! -d "$WORK/tp/all/.git" ]; then
    git clone --quiet --filter=blob:none --no-checkout https://github.com/mendix/testProjects "$WORK/tp/all" || exit 1
fi
while read -r name commit mpr; do
    [ -n "$name" ] || continue
    selected "$name" "$(basename "$mpr" .mpr)" || continue
    dir="$WORK/tp/wt/$name"
    if [ "$(git -C "$dir" rev-parse HEAD 2>/dev/null)" != "$commit" ]; then
        rm -rf "$dir"
        git -C "$WORK/tp/all" worktree prune
        git -C "$WORK/tp/all" fetch --quiet origin "$commit" 2>/dev/null
        git -C "$WORK/tp/all" worktree add --quiet --detach "$dir" "$commit" || { say "FAIL cannot check out $name"; fail=1; continue; }
    fi
    PROJECTS+=("$dir/$mpr")
done <<< "$TEST_PROJECTS"

# the mxcli testdata: for its projects, and for the guard and fake-mx tests (minimal.mpr)
need_mxcli=0
for p in $MXCLI_PROJECTS; do selected "$(mxcli_name "$p")" && need_mxcli=1; done
if stage guard || stage mxcheck-fake; then need_mxcli=1; fi
if [ "$need_mxcli" = 1 ] && [ "$(git -C "$WORK/mxcli" rev-parse HEAD 2>/dev/null)" != "$MXCLI_COMMIT" ]; then
    rm -rf "$WORK/mxcli"
    git clone --quiet --filter=blob:none --no-checkout https://github.com/mendixlabs/mxcli "$WORK/mxcli" &&
        git -C "$WORK/mxcli" sparse-checkout set testdata &&
        git -C "$WORK/mxcli" checkout --quiet "$MXCLI_COMMIT" || { say "FAIL cannot check out mxcli testdata"; fail=1; }
fi
for p in $MXCLI_PROJECTS; do selected "$(mxcli_name "$p")" && PROJECTS+=("$WORK/mxcli/testdata/$p"); done

if [ -n "$PATH_ONLY" ]; then
    [ "${#PROJECTS[@]}" -eq 1 ] || { say "no single project named $CI_ONLY (see ci.sh --list)" >&2; exit 1; }
    printf '%s\n' "${PROJECTS[0]}"
    exit "$fail"
fi
if [ "${#PROJECTS[@]}" -eq 0 ] && [ -n "${CI_ONLY:-}" ]; then say "FAIL CI_ONLY=$CI_ONLY selects no project (see ci.sh --list)"; exit 1; fi

# ------------------------------------------------------------------------------------------------ checks
if stage docs; then
say "== docs"
node "$MXLOCAL" doccheck || fail=1
fi

if stage guard; then
say "== guard (permissions, Claude Code hook, mx.py clean, export location)"
bash "$ROOT/scripts/test-guard.sh" "$WORK/mxcli/testdata/expr-checker/minimal.mpr" || fail=1
fi

if stage mxcheck-fake; then
say "== STUDIO PRO CHECK with a fake mx (discovery, versions, parsing, baseline, check/run/apply --check)"
out="$(node "$ROOT/scripts/test-mxcheck.js" "$WORK/mxcli/testdata/expr-checker/minimal.mpr" 2>&1)" || fail=1
printf '%s\n' "$out" | grep -E '^(FAIL|SKIP)' | head -20
printf '%s\n' "$out" | tail -n1
fi

if stage export; then
say "== export (mxcontext.py)"
OUT="$(mktemp -d)"
for mpr in "${PROJECTS[@]}"; do
    line="$(python3 "$ROOT/mxcontext.py" "$mpr" -o "$OUT/$(basename "$mpr" .mpr)" 2>&1 | tail -n1)"
    case "$line" in
        Exported*"(0 warnings)"*) say "OK   $(basename "$mpr")" ;;
        *) say "FAIL $(basename "$mpr"): $line"; fail=1 ;;
    esac
done
rm -rf "$OUT"
fi

if stage selftest; then
say "== selftest (mxlocal${CI_SELFTEST_ARGS:+ $CI_SELFTEST_ARGS})"
for mpr in "${PROJECTS[@]}"; do
    # shellcheck disable=SC2086
    out="$(node "$MXLOCAL" selftest --project "$mpr" ${CI_SELFTEST_ARGS:-} 2>&1)"
    oks=$(printf '%s\n' "$out" | grep -c '^  OK')
    fails=$(printf '%s\n' "$out" | grep -c '^  FAIL')
    # a selftest that stops with an exception prints "Self test FAILED" and no FAIL line
    if [ "$fails" -gt 0 ] || [ "$oks" -eq 0 ] || printf '%s\n' "$out" | grep -q 'Self test FAILED'; then
        say "FAIL $(basename "$mpr")"
        printf '%s\n' "$out" | grep -E '^  (FAIL|SKIP)|ERROR|Self test' | head -20
        fail=1
    else
        say "OK   $(basename "$mpr"): $oks checks$(printf '%s\n' "$out" | grep -q '^  SKIP' && echo ", with SKIP lines")"
    fi
    # --mxcheck: the STUDIO PRO CHECK result and the new errors per document; a skipped mx check fails here
    if printf '%s\n' "${CI_SELFTEST_ARGS:-}" | grep -q -- '--mxcheck'; then
        printf '%s\n' "$out" | grep -E '^  (OK  |FAIL) mx check|^    (\S.*new error|  ! )|^  (SKIP|NOTE) mx check|^Copy kept' | head -60
        if printf '%s\n' "$out" | grep -q '^  SKIP mx check'; then say "FAIL $(basename "$mpr"): mx check did not run (MX_PATH?)"; fail=1; fi
    fi
done
fi

[ "$fail" = 0 ] && say "CI PASSED" || say "CI FAILED"
exit "$fail"
