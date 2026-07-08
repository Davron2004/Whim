#!/usr/bin/env node
// sync-codex.mjs — keep the Codex mirror (.codex/, AGENTS.md) byte-derivable from the Claude
// source of truth (.claude/, CLAUDE.md). The mirror exists so a Codex/ChatGPT session can run
// the same harness contract when Claude tokens run out; it must never drift.
//
// What is synced how:
//   AGENTS.md              -> must BE a symlink to CLAUDE.md            (verified, never generated)
//   .codex/hooks/*.sh      -> must BE symlinks to .claude/hooks/*.sh   (verified, never generated)
//   .codex/agents/<n>.toml -> GENERATED from .claude/agents/<n>.md     (frontmatter + body -> TOML)
//
// Usage:
//   node scripts/sync-codex.mjs --check   # exit 1 + report if anything is stale (run by gate-full)
//   node scripts/sync-codex.mjs --write   # regenerate .codex/agents/*.toml in place (human/main thread)
//
// This file is part of the harness; .codex/** is Class-2 protected (a symlinked hook edited via
// its .codex path IS the real hook — the mirror must be as untouchable as the original).
import { readFileSync, writeFileSync, readdirSync, lstatSync, readlinkSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MODE = process.argv[2];
if (MODE !== '--check' && MODE !== '--write') {
  console.error('usage: sync-codex.mjs --check | --write');
  process.exit(2);
}
const problems = [];

// --- 1. symlink assertions (identical-content files have ONE copy, period) ---
function assertLink(linkPath, wantTarget) {
  const abs = join(ROOT, linkPath);
  try {
    if (!lstatSync(abs).isSymbolicLink()) { problems.push(`${linkPath}: not a symlink (want -> ${wantTarget})`); return; }
    const got = readlinkSync(abs);
    if (got !== wantTarget) problems.push(`${linkPath}: points to ${got}, want ${wantTarget}`);
  } catch {
    problems.push(`${linkPath}: missing (want symlink -> ${wantTarget})`);
  }
}
assertLink('AGENTS.md', 'CLAUDE.md');
for (const hook of ['bash-policy.sh', 'protect-harness.sh', 'gate-on-subagent-stop.sh']) {
  assertLink(join('.codex/hooks', hook), join('../../.claude/hooks', hook));
}

// --- 2. agent TOML generation (.claude/agents/*.md -> .codex/agents/*.toml) ---
function parseAgentMd(src, file) {
  const m = src.match(/^---\n([\s\S]*?)\n---\n/);
  if (!m) throw new Error(`${file}: no frontmatter`);
  const fm = {};
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^(\w+):\s*(.*)$/);
    if (kv) fm[kv[1]] = kv[2].trim();
  }
  return { fm, body: src.slice(m[0].length).trim() };
}
const tomlStr = (s) => JSON.stringify(s); // TOML basic strings are JSON-string compatible
function tomlMultiline(s) {
  // TOML multi-line basic string: escape backslashes and any """ run; keep everything else verbatim.
  const esc = s.replace(/\\/g, '\\\\').replace(/"""/g, '""\\"');
  return `"""\n${esc}\n"""`;
}
function renderToml(name, { fm, body }) {
  const lines = [
    `# GENERATED from .claude/agents/${name}.md by scripts/sync-codex.mjs — DO NOT EDIT.`,
    `name = ${tomlStr(fm.name ?? name)}`,
    `description = ${tomlStr(fm.description ?? '')}`,
  ];
  if (fm.tools) lines.push(`tools = ${tomlStr(fm.tools)}`);
  if (fm.model) lines.push(`model = ${tomlStr(fm.model)}`);
  lines.push(`developer_instructions = ${tomlMultiline(body)}`);
  return lines.join('\n') + '\n';
}

const agentsDir = join(ROOT, '.claude/agents');
const outDir = join(ROOT, '.codex/agents');
const mdNames = readdirSync(agentsDir).filter((f) => f.endsWith('.md')).map((f) => f.slice(0, -3)).sort();
const expected = new Map();
for (const name of mdNames) {
  const src = readFileSync(join(agentsDir, `${name}.md`), 'utf8');
  expected.set(`${name}.toml`, renderToml(name, parseAgentMd(src, `${name}.md`)));
}
const onDisk = existsSync(outDir) ? readdirSync(outDir).filter((f) => f.endsWith('.toml')) : [];
for (const f of onDisk) if (!expected.has(f)) problems.push(`.codex/agents/${f}: stale (no .claude/agents/${f.replace(/\.toml$/, '.md')})`);
for (const [f, want] of expected) {
  const p = join(outDir, f);
  const got = existsSync(p) ? readFileSync(p, 'utf8') : null;
  if (got === want) continue;
  if (MODE === '--write') {
    writeFileSync(p, want);
    console.log(`wrote .codex/agents/${f}`);
  } else {
    problems.push(`.codex/agents/${f}: ${got === null ? 'missing' : 'out of date'} vs .claude/agents/${f.replace(/\.toml$/, '.md')}`);
  }
}

if (problems.length) {
  console.error('CODEX MIRROR OUT OF SYNC:');
  for (const p of problems) console.error(`  - ${p}`);
  console.error(MODE === '--check' ? 'fix: node scripts/sync-codex.mjs --write (TOMLs) / recreate the listed symlinks by hand' : 'symlink problems are never auto-fixed — recreate them by hand');
  process.exit(1);
}
console.log(`codex mirror in sync (${expected.size} agent TOMLs, 4 symlinks)`);
