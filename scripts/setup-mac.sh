#!/usr/bin/env bash
# dump-it Mac setup: installs the tools, gets the repo, tests the Mendix project, exports it and prepares OpenCode.
#
#   bash setup-mac.sh                          # finds Mendix projects under your home folder and asks
#   bash setup-mac.sh ~/Mendix/BenimProje      # uses this project
#   bash setup-mac.sh --no-install ...         # does not install anything (only checks)
#
# Writes nothing to the Mendix model. The only change in the project folder is one line in .gitignore.
set -o pipefail   # no -u: macOS bash 3.2 treats empty arrays as unset

REPO_URL="https://github.com/tariksubasi/dump-it.git"
BRANCH="feature/local-sdk"
DUMP_IT="${DUMP_IT:-$HOME/dump-it}"
NODE_MIN="22.13"
INSTALL=1
PROJECT=""

for a in "$@"; do
    case "$a" in
        --no-install) INSTALL=0 ;;
        -h|--help) sed -n '2,8p' "$0"; exit 0 ;;
        *) PROJECT="$a" ;;
    esac
done

if [ -t 1 ]; then B=$'\e[1m'; G=$'\e[32m'; Y=$'\e[33m'; R=$'\e[31m'; N=$'\e[0m'; else B=""; G=""; Y=""; R=""; N=""; fi
step() { printf '\n%s== %s%s\n' "$B" "$1" "$N"; }
ok()   { printf '%s  OK%s   %s\n' "$G" "$N" "$1"; }
warn() { printf '%s  NOTE%s %s\n' "$Y" "$N" "$1"; }
die()  { printf '%s  STOP%s %s\n' "$R" "$N" "$1"; exit 1; }
ask()  { local r; read -r -p "  $1 [y/N] " r </dev/tty; [[ "$r" =~ ^[yYeE] ]]; }

# version_ge 22.13.0 22.13 -> true
version_ge() { awk -v a="$1" -v b="$2" 'BEGIN { split(a, x, "."); split(b, y, ".");
    for (i = 1; i <= 3; i++) { if (x[i] + 0 > y[i] + 0) exit 0; if (x[i] + 0 < y[i] + 0) exit 1 } exit 0 }'; }

[ "$(uname -s)" = "Darwin" ] || warn "This script is for macOS. It continues, but installs only work with Homebrew."

# ---------------------------------------------------------------------------------------------------- 1. tools
step "1/6 Tools (Homebrew, git, Python, Node, OpenCode)"

if ! command -v brew >/dev/null 2>&1; then
    for p in /opt/homebrew/bin/brew /usr/local/bin/brew; do [ -x "$p" ] && eval "$("$p" shellenv)"; done
fi
if ! command -v brew >/dev/null 2>&1; then
    if [ "$INSTALL" = 1 ] && ask "Homebrew is not installed. Install it now (asks for your Mac password)?"; then
        /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)" </dev/tty || die "Homebrew install failed."
        for p in /opt/homebrew/bin/brew /usr/local/bin/brew; do [ -x "$p" ] && eval "$("$p" shellenv)"; done
    else
        warn "No Homebrew: missing tools cannot be installed automatically."
    fi
fi
HAVE_BREW=0; command -v brew >/dev/null 2>&1 && HAVE_BREW=1

need() { # need <command> <brew formula>
    if command -v "$1" >/dev/null 2>&1; then return 0; fi
    [ "$INSTALL" = 1 ] && [ "$HAVE_BREW" = 1 ] || die "'$1' is missing. Install it (brew install $2) and run this script again."
    echo "  Installing $2 ..."
    brew install "$2" || die "brew install $2 failed."
}

need git git
ok "git $(git --version | awk '{print $3}')"

PY=""
for c in python3 python; do
    if command -v "$c" >/dev/null 2>&1 && "$c" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 8) else 1)' 2>/dev/null; then PY="$c"; break; fi
done
if [ -z "$PY" ]; then need python3 python; PY=python3; fi
ok "Python $("$PY" -c 'import platform; print(platform.python_version())')"

