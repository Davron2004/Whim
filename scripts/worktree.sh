#!/usr/bin/env bash
# worktree.sh — every Whim checkout other than the primary tree gets its OWN node_modules.
# The single place worktrees are created and provisioned (docs/harness.md §3, §11). The runbooks
# (.claude/commands/opsx/apply.md, .claude/commands/fix-loop.md) and `fixloop.sh redcheck` call it;
# `gate.sh` runs `check` before anything else.
#
#   scripts/worktree.sh create <id> [<base-ref>] [--branch <name>]
#       `git worktree add` at <primary>/.claude/worktrees/<id> (detached at <base-ref>, default HEAD,
#       or on a new branch <name>), then `provision` it. Prints the worktree path and its BASE SHA.
#   scripts/worktree.sh provision <checkout>
#       Give an existing checkout (a linked worktree made some other way, a baseline or deploy
#       checkout) its own node_modules: clone the primary tree's, `npm ci` if this checkout's
#       package-lock.json differs, `check`, then `npm run build`.
#   scripts/worktree.sh check [<checkout>]           (default: the checkout this script is in)
#       Exit 0 iff <checkout>/node_modules is a real directory, every workspace package (@whim/*)
#       links to <checkout>'s own copy, and no top-level entry is a symlink out of <checkout>.
#
# WHY. node_modules is gitignored, so a new worktree has none. Node, tsc and esbuild then walk up
# to the primary tree's, where the relative workspace links (node_modules/@whim/contract ->
# ../../contract) resolve to the PRIMARY tree's contract/ and server/: a chain's tests run the
# primary tree's code instead of its own. Metro does not walk up at all ("Unable to resolve module
# @babel/runtime/..."). Symlinking node_modules, whole or per entry, is no fix: realpath
# resolution still lands in the primary tree, Metro's crawler does not follow the link, and
# codegen, Gradle and CMake write their output into the primary tree's node_modules.
# A copy-on-write clone is a real directory: the relative links resolve inside the checkout and
# every write lands in the clone. On APFS one clonefile(2) of the directory takes about a second
# for ~60k entries and costs no disk until something is written.
#
# Environment:
#   WHIM_MAIN           checkout whose node_modules is cloned, and under which `create` puts
#                       .claude/worktrees/ (default: the primary working tree of this repository)
#   WHIM_WORKTREE_COPY  set to "full" to allow a plain full copy where no copy-on-write clone is
#                       possible (Linux without reflinks, another volume). Slow and uses real disk.
#
# This file is human-edited only: gate.sh executes it, so it is in the gate's CONFIG_SET.
set -uo pipefail

SELF_DIR="$(cd "$(dirname "$0")" && pwd -P)" || exit 2

die() {
  local msg="$*"
  echo "worktree.sh: $msg" >&2
  exit 2
}

usage() {
  echo "usage: scripts/worktree.sh create <id> [<base-ref>] [--branch <name>]" >&2
  echo "       scripts/worktree.sh provision <checkout>" >&2
  echo "       scripts/worktree.sh check [<checkout>]" >&2
  exit 2
}

# physical <dir> — absolute path with symlinks resolved (macOS: /tmp -> /private/tmp).
physical() {
  local dir="$1"
  (cd "$dir" 2>/dev/null && pwd -P)
  return $?
}

# toplevel <dir> — physical top-level of the checkout containing <dir>, or nothing.
toplevel() {
  local dir="$1" top
  top="$(git -C "$dir" rev-parse --show-toplevel 2>/dev/null)" || return 1
  physical "$top"
  return $?
}

# primary_of <checkout> — the primary working tree of <checkout>'s repository (the directory
# holding the common .git), or nothing for a bare/unusual layout.
primary_of() {
  local dir="$1" common
  common="$(git -C "$dir" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)" || return 1
  [[ "$(basename "$common")" == ".git" ]] || return 1
  physical "$(dirname "$common")"
  return $?
}

# source_checkout <checkout> — where node_modules is cloned from: $WHIM_MAIN, else the primary tree.
source_checkout() {
  local checkout="$1"
  if [[ -n "${WHIM_MAIN:-}" ]]; then
    physical "$WHIM_MAIN" || die "WHIM_MAIN=$WHIM_MAIN is not a directory"
    return 0
  fi
  primary_of "$checkout" || die "cannot find the primary working tree of $checkout; set WHIM_MAIN to the checkout whose node_modules to clone"
  return 0
}

# nm_dirs <source> — the node_modules directories to provision, relative to the checkout root:
# the root one plus one per workspace that has its own (npm nests a workspace's conflicting deps).
nm_dirs() {
  local src="$1"
  echo node_modules
  node -e '
    const fs = require("fs"), path = require("path");
    const [src] = process.argv.slice(1);
    for (const ws of require(path.join(src, "package.json")).workspaces ?? []) {
      if (fs.existsSync(path.join(src, ws, "node_modules"))) console.log(path.join(ws, "node_modules"));
    }' "$src"
  return $?
}

