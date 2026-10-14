// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Daniel Tralamazza
/**
 * Node entry point for the i18n core suite.
 *
 *   node_modules/.bin/esbuild src/ui/tools/i18n-selftest.ts --bundle --format=esm \
 *     --platform=node --outfile=/tmp/i18n-selftest.mjs && node /tmp/i18n-selftest.mjs
 *
 * Run from the repository root (later checks read index.html relative to the CWD).
 * Prints PASS/FAIL per check and exits non-zero on any failure.
 *
 * What is pinned here:
 *
 *   - formatMessage interpolates exactly, and leaves an unknown `{var}` literal in
 *     the output instead of swallowing it (the visible-failure contract);
 *   - pickLocale falls back to 'en' for absent and for unknown stored values;
 *   - translate() falls back to the English string when a dict lacks the key - the
 *     incomplete dict is a Partial<Messages> cast, so the Messages type itself stays
 *     intact;
 *   - the English catalog itself is sane: non-empty, no empty values, balanced
 *     braces, well-formed placeholder names.
 *
 * Catalog key PARITY across locales is deliberately absent here: with a single
 * locale it could never fail, and a tautological check is worse than none
 * (.trellis/spec/frontend/quality-guidelines.md §3). It arrives with the second
 * catalog in the translations commit.
 */

import { en, type Messages } from '../locales/en.js';
import {
  formatMessage, getLocale, LOCALE_LABELS, LOCALES, pickLocale, t, translate,
} from '../i18n.js';

/** Same structural-typing trick as sr-selftest.ts: node access without @types/node. */
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

// ------------------------------------------------------------------ interpolation

{
  const got = formatMessage('{count} samples @ {rate}', { count: 2048, rate: '100 MHz' });
  check('formatMessage interpolates every named var',
    got === '2048 samples @ 100 MHz', got);
}

{
  const got = formatMessage('{count} samples @ {rate}', { count: 7 });
  check('formatMessage leaves an unknown {var} literal (visible failure)',
    got === '7 samples @ {rate}', got);
}

{
  const got = formatMessage('plain text, no vars', { unused: 1 });
  check('formatMessage leaves a var-less template untouched',
    got === 'plain text, no vars', got);
}

// ------------------------------------------------------------------ locale pick

{
  const absent = pickLocale(null);
  const unknown = pickLocale('xx-YY');
  const known = pickLocale('en');
  check('pickLocale falls back to en for absent/unknown, keeps a known locale',
    absent === 'en' && unknown === 'en' && known === 'en',
    `null→${absent}, xx-YY→${unknown}, en→${known}`);
}

// ------------------------------------------------------------------ translation

{
  const got = translate(undefined, 'toolbar.start');
  check('translate with no dict falls back to English',
    got === 'Start', got);
}

{
  const partial = { 'toolbar.start': 'Démarrer' } as Partial<Messages>;
  const hit = translate(partial, 'toolbar.start');
  const miss = translate(partial, 'toolbar.save');
  check('translate prefers the dict and falls back per missing key',
    hit === 'Démarrer' && miss === 'Save', `dict→${hit}, missing→${miss}`);
}

{
  // Under node there is no stored locale, so the module must boot to English and
  // t() must serve it - this is the fresh-visitor default the PRD mandates.
  const got = getLocale();
  const rendered = t('toolbar.fit');
  check('default locale is en and t() serves it without any setup',
    got === 'en' && rendered === 'Fit', `locale=${got}, t(toolbar.fit)=${rendered}`);
}

// ---------------------------------------------------------- catalog sanity (en)

{
  const keys = Object.keys(en);
  check('the English catalog is non-empty',
    keys.length > 0, `${keys.length} keys`);
}

{
  const empty = Object.entries(en).filter(([, v]) => v.trim() === '').map(([k]) => k);
  check('no empty message values',
    empty.length === 0, empty.length === 0 ? 'all values non-empty' : empty.join(', '));
}

{
  const bad = Object.entries(en).filter(([, v]) => {
    const opens = (v.match(/\{/g) ?? []).length;
    const closes = (v.match(/\}/g) ?? []).length;
    if (opens !== closes) return true;
    // Every placeholder must be a well-formed {name}.
    const stripped = v.replace(/\{\w+\}/g, '');
    return stripped.includes('{') || stripped.includes('}');
  }).map(([k]) => k);
  check('every template has balanced, well-formed {placeholders}',
    bad.length === 0, bad.length === 0 ? 'all templates well-formed' : bad.join(', '));
}

{
  const missing = LOCALES.filter((l) => !(l in LOCALE_LABELS) || LOCALE_LABELS[l] === '');
  check('LOCALE_LABELS names every registered locale',
    missing.length === 0,
    missing.length === 0 ? LOCALES.map((l) => `${l}=${LOCALE_LABELS[l]}`).join(', ') : missing.join(','));
}

// ---------------------------------------------------------------------- report

console.log(results.map((r) => `${r.pass ? 'PASS' : 'FAIL'}  ${r.name}\n        ${r.detail}`).join('\n'));
const failed = results.filter((r) => !r.pass).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
nodeProcess.exit(failed === 0 ? 0 : 1);
