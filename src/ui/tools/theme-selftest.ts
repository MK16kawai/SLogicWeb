// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Daniel Tralamazza
/**
 * Node entry point for the theme core suite.
 *
 *   node_modules/.bin/esbuild src/ui/tools/theme-selftest.ts --bundle --format=esm \
 *     --platform=node --outfile=/tmp/theme-selftest.mjs && node /tmp/theme-selftest.mjs
 *
 * Run from the repository root. Prints PASS/FAIL per check and exits non-zero on any
 * failure.
 *
 * What is pinned here:
 *
 *   - the theme registry and the storage-key literal;
 *   - pickTheme falls back to 'default' for absent and unknown stored values;
 *   - every theme has a label key that exists (non-empty) in the English catalog;
 *   - a fresh module boots to 'default' - asserted BEFORE any stub injection, so the
 *     node-safety of module evaluation is part of the pass;
 *   - setTheme persists the pick, applies the <html> attribute, and notifies exactly
 *     once per real change; a same-id pick is a silent no-op (no write, no notify);
 *   - the returned unsubscribe stops further notifications;
 *   - a storage whose getItem/setItem throw does not break boot or the switch.
 *
 * The checks are ordered fresh-state first, mutation last: checks 5-8 inject fake
 * localStorage/document globals, so an earlier check must not observe them.
 */

import { en } from '../locales/en.js';
import {
  getTheme, initTheme, onThemeChange, pickTheme, setTheme,
  THEME_LABEL_KEYS, THEME_STORAGE_KEY, THEMES, type ThemeId,
} from '../theme.js';

/** Same structural-typing trick as i18n-selftest.ts: node access without @types/node. */
const nodeProcess = (() => {
  const p = (globalThis as {
    process?: { exit(code: number): never };
  }).process;
  if (!p || typeof p.exit !== 'function') throw new Error('this entry point only runs under node');
  return p;
})();

interface TestResult {
  name: string;
  pass: boolean;
  detail: string;
}

const results: TestResult[] = [];

function check(name: string, pass: boolean, detail: string): void {
  results.push({ name, pass, detail });
}

/**
 * Install a global for the mutation checks. Object.defineProperty rather than a plain
 * assignment so the stub wins even where node exposes the name as an accessor.
 */
function defineGlobal(name: 'localStorage' | 'document', value: unknown): void {
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
}

// ------------------------------------------------------------------ registry

{
  const ids = [...THEMES].join(',');
  check('THEMES is exactly default,dark and the storage key is logicweb.theme',
    ids === 'default,dark' && THEME_STORAGE_KEY === 'logicweb.theme',
    `themes=[${ids}], key=${THEME_STORAGE_KEY}`);
}

// ------------------------------------------------------------------ pickTheme

{
  const absent = pickTheme(null);
  const unknown = pickTheme('xx');
  const dark = pickTheme('dark');
  const fallback = pickTheme('default');
  check('pickTheme falls back to default for absent/unknown, keeps known ids',
    absent === 'default' && unknown === 'default' && dark === 'dark' && fallback === 'default',
    `null→${absent}, xx→${unknown}, dark→${dark}, default→${fallback}`);
}

// ------------------------------------------- label keys ↔ en catalog

{
  const catalog = en as Record<string, string>;
  const missing = THEMES.filter((id) => {
    const key = THEME_LABEL_KEYS[id];
    return key === undefined || (catalog[key] ?? '').trim() === '';
  });
  const extra = Object.keys(THEME_LABEL_KEYS)
    .filter((k) => !(THEMES as readonly string[]).includes(k));
  check('every theme has a non-empty label key present in the en catalog',
    missing.length === 0 && extra.length === 0,
    missing.length === 0 && extra.length === 0
      ? THEMES.map((id) => `${id}=${THEME_LABEL_KEYS[id]}`).join(', ')
      : `missing=${missing.join(',') || '(none)'} extra=${extra.join(',') || '(none)'}`);
}

// ------------------------------------------------- fresh-state node boot

{
  // Asserted before any stub: the module was bundled --platform=node, so reaching
  // this line already proves module evaluation touched neither storage nor the DOM
  // (either touch would have thrown), and the state must be the mandated default.
  const boot = getTheme();
  check('a fresh module boots to default before any storage/DOM access',
    boot === 'default', `getTheme()=${boot}`);
}

// ------------------------------------------------- mutation checks (ordered)

// 5. Persistence + notification, and the same-id no-op.
{
  const writes: [string, string][] = [];
  defineGlobal('localStorage', {
    getItem: () => null,
    setItem: (key: string, value: string) => { writes.push([key, value]); },
  });
  let notified = 0;
  const unsubscribe = onThemeChange(() => { notified += 1; });

  setTheme('dark');
  const afterFirst = { theme: getTheme(), writes: writes.length, notified };
  setTheme('dark'); // same id: must not persist or notify again
  unsubscribe();

  const ok = afterFirst.theme === 'dark' && afterFirst.writes === 1 && afterFirst.notified === 1 &&
    writes.length === 1 && writes[0]?.[0] === THEME_STORAGE_KEY && writes[0]?.[1] === 'dark' &&
    notified === 1;
  check('setTheme persists and notifies once, and a same-id pick is a silent no-op',
    ok, `theme=${getTheme()}, writes=${writes.length}, notified=${notified}`);
}

// 6. One notification per real change; unsubscribe stops the stream.
{
  let fired = 0;
  const unsubscribe = onThemeChange(() => { fired += 1; });
  setTheme('default'); // real change
  const afterReal = fired;
  setTheme('default'); // no-op
  unsubscribe();
  setTheme('dark'); // real change while unsubscribed
  check('onThemeChange fires once per real change and unsubscribe stops it',
    afterReal === 1 && fired === 1 && getTheme() === 'dark',
    `afterReal=${afterReal}, fired=${fired}, theme=${getTheme()}`);
}

// 7. The <html data-theme> side effect.
{
  setTheme('default'); // settle before the stub goes in
  const doc = { documentElement: { dataset: {} as Record<string, string> } };
  defineGlobal('document', doc);
  setTheme('dark');
  check('applyTheme writes the theme id onto <html data-theme>',
    doc.documentElement.dataset.theme === 'dark',
    `data-theme=${JSON.stringify(doc.documentElement.dataset.theme)}`);
}

// 8. Throwing storage must not break boot or the switch.
{
  defineGlobal('localStorage', {
    getItem: () => { throw new Error('storage denied'); },
    setItem: () => { throw new Error('storage denied'); },
  });
  let booted: ThemeId = 'default';
  let bootThrew = false;
  try {
    booted = initTheme();
  } catch {
    bootThrew = true;
  }
  const afterBoot = getTheme();
  let switchThrew = false;
  try {
    setTheme('dark');
  } catch {
    switchThrew = true;
  }
  check('throwing storage does not break boot or the in-memory switch',
    !bootThrew && booted === 'default' && afterBoot === 'default' && !switchThrew &&
    getTheme() === 'dark',
    `boot=${booted}, bootThrew=${bootThrew}, switchThrew=${switchThrew}, theme=${getTheme()}`);
}

// ---------------------------------------------------------------------- report

console.log(results.map((r) => `${r.pass ? 'PASS' : 'FAIL'}  ${r.name}\n        ${r.detail}`).join('\n'));
const failed = results.filter((r) => !r.pass).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
nodeProcess.exit(failed === 0 ? 0 : 1);