# cow_clone <src> <dst> — copy-on-write clone of a directory tree. <dst> must not exist. Never
# silently falls back to a full copy; on failure nothing is left at <dst>.
cow_clone() {
  local src="$1" dst="$2" os
  if [[ "${WHIM_WORKTREE_COPY:-}" == full ]]; then
    cp -a "$src" "$dst" && return 0
    rm -rf "$dst"
    die "full copy of $src failed"
  fi
  os="$(uname -s)"
  case "$os" in
    Darwin)
      # One clonefile(2) on the directory clones the whole tree (~1 s for ~60k entries); per-file
      # `cp -Rc` is the fallback (~8 s). Both need source and destination on one APFS volume.
      if command -v python3 >/dev/null 2>&1 && python3 - "$src" "$dst" 2>/dev/null <<'PY2'
import ctypes, sys
libc = ctypes.CDLL('/usr/lib/libSystem.dylib', use_errno=True)
sys.exit(0 if libc.clonefile(sys.argv[1].encode(), sys.argv[2].encode(), ctypes.c_uint32(0)) == 0 else 1)
PY2
      then return 0; fi
      rm -rf "$dst"
      cp -Rc "$src" "$dst" 2>/dev/null && return 0
      rm -rf "$dst"
      die "cannot clone $src to $dst (not one APFS volume?). Set WHIM_WORKTREE_COPY=full to make a full copy instead (slow)." ;;
    Linux)
      # btrfs, XFS and bcachefs reflink. ext4 and overlayfs cannot: --reflink=always then fails
      # instead of quietly copying gigabytes.
      cp -a --reflink=always "$src" "$dst" 2>/dev/null && return 0
      rm -rf "$dst"
      die "no reflink support between $src and $dst ($(stat -f -c %T "$src" 2>/dev/null || echo unknown) filesystem). Set WHIM_WORKTREE_COPY=full to make a full copy instead (slow)." ;;
    *)
      die "unsupported OS $os; set WHIM_WORKTREE_COPY=full to make a full copy" ;;
  esac
  return 0
}

# check_tree <checkout> — the tripwire. Prints what is wrong; exit 0 only when node_modules is
# the checkout's own.
check_tree() {
  local checkout="$1"
  node - "$checkout" <<'JS'
const fs = require('fs');
const path = require('path');
const root = fs.realpathSync(process.argv[2]);
const nm = path.join(root, 'node_modules');
const inside = (p) => p === root || p.startsWith(root + path.sep);
const problems = [];

let st = null;
let symlinked = false;
try { st = fs.lstatSync(nm); } catch {
  problems.push(`${nm} does not exist: Node falls back to any node_modules above this checkout (under .claude/worktrees/ that is the primary tree's, @whim/* included) and Metro finds nothing`);
}
if (st && st.isSymbolicLink()) {
  let to = '(dangling)';
  try { to = fs.realpathSync(nm); } catch {}
  symlinked = true;
  problems.push(`${nm} is a symlink to ${to}: @whim/* and every build write resolve there, and Metro cannot see through it`);
} else if (st && !st.isDirectory()) {
  problems.push(`${nm} is not a directory`);
} else if (st) {
  // Each workspace package must link to THIS checkout's copy of the workspace.
  let workspaces = [];
  try { workspaces = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).workspaces ?? []; } catch {}
  let linked = 0;
  for (const ws of workspaces) {
    let name;
    try { name = JSON.parse(fs.readFileSync(path.join(root, ws, 'package.json'), 'utf8')).name; } catch { continue; }
    let real;
    try { real = fs.realpathSync(path.join(nm, name)); } catch {
      problems.push(`node_modules/${name} is missing, so Node would resolve ${name} from a node_modules above this checkout`);
      continue;
    }
    const want = fs.realpathSync(path.join(root, ws));
    if (real !== want) problems.push(`node_modules/${name} resolves to ${real}, not this checkout's ${ws}/`);
    else linked++;
  }
  // No top-level entry (or scoped/.bin child) may be a symlink out of the checkout: a per-entry
  // symlink tree resolves and writes into another checkout exactly like a whole-folder link.
  const escaped = [];
  const inspect = (p) => {
    let real;
    try { real = fs.realpathSync(p); } catch { escaped.push(`${path.relative(root, p)} (dangling)`); return; }
    if (!inside(real)) escaped.push(`${path.relative(root, p)} -> ${real}`);
  };
  for (const e of fs.readdirSync(nm, { withFileTypes: true })) {
    const p = path.join(nm, e.name);
    if (e.isSymbolicLink()) inspect(p);
    else if (e.isDirectory() && (e.name.startsWith('@') || e.name === '.bin')) {
      for (const k of fs.readdirSync(p, { withFileTypes: true })) if (k.isSymbolicLink()) inspect(path.join(p, k.name));
    }
  }
  if (escaped.length) {
    problems.push(`${escaped.length} node_modules entr${escaped.length === 1 ? 'y is a symlink' : 'ies are symlinks'} out of this checkout: ` +
      escaped.slice(0, 5).join(', ') + (escaped.length > 5 ? `, ... (${escaped.length - 5} more)` : ''));
  }
  if (!problems.length) {
    console.log(`node_modules OK: ${root} has its own node_modules; ${linked} workspace link(s) resolve inside it`);
    process.exit(0);
  }
}
console.error(`node_modules is NOT this checkout's own (${root}):`);
for (const p of problems) console.error(`  - ${p}`);
if (symlinked) console.error(`Fix: rm ${nm}   (removes the link only: no -r, no trailing slash), then scripts/worktree.sh provision ${root}`);
else if (!st) console.error(`Fix: scripts/worktree.sh provision ${root}`);
else console.error(`Fix: move ${nm} aside, then scripts/worktree.sh provision ${root}`);
process.exit(1);
JS
  return $?
}

