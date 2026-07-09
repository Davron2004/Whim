import { CheckReport, DiagnosticKind } from '../../contract';
import { runStaticChecks } from '../../index';
import { test, assert, assertHasKind, assertNoKind, kindsOf } from '../harness';

const APP_IMPORT = "import { defineApp } from 'vc-sdk';\n";
const APP_TAIL = `
function Home() {
  return null;
}

export default defineApp({
  name: 'Hostile Case',
  initial: 'Home',
  screens: { Home },
  capabilities: [],
});
`;

function appSource(body: string): string {
  return `${APP_IMPORT}${body}\n${APP_TAIL}`;
}

interface HostileCase {
  name: string;
  source: string;
  expected: DiagnosticKind;
  check?: (report: CheckReport, source: string) => void;
}

const HOSTILE_CASES: readonly HostileCase[] = [
  {
    name: 'alias chain crosses defaults, destructuring, and callback scope',
    source: appSource(`
const root = globalThis;
const alias = root;
function choose(next = alias) {
  const { fetch: send } = next;
  return send;
}
const later = choose();
later('https://example.invalid');
`),
    expected: 'forbidden_global',
  },
  {
    name: 'computed key uses assembled fetch spelling on a tainted alias',
    source: appSource(`
const root = globalThis;
const key = ['fe', 'tc', 'h'].join('');
root[key]('https://example.invalid');
`),
    expected: 'forbidden_global',
    check: (_report, source) => {
      assert(!source.includes('fetch'), 'computed-key fixture must not spell the forbidden member token');
    },
  },
  {
    name: 'string assembly in manifest capabilities is rejected instead of trusted',
    source: `${APP_IMPORT}
function Home() {
  return null;
}

export default defineApp({
  name: 'Hostile Manifest Assembly',
  initial: 'Home',
  screens: { Home },
  capabilities: ['sto'.concat('rage')],
});
`,
    expected: 'manifest_not_static',
  },
  {
    name: 'prototype walk reaches Function through constructor aliases',
    source: appSource(`
const first = ({}).constructor;
const second = first.constructor;
second('return 1')();
`),
    expected: 'forbidden_global',
  },
  {
    name: 'pollution route through Object.defineProperty onto a shared prototype is rejected',
    source: appSource(`
Object.defineProperty(Object.prototype, 'hostile', { value: true });
`),
    expected: 'prototype_pollution',
  },
  {
    name: 'pollution route through __proto__ assignment is rejected',
    source: appSource(`
const victim = {};
victim.__proto__ = { hostile: true };
`),
    expected: 'prototype_pollution',
  },
  {
    name: 'manifest spread cannot hide computed pieces',
    source: `${APP_IMPORT}
function Home() {
  return null;
}

const hidden = { capabilities: [] };
export default defineApp({
  name: 'Hostile Spread',
  initial: 'Home',
  screens: { Home },
  ...hidden,
});
`,
    expected: 'manifest_not_static',
  },
  {
    name: 'manifest Object.assign composition is rejected as non-literal',
    source: `${APP_IMPORT}
function Home() {
  return null;
}

const base = {
  name: 'Hostile Assign',
  initial: 'Home',
  screens: { Home },
  capabilities: [],
};

export default defineApp(Object.assign({}, base));
`,
    expected: 'manifest_not_static',
  },
  {
    name: 'decoy defineApp call does not make a separate default export readable',
    source: `${APP_IMPORT}
function Home() {
  return null;
}

defineApp({
  name: 'Decoy',
  initial: 'Home',
  screens: { Home },
  capabilities: [],
});

const actual = {
  name: 'Actual',
  initial: 'Home',
  screens: { Home },
  capabilities: [],
};

export default defineApp(actual);
`,
    expected: 'manifest_not_static',
  },
];

const KNOWN_BOUNDARY_SOURCE = appSource(`
function merge(target: Record<string, unknown>, source: Record<string, unknown>) {
  for (const key in source) {
    target[key] = source[key];
  }
}

const key = ['__', 'proto__'].join('');
merge({}, { [key]: { hostile: true } });
`);

export async function runHostileCorpus(): Promise<void> {
  for (const c of HOSTILE_CASES) {
    await test(`F §hostile: ${c.name}`, () => {
      const r = runStaticChecks(c.source);
      assert(r.ok === false, `${c.name}: hostile fixture unexpectedly passed with ok:true`);
      assertHasKind(r, c.expected, `${c.name}: expected "${c.expected}", got [${kindsOf(r).join(', ')}]`);
      c.check?.(r, c.source);
    });
  }

  await test('F §hostile-negative: dynamic deep-merge pollution boundary is documented, not silently claimed', () => {
    const r = runStaticChecks(KNOWN_BOUNDARY_SOURCE);
    assertNoKind(
      r,
      'prototype_pollution',
      `runtime-shaped deep merge with computed __proto__ is the documented static boundary: expected no "prototype_pollution", got [${kindsOf(r).join(', ')}]`,
    );
  });
}