node_version() { node --version 2>/dev/null | sed 's/^v//'; }
if ! command -v node >/dev/null 2>&1 || ! version_ge "$(node_version)" "$NODE_MIN"; then
    [ -n "$(node_version)" ] && warn "Node $(node_version) is too old (need $NODE_MIN+)."
    [ "$INSTALL" = 1 ] && [ "$HAVE_BREW" = 1 ] || die "Install Node $NODE_MIN or newer (brew install node) and run this script again."
    brew install node || brew upgrade node || die "Node install failed."
    export PATH="$(brew --prefix)/bin:$PATH"; hash -r
    version_ge "$(node_version)" "$NODE_MIN" || die "'node' is still $(node_version): $(command -v node) comes before Homebrew in PATH (nvm/volta?). Run 'nvm install 22' or fix PATH, then run again."
fi
ok "Node $(node_version)"

if ! command -v opencode >/dev/null 2>&1; then
    if [ "$INSTALL" = 1 ] && [ "$HAVE_BREW" = 1 ]; then
        echo "  Installing OpenCode ..."
        brew install sst/tap/opencode || npm install -g opencode-ai || warn "OpenCode install failed. See https://opencode.ai/docs and install it by hand."
    else
        warn "OpenCode is missing. Install it: brew install sst/tap/opencode"
    fi
fi
command -v opencode >/dev/null 2>&1 && ok "OpenCode $(opencode --version 2>/dev/null | head -n1)"

# ---------------------------------------------------------------------------------------------------- 2. repo
step "2/6 dump-it repo ($BRANCH) in $DUMP_IT"

if [ -d "$DUMP_IT/.git" ]; then
    cd "$DUMP_IT" || die "cannot open $DUMP_IT"
    if [ -n "$(git status --porcelain)" ]; then
        git stash push -m "setup-mac $(date +%Y%m%d-%H%M%S)" >/dev/null && warn "Your local changes are saved with 'git stash' (see: git stash list)."
    fi
    git fetch origin "$BRANCH" || die "git fetch failed (network?)."
    git checkout "$BRANCH" 2>/dev/null || git checkout -b "$BRANCH" "origin/$BRANCH" || die "cannot switch to $BRANCH."
    git merge --ff-only "origin/$BRANCH" || die "Local $BRANCH has its own commits. Fix it by hand (git status)."
else
    git clone -b "$BRANCH" "$REPO_URL" "$DUMP_IT" || die "git clone failed."
    cd "$DUMP_IT" || die "cannot open $DUMP_IT"
fi
ok "$(git log --oneline -1)"
MXLOCAL="$DUMP_IT/mxlocal/mxlocal.js"
[ -f "$DUMP_IT/mxlocal/node_modules/mendixmodelsdk/package.json" ] || die "mxlocal/node_modules is incomplete. Delete $DUMP_IT and run again."

# ---------------------------------------------------------------------------------------------------- 3. project
step "3/6 Mendix project"