cmd_check() {
  local target="${1:-$SELF_DIR/..}" top
  top="$(toplevel "$target")" || die "$target is not inside a git checkout"
  check_tree "$top"
  return $?
}

cmd_provision() {
  local target="${1:-}" top src d link_to started=$SECONDS
  [[ -n "$target" ]] || usage
  top="$(toplevel "$target")" || die "$target is not inside a git checkout"
  src="$(source_checkout "$top")" || exit 2
  [[ "$top" != "$src" ]] || \
    die "refusing: $top is the source checkout itself (the primary tree installs its own node_modules with npm ci)"
  [[ -d "$src/node_modules" && ! -L "$src/node_modules" ]] || \
    die "the source checkout $src has no node_modules directory of its own to clone (run npm ci there first)"

  while IFS= read -r d; do
    if [[ -L "$top/$d" ]]; then
      link_to="$(readlink "$top/$d")"
      die "refusing: $top/$d is a symlink (-> $link_to). A symlinked node_modules resolves @whim/* and every build write into $link_to. Remove the link only (rm $top/$d, no -r, no trailing slash) and re-run."
    fi
    [[ -e "$top/$d" ]] && die "refusing: $top/$d already exists. 'scripts/worktree.sh check $top' says whether it is usable; to re-provision, delete it first."
    [[ -d "$(dirname "$top/$d")" ]] || continue   # a workspace this checkout does not have
    cow_clone "$src/$d" "$top/$d"
  done < <(nm_dirs "$src")
  echo "node_modules cloned from $src in $((SECONDS - started)) s"

  # The clone mirrors the source's install. A branch that changed the lockfile needs its own.
  # --ignore-scripts: no dependency lifecycle script runs here (supply chain). The only packages
  # with install scripts are esbuild (its binary ships in an optional platform package, so the
  # postinstall check is not needed), fsevents (optional) and the openspec CLI.
  if ! cmp -s "$src/package-lock.json" "$top/package-lock.json"; then
    echo "package-lock.json differs from $src; running npm ci in $top"
    (cd "$top" && npm ci --ignore-scripts --no-audit --no-fund) || die "npm ci failed in $top"
  fi

  # Assert, don't assume (docs/harness.md §11).
  check_tree "$top" || die "provisioned node_modules failed its own check (above)"

  (cd "$top" && npm run -s build) || die "node_modules is provisioned, but 'npm run build' failed in $top"
  echo "provisioned: $top"
  return 0
}

cmd_create() {
  local id="${1:-}" base=HEAD branch="" main wt sha
  [[ -n "$id" ]] || usage
  shift
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --branch) branch="${2:-}"; [[ -n "$branch" ]] || usage; shift 2 ;;
      -*) usage ;;
      *) base="$1"; shift ;;
    esac
  done
  case "$id" in
    */*|.*|*[[:space:]]*) die "invalid worktree id '$id' (one path segment, no leading dot)" ;;
    *) ;;
  esac

  if [[ -n "${WHIM_MAIN:-}" ]]; then
    main="$(physical "$WHIM_MAIN")" || die "WHIM_MAIN=$WHIM_MAIN is not a directory"
  else
    main="$(primary_of "$SELF_DIR")" || die "cannot find the primary working tree; set WHIM_MAIN"
  fi
  wt="$main/.claude/worktrees/$id"
  if [[ -e "$wt" || -L "$wt" ]]; then die "$wt already exists"; fi
  sha="$(git -C "$main" rev-parse --verify --quiet "$base^{commit}")" || die "no such commit: $base"

  mkdir -p "$main/.claude/worktrees" || die "cannot create $main/.claude/worktrees"
  if [[ -n "$branch" ]]; then
    git -C "$main" worktree add -b "$branch" "$wt" "$sha" || die "git worktree add failed"
  else
    git -C "$main" worktree add --detach "$wt" "$sha" || die "git worktree add failed"
  fi
  # A failed provision leaves the worktree for inspection; the gate refuses it until provisioned.
  ( cmd_provision "$wt" ) || die "worktree $wt was created but NOT provisioned (see above). Fix the cause, then: scripts/worktree.sh provision $wt"
  echo "worktree ready: $wt"
  echo "BASE $sha"
  return 0
}

sub="${1:-}"
shift 2>/dev/null || true
case "$sub" in
  create)    cmd_create "$@" ;;
  provision) cmd_provision "$@" ;;
  check)     cmd_check "$@" ;;
  *)         usage ;;
esac
