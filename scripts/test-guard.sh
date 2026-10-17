#!/usr/bin/env bash
# Tests of the export guard: OpenCode permission rules, the Claude Code PreToolUse hook, mx.py clean and the export
# location check. Exports a copy of a Mendix project into a temporary folder.
#
#   bash scripts/test-guard.sh <project folder or .mpr>
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="${1:?usage: test-guard.sh <project folder or .mpr>}"
[ -f "$SRC" ] && SRC="$(dirname "$SRC")"
PY="${PYTHON:-python3}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
fails=0
ok() { printf '  OK   %s\n' "$1"; }
bad() { printf '  FAIL %s\n' "$1"; fails=$((fails + 1)); }
check() { if eval "$2"; then ok "$1"; else bad "$1"; fi; }

cp -r "$SRC" "$TMP/App"
APP="$TMP/App"
OUT="$TMP/App-context"
"$PY" "$ROOT/mxcontext.py" "$APP" -o "$OUT" > "$TMP/export.log" 2>&1
check "export" 'tail -n1 "$TMP/export.log" | grep -q "^Exported"'

# ---------------------------------------------------------------- OpenCode rules (last matching rule wins)
"$PY" - "$OUT/opencode.json" <<'EOF' && ok "opencode.json rules" || bad "opencode.json rules"
import json, re, sys
perm = json.load(open(sys.argv[1], encoding="utf-8"))["permission"]
bash, edit = perm["bash"], perm["edit"]

def match(text, pattern):  # OpenCode packages/core/src/util/wildcard.ts
    text = text.replace("\\", "/")
    p = re.sub(r"[.+^${}()|[\]\\]", lambda m: "\\" + m.group(0), pattern.replace("\\", "/"))
    p = p.replace("*", ".*").replace("?", ".")
    if p.endswith(" .*"):
        p = p[:-3] + "( .*)?"
    return re.match("^" + p + "$", text, re.S) is not None

def decide(rules, text):  # packages/core/src/permission.ts: findLast
    found = "ask"
    for pattern, action in rules.items():
        if match(text, pattern):
            found = action
    return found

py = next(k for k in bash if k.endswith(" mx.py find*"))[:-len(" mx.py find*")]
problems = []
for p in ("cat *", "type *", "head *", "tail *"):
    if bash.get(p) == "allow":
        problems.append("still allowed: " + p)
for p in ("* > *", "*>*", "* >> *", "tee *", "node *", "python -c*", "python3 -c*", "py -c*", "powershell*",
          "Set-Content*", "Out-File*", "echo * > *", "cp *", "mv *"):
    if bash.get(p) != "deny":
        problems.append("missing deny: " + p)
cases = {
    "cat > helper.js <<EOF\nconsole.log(1)\nEOF": "deny",
    "cat AI_GUIDE.txt": "ask",
    "head -n 5 AI_GUIDE.txt > notes.txt": "deny",
    "echo x > helper.js": "deny",
    "tee helper.js": "deny",
    "node helper.js": "deny",
    "python helper.py": "deny",
    "python3 -c \"open('a.js','w')\"": "deny",
    "cp mx.py helper.py": "deny",
    "Set-Content -Path helper.js -Value x": "deny",
    py + " mx.py find Order": "allow",
    py + " mx.py dryrun add-note": "allow",
    py + " mx.py clean": "allow",
    py + " mx.py clean --move": "ask",
    py + " mx.py apply ABC123": "ask",
    py + " mx.py find Order > found.txt": "deny",
    "git status": "allow",
    "git push": "deny",
    "grep -rn Order modules": "allow",
}
for cmd, want in cases.items():
    got = decide(bash, cmd)
    if got != want:
        problems.append("bash %r: %s, expected %s" % (cmd, got, want))
for path, want in {"edits/add-note.json": "allow", "helper.js": "deny", "edits/x.js": "deny", "mx.py": "deny"}.items():
    if decide(edit, path) != want:
        problems.append("edit %s: %s, expected %s" % (path, decide(edit, path), want))
if problems:
    print("\n".join("    " + p for p in problems))
sys.exit(1 if problems else 0)
EOF

