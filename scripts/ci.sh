#!/usr/bin/env bash
# CI for dump-it: agent docs check, export smoke test and the mxlocal selftest on public Mendix projects
# (MPR v2, Mendix 10.22 - 11.14), pinned to exact commits so a red run always means a change in dump-it.
#
#   bash scripts/ci.sh                 # clones the projects into .ci-projects (about 1 GB, kept between runs)
#   CI_PROJECTS=/some/dir bash scripts/ci.sh
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

# ------------------------------------------------------------------------------------------------ projects
mkdir -p "$WORK/tp/wt"
if [ ! -d "$WORK/tp/all/.git" ]; then
    git clone --quiet --filter=blob:none --no-checkout https://github.com/mendix/testProjects "$WORK/tp/all" || exit 1
fi
PROJECTS=()
while read -r name commit mpr; do
    [ -n "$name" ] || continue
    dir="$WORK/tp/wt/$name"
    if [ "$(git -C "$dir" rev-parse HEAD 2>/dev/null)" != "$commit" ]; then
        rm -rf "$dir"
        git -C "$WORK/tp/all" worktree prune
        git -C "$WORK/tp/all" fetch --quiet origin "$commit" 2>/dev/null
        git -C "$WORK/tp/all" worktree add --quiet --detach "$dir" "$commit" || { say "FAIL cannot check out $name"; fail=1; continue; }
    fi
    PROJECTS+=("$dir/$mpr")
done <<< "$TEST_PROJECTS"

if [ "$(git -C "$WORK/mxcli" rev-parse HEAD 2>/dev/null)" != "$MXCLI_COMMIT" ]; then
    rm -rf "$WORK/mxcli"
    git clone --quiet --filter=blob:none --no-checkout https://github.com/mendixlabs/mxcli "$WORK/mxcli" &&
        git -C "$WORK/mxcli" sparse-checkout set testdata &&
        git -C "$WORK/mxcli" checkout --quiet "$MXCLI_COMMIT" || { say "FAIL cannot check out mxcli testdata"; fail=1; }
fi
for p in $MXCLI_PROJECTS; do PROJECTS+=("$WORK/mxcli/testdata/$p"); done

# ------------------------------------------------------------------------------------------------ checks
say "== docs"
node "$MXLOCAL" doccheck || fail=1

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

say "== selftest (mxlocal)"
for mpr in "${PROJECTS[@]}"; do
    out="$(node "$MXLOCAL" selftest --project "$mpr" 2>&1)"
    oks=$(printf '%s\n' "$out" | grep -c '^  OK')
    fails=$(printf '%s\n' "$out" | grep -c '^  FAIL')
    if [ "$fails" -gt 0 ] || [ "$oks" -eq 0 ]; then
        say "FAIL $(basename "$mpr")"
        printf '%s\n' "$out" | grep -E '^  (FAIL|SKIP)|ERROR|Self test' | head -20
        fail=1
    else
        say "OK   $(basename "$mpr"): $oks checks$(printf '%s\n' "$out" | grep -q '^  SKIP' && echo ", with SKIP lines")"
    fi
done

[ "$fail" = 0 ] && say "CI PASSED" || say "CI FAILED"
exit "$fail"