if [ -z "$PROJECT" ]; then
    echo "  Searching for Mendix projects (.mpr) under your home folder ..."
    FOUND=()
    while IFS= read -r f; do FOUND+=("$f"); done < <(
        for d in "$HOME/Mendix" "$HOME/Documents" "$HOME/Desktop" "$HOME/Projects" "$HOME/Projeler" "$HOME/Developer" "$HOME/Downloads"; do
            [ -d "$d" ] && find "$d" -maxdepth 5 -name '*.mpr' -type f \
                -not -path '*-context/*' -not -path '*/deployment/*' -not -path '*/.mxlocal-backup/*' -not -path '*/mxselftest*' 2>/dev/null
        done | sort -u)
    case ${#FOUND[@]} in
        0) die "No .mpr found. Run again with the project folder: bash setup-mac.sh ~/path/to/Project" ;;
        1) PROJECT="${FOUND[0]}"; echo "  Found: $PROJECT" ;;
        *) echo "  Found ${#FOUND[@]} projects:"
           for i in "${!FOUND[@]}"; do printf '   %2d) %s\n' "$((i + 1))" "${FOUND[$i]}"; done
           read -r -p "  Number of the project to use: " n </dev/tty
           [[ "$n" =~ ^[0-9]+$ ]] && [ "$n" -ge 1 ] && [ "$n" -le ${#FOUND[@]} ] || die "No valid number."
           PROJECT="${FOUND[$((n - 1))]}" ;;
    esac
fi

PROJECT="${PROJECT/#\~/$HOME}"
if [ -d "$PROJECT" ]; then
    MPRS=("$PROJECT"/*.mpr)
    [ -f "${MPRS[0]}" ] || die "No .mpr file in $PROJECT"
    [ ${#MPRS[@]} -eq 1 ] || die "More than one .mpr in $PROJECT. Pass the .mpr file itself."
    MPR="${MPRS[0]}"
else
    MPR="$PROJECT"
fi
[ -f "$MPR" ] || die "Not found: $MPR"
MPR="$(cd "$(dirname "$MPR")" && pwd)/$(basename "$MPR")"
PROJECT_DIR="$(dirname "$MPR")"
ok "Project: $MPR"
if [ -d "$PROJECT_DIR/mprcontents" ]; then ok "MPR v2 (mprcontents/ exists): model changes are possible"
else warn "No mprcontents/ folder: MPR v1 (old format). Export and questions work; model changes (/degistir) do not."; fi
[ -e "$MPR.lock" ] && warn "Studio Pro has this project open. Tests use a copy, so this is fine; close Studio Pro before you apply a change."

# ---------------------------------------------------------------------------------------------------- 4. tests
step "4/6 Tests (on a copy, nothing is written to your project)"

SELFTEST_OK=0
if [ -d "$PROJECT_DIR/mprcontents" ]; then
    echo "  verify ..."
    VLOG="$(mktemp "${TMPDIR:-/tmp}/mxverify.XXXXXX")"
    if node "$MXLOCAL" verify --project "$MPR" >"$VLOG" 2>&1; then ok "verify (details: $VLOG)"
    else cat "$VLOG"; warn "verify FAILED: do not use model changes. Send the output above to Claude."; fi
    echo "  selftest (about 10-60 s) ..."
    if node "$MXLOCAL" selftest --project "$MPR" --keep; then
        SELFTEST_OK=1; ok "selftest: all checks OK"
    else
        warn "selftest FAILED: do not use model changes. Send the output above to Claude."
    fi
else
    warn "Skipped (MPR v1)."
fi

# ---------------------------------------------------------------------------------------------------- 5. gitignore
step "5/6 Project .gitignore"
GI="$PROJECT_DIR/.gitignore"
if [ -f "$GI" ] && grep -qx '\.mxlocal-backup/' "$GI"; then
    ok ".mxlocal-backup/ already ignored"
else
    { [ -s "$GI" ] && [ -n "$(tail -c1 "$GI")" ] && echo; echo ".mxlocal-backup/"; } >> "$GI"
    ok "Added .mxlocal-backup/ to $GI (commit it with your next change)"
fi

# ---------------------------------------------------------------------------------------------------- 6. export
step "6/6 Export for OpenCode"
"$PY" "$DUMP_IT/mxcontext.py" "$MPR" || die "Export failed. Send the output above to Claude."
CONTEXT="${PROJECT_DIR}-context"
[ -d "$CONTEXT" ] || CONTEXT="$(ls -d "${PROJECT_DIR}"*-context 2>/dev/null | head -n1)"
[ -f "$CONTEXT/opencode.json" ] && ok "OpenCode files ready in $CONTEXT" || warn "opencode.json not found in $CONTEXT"
[ -f "$CONTEXT/.opencode/commands/degistir.md" ] && ok "/degistir is available" || warn "/degistir is not available (check Node and MPR v2)"

# ---------------------------------------------------------------------------------------------------- done
printf '\n%sREADY%s\n' "$B$G" "$N"
cat <<EOF

  Start OpenCode:
      cd "$CONTEXT" && opencode

  First time only, inside OpenCode: choose your model with /models (for DeepSeek: run 'opencode auth login' first).

  In OpenCode:
      Ask anything                  Order kaydedilince hangi microflow çalışıyor?
      /degistir <request>           change the model (dry run -> code -> "evet <CODE>")
      /kontrol                      check what you changed in Studio Pro
      /geri-al                      undo the last applied change
      /senkron                      after git pull / branch switch

  Before "evet <CODE>": close Studio Pro. After: open it and look at the Errors pane.
EOF
[ "$SELFTEST_OK" = 1 ] && echo "  Optional: the selftest copy path is printed above ('Copy kept'). Open it in Studio Pro to see all test changes, then delete it."
echo
echo "  Never upload the -context folder anywhere: it contains your company's logic."