# ---------------------------------------------------------------- Claude Code hook (stdin JSON as Claude Code sends it)
HOOK="$OUT/.claude/hooks/guard.py"
hook() {  # tool, input-json -> prints deny or allow
    printf '{"session_id":"t","hook_event_name":"PreToolUse","cwd":"%s","tool_name":"%s","tool_input":%s}' "$OUT" "$1" "$2" |
        "$PY" "$HOOK" | grep -q '"permissionDecision": "deny"' && echo deny || echo allow
}
check "hook registered in .claude/settings.json" 'grep -q "guard.py" "$OUT/.claude/settings.json"'
check "hook denies Write ./helper.js" '[ "$(hook Write "{\"file_path\":\"./helper.js\",\"content\":\"x\"}")" = deny ]'
check "hook denies Write of the project folder" '[ "$(hook Write "{\"file_path\":\"$APP/helper.js\",\"content\":\"x\"}")" = deny ]'
check "hook denies Edit edits/../mx.py" '[ "$(hook Edit "{\"file_path\":\"edits/../mx.py\",\"old_string\":\"a\",\"new_string\":\"b\"}")" = deny ]'
check "hook allows Write edits/x.json" '[ "$(hook Write "{\"file_path\":\"edits/x.json\",\"content\":\"{}\"}")" = allow ]'
check "hook allows Write edits\\x.json (backslash)" '[ "$(hook Write "{\"file_path\":\"edits\\\\x.json\",\"content\":\"{}\"}")" = allow ]'
check "hook denies Write edits/x.js (scripts off)" '[ "$(hook Write "{\"file_path\":\"edits/x.js\",\"content\":\"x\"}")" = deny ]'
ln -s "$OUT/mx.py" "$OUT/edits/link.json"
check "hook denies a symlink in edits/ to mx.py" '[ "$(hook Write "{\"file_path\":\"edits/link.json\",\"content\":\"x\"}")" = deny ]'
rm -f "$OUT/edits/link.json"
check "hook denies Bash cat > helper.js" '[ "$(hook Bash "{\"command\":\"cat > helper.js <<EOF\\nx\\nEOF\"}")" = deny ]'
check "hook denies Bash node helper.js" '[ "$(hook Bash "{\"command\":\"node helper.js\"}")" = deny ]'
check "hook allows Bash mx.py find 2>&1" '[ "$(hook Bash "{\"command\":\"python mx.py find Order 2>&1\"}")" = allow ]'

# ---------------------------------------------------------------- mx.py clean
echo 'console.log(1)' > "$OUT/helper.js"
"$PY" "$OUT/mx.py" clean > "$TMP/clean.log" 2>&1
check "clean lists a planted helper.js" 'grep -q "helper.js" "$TMP/clean.log"'
echo '{ "ops": [] }' > "$OUT/edits/empty.json"
"$PY" "$OUT/mx.py" dryrun empty > "$TMP/dry.log" 2>&1
check "dryrun warns about it" 'grep -q "1 file(s) outside edits/: run python mx.py clean" "$TMP/dry.log"'
"$PY" "$OUT/mx.py" clean --move > "$TMP/move.log" 2>&1
check "clean --move moves it to edits/stray/" '[ ! -e "$OUT/helper.js" ] && ls "$OUT"/edits/stray/*/helper.js > /dev/null 2>&1'
check "clean is clean afterwards" '"$PY" "$OUT/mx.py" clean | grep -q "^Clean:"'
echo 'x' > "$OUT/notes.py"
"$PY" "$ROOT/mxcontext.py" "$APP" -o "$OUT" > "$TMP/export2.log" 2>&1
check "re-export moves stray files instead of deleting them" '[ ! -e "$OUT/notes.py" ] && [ "$(ls "$OUT"/edits/stray/*/notes.py | wc -l)" = 1 ]'

# ---------------------------------------------------------------- export location
"$PY" "$ROOT/mxcontext.py" "$APP" -o "$APP" > "$TMP/loc1.log" 2>&1
check "export into the project folder is refused" 'grep -q "Refusing to export" "$TMP/loc1.log" && [ ! -e "$APP/AI_GUIDE.txt" ]'
"$PY" "$ROOT/mxcontext.py" "$APP" -o "$APP/context" > "$TMP/loc2.log" 2>&1
check "export inside the project folder is refused" 'grep -q "inside the Mendix project folder" "$TMP/loc2.log" && [ ! -e "$APP/context" ]'
"$PY" "$ROOT/mxcontext.py" "$APP" -o "$TMP" > "$TMP/loc3.log" 2>&1
check "export into a folder containing the project is refused" 'grep -q "it contains the Mendix project" "$TMP/loc3.log"'
"$PY" "$ROOT/mxcontext.py" "$APP" -o "$APP/context" --inside-project > "$TMP/loc4.log" 2>&1
check "--inside-project exports with a warning" 'grep -q "^WARNING: exporting inside" "$TMP/loc4.log" && tail -n1 "$TMP/loc4.log" | grep -q "^Exported"'
rm -rf "$APP/context"

# ---------------------------------------------------------------- --allow-scripts: edits/*.js too, nothing else
"$PY" "$ROOT/mxcontext.py" "$APP" -o "$TMP/scripts" --allow-scripts > /dev/null 2>&1
OUT="$TMP/scripts"; HOOK="$OUT/.claude/hooks/guard.py"
check "allow-scripts: hook allows edits/x.js" '[ "$(hook Write "{\"file_path\":\"edits/x.js\",\"content\":\"x\"}")" = allow ]'
check "allow-scripts: hook denies ./x.js" '[ "$(hook Write "{\"file_path\":\"x.js\",\"content\":\"x\"}")" = deny ]'
check "allow-scripts: opencode edit allows edits/*.js" 'grep -q "\"edits/\*.js\": \"allow\"" "$OUT/opencode.json"'

[ "$fails" = 0 ] && echo "Guard tests PASSED" || echo "Guard tests FAILED ($fails)"
exit "$fails"
