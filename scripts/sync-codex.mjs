#!/usr/bin/env node
// sync-codex.mjs — keep the Codex mirror (.codex/, AGENTS.md) byte-derivable from the Claude
// source of truth (.claude/, CLAUDE.md). The mirror exists so a Codex/ChatGPT session can run
// the same harness contract when Claude tokens run out; it must never drift.
//
// What is synced how:
//   AGENTS.md              -> must BE a symlink to CLAUDE.md            (verified, never generated)
//   .codex/hooks/gate-on-subagent-stop.sh -> symlink to the protocol-compatible Claude hook
//   .codex/hooks/{bash-policy,protect-harness,permission-request,translate-pre-tool-use}.sh
//                         -> Codex protocol adapters (verified regular executables)
//   .codex/agents/<n>.toml -> GENERATED from .claude/agents/<n>.md     (frontmatter + body -> TOML)
//
// Usage:
//   node scripts/sync-codex.mjs --check   # exit 1 + report if anything is stale (run by gate-full)
//   node scripts/sync-codex.mjs --write   # regenerate .codex/agents/*.toml in place (human/main thread)
//
// This file is part of the harness; .codex/** is Class-2 protected. Provider adapters are allowed
// to differ in wire values while preserving the canonical Claude policy semantics.
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
assertLink('.codex/hooks/gate-on-subagent-stop.sh', '../../.claude/hooks/gate-on-subagent-stop.sh');

function assertExecutableFile(filePath) {
  const abs = join(ROOT, filePath);
  try {
    const stat = lstatSync(abs);
    if (!stat.isFile() || stat.isSymbolicLink()) problems.push(`${filePath}: must be a regular provider-adapter file`);
    // Unix executable permissions are represented as a bit mask; bitwise AND is the native test.
    // eslint-disable-next-line no-bitwise
    else if ((stat.mode & 0o111) === 0) problems.push(`${filePath}: provider adapter is not executable`);
  } catch {
    problems.push(`${filePath}: missing provider adapter`);
  }
}
const CODEX_EXECUTABLES = [
  'bash-policy.sh',
  'protect-harness.sh',
  'permission-request.sh',
  'translate-pre-tool-use.sh',
  'register-root-session.sh',
  'authorize-protected-patch.sh',
  'apply-reviewed-protected-patch.sh',
];
for (const hook of CODEX_EXECUTABLES) {
  assertExecutableFile(join('.codex/hooks', hook));
}

// --- 2. agent TOML generation (.claude/agents/*.md -> .codex/agents/*.toml) ---
function parseAgentMd(src, file) {
  const opener = '---\n';
  const closer = '\n---\n';
  if (!src.startsWith(opener)) throw new Error(`${file}: no frontmatter`);
  const closerIndex = src.indexOf(closer, opener.length);
  if (closerIndex === -1) throw new Error(`${file}: no frontmatter`);
  const frontmatter = src.slice(opener.length, closerIndex);
  const fm = {};
  for (const line of frontmatter.split('\n')) {
    const colonIndex = line.indexOf(':');
    if (colonIndex <= 0) continue;
    const key = line.slice(0, colonIndex);
    if (!/^\w+$/.test(key)) continue;
    fm[key] = line.slice(colonIndex + 1).trim();
  }
  return { fm, body: src.slice(closerIndex + closer.length).trim() };
}
const tomlStr = (s) => JSON.stringify(s); // TOML basic strings are JSON-string compatible
const CODEX_MODEL_BY_CLAUDE_MODEL = new Map([
  ['opus', 'gpt-5.6-sol'],
  ['fable', 'gpt-5.6-sol'],
  ['sonnet', 'gpt-5.6-terra'],
  ['haiku', 'gpt-5.6-luna'],
]);
function codexModelFor(claudeModel, file) {
  if (!claudeModel || claudeModel === 'inherit') return null;
  const codexModel = CODEX_MODEL_BY_CLAUDE_MODEL.get(claudeModel.toLowerCase());
  if (!codexModel) {
    throw new Error(`${file}: unsupported Claude model ${JSON.stringify(claudeModel)}; add its Codex mapping explicitly`);
  }
  return codexModel;
}
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
  // Claude tool allowlists have no Codex equivalent. Codex's `tools` setting is
  // a table of Codex-native toggles, so each role inherits the parent session's
  // tool surface.
  const model = codexModelFor(fm.model, `.claude/agents/${name}.md`);
  if (model) lines.push(`model = ${tomlStr(model)}`);
  lines.push(`developer_instructions = ${tomlMultiline(body)}`);
  return lines.join('\n') + '\n';
}

const agentsDir = join(ROOT, '.claude/agents');
const outDir = join(ROOT, '.codex/agents');
const mdNames = readdirSync(agentsDir)
  .filter((f) => f.endsWith('.md'))
  .map((f) => f.slice(0, -3))
  .sort((a, b) => a.localeCompare(b));
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
  console.error(MODE === '--check' ? 'fix: node scripts/sync-codex.mjs --write (TOMLs) / repair the listed links or Codex adapters by hand' : 'link/adapter problems are never auto-fixed — repair them by hand');
  process.exit(1);
}
console.log(`codex mirror in sync (${expected.size} agent TOMLs, 2 symlinks, ${CODEX_EXECUTABLES.length} Codex hook executables)`);
