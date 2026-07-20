#!/usr/bin/env node
// Closure-entry ruleset probe (openspec: staging-integration-lane).
//
// Verifies that a GitHub branch ruleset protects the default branch (`main`) against DIRECT pushes
// before the orchestrator enters closure. The server-side ruleset — not a local hook — is the human
// gate for `main`, so closure MUST refuse to run without it. Uses `gh api` (read-only, hook-allowed;
// gh resolves {owner}/{repo} from the origin remote). FAIL-CLOSED: any error, missing ruleset, or
// unrecognized shape exits non-zero so the runbook refuses closure rather than proceeding blind.
//
// Exit: 0 protected (OK to enter closure) · 1 gh/query error · 2 no active ruleset · 3 active
// ruleset(s) exist but none requires a PR on the default branch.
import { execFileSync } from 'node:child_process';

function ghApiJson(path) {
  // `gh` is resolved from PATH by design: it is machine-dependent (/opt/homebrew, /usr/bin, …) and
  // this is a trusted closure-time dev-harness script, not a service handling untrusted input.
  // eslint-disable-next-line sonarjs/no-os-command-from-path
  const out = execFileSync('gh', ['api', path], { encoding: 'utf8' });
  return JSON.parse(out);
}

function conditionsTargetDefault(conditions) {
  // A ruleset's ref conditions may name the default branch via the ~DEFAULT_BRANCH alias or an
  // explicit refs/heads/main include. Be liberal in what we accept as "covers main".
  const blob = JSON.stringify(conditions || {});
  return blob.includes('~DEFAULT_BRANCH') || blob.includes('~ALL') || blob.includes('refs/heads/main');
}

try {
  const rulesets = ghApiJson('repos/{owner}/{repo}/rulesets?includes_parents=true');
  const list = Array.isArray(rulesets) ? rulesets : [];
  const active = list.filter((r) => String(r.enforcement || '').toLowerCase() === 'active');
  if (active.length === 0) {
    console.error('ruleset-probe: no ACTIVE ruleset on the repository — `main` is not protected. Refuse closure.');
    process.exit(2);
  }

  for (const r of active) {
    // The list endpoint omits rules/conditions; fetch the ruleset detail when needed.
    let detail = r;
    if (!Array.isArray(r.rules) || !r.conditions) {
      try { detail = ghApiJson(`repos/{owner}/{repo}/rulesets/${r.id}`); } catch { /* keep summary */ }
    }
    const ruleTypes = (detail.rules || []).map((x) => x.type);
    if (conditionsTargetDefault(detail.conditions) && ruleTypes.includes('pull_request')) {
      const extras = ['non_fast_forward', 'deletion', 'required_status_checks'].filter((t) => ruleTypes.includes(t));
      console.log(`ruleset-probe: default branch protected by ruleset "${detail.name || detail.id}" (requires PR${extras.length ? '; also ' + extras.join(', ') : ''}). OK to enter closure.`);
      process.exit(0);
    }
  }

  console.error('ruleset-probe: active ruleset(s) exist but none requires a pull request on the default branch. Refuse closure.');
  process.exit(3);
} catch (e) {
  console.error(`ruleset-probe: failed to query rulesets via \`gh api\`: ${e && e.message ? e.message : e}. Refuse closure.`);
  process.exit(1);
}
