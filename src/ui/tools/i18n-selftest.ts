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
import { formatAnalyzerNote, formatCaptureLabel, formatStatusError } from '../format.js';
import type { AnalyzerNote, CaptureLabel } from '../state.js';

/** Same structural-typing trick as sr-selftest.ts: node access without @types/node. */
const nodeProcess = (() => {
  const p = (globalThis as {
    process?: {
      exit(code: number): never;
      getBuiltinModule?(name: string): unknown;
    };
  }).process;
  if (!p || typeof p.exit !== 'function') throw new Error('this entry point only runs under node');
  return p;
})();

interface FsLike {
  readFileSync(p: string, enc: 'utf8'): string;
}

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

// ------------------------------------------- index.html static chrome (check 5)
// The HTML attribute keys cannot be type-checked by tsc, so pin them here instead:
// every data-i18n / data-i18n-title value must name a real catalog key, and the
// element's literal fallback text must equal the English catalog value - the
// "English rendering unchanged" control (PRD §8), not just key existence.

{
  const fs = nodeProcess.getBuiltinModule?.('fs') as FsLike | undefined;
  if (!fs || typeof fs.readFileSync !== 'function') throw new Error('node fs module unavailable');
  const html = fs.readFileSync('index.html', 'utf8');
  const catalog = en as Record<string, string>;

  // Elements whose textContent is translated: pure-text inner content only.
  const textFound = new Map<string, string>();
  for (const m of html.matchAll(/<\w+[^>]*\sdata-i18n="([^"]+)"[^>]*>([^<]*)<\//g)) {
    textFound.set(m[1]!, m[2]!);
  }
  // Elements whose title attribute is translated.
  const titleFound = new Map<string, string>();
  for (const m of html.matchAll(/<[^>]*\sdata-i18n-title="[^"]+"[^>]*>/g)) {
    const tag = m[0];
    const key = /data-i18n-title="([^"]+)"/.exec(tag)?.[1];
    const title = /\stitle="([^"]*)"/.exec(tag)?.[1];
    if (key !== undefined && title !== undefined) titleFound.set(key, title);
  }

  const expectedText = [
    'toolbar.start', 'toolbar.open', 'toolbar.save', 'toolbar.fit',
    'emptyHint.line1', 'emptyHint.line2',
  ];
  const expectedTitles = [
    'toolbar.startTitle', 'toolbar.openTitle', 'toolbar.saveTitle', 'toolbar.fitTitle',
    'rail.deviceTitle', 'rail.analyzersTitle',
  ];

  const missingTextKeys = expectedText.filter((k) => !textFound.has(k));
  const unknownTextKeys = [...textFound.keys()].filter((k) => !(k in catalog));
  check('index.html data-i18n keys are exactly the expected set and all exist',
    missingTextKeys.length === 0 && unknownTextKeys.length === 0 &&
    textFound.size === expectedText.length,
    `found ${textFound.size}: ${[...textFound.keys()].join(', ') || '(none)'}`);

  const missingTitleKeys = expectedTitles.filter((k) => !titleFound.has(k));
  const unknownTitleKeys = [...titleFound.keys()].filter((k) => !(k in catalog));
  check('index.html data-i18n-title keys are exactly the expected set and all exist',
    missingTitleKeys.length === 0 && unknownTitleKeys.length === 0 &&
    titleFound.size === expectedTitles.length,
    `found ${titleFound.size}: ${[...titleFound.keys()].join(', ') || '(none)'}`);

  const textDrift = [...textFound.entries()].filter(([k, text]) => catalog[k] !== text);
  check('data-i18n element fallback text equals the English catalog value',
    textDrift.length === 0,
    textDrift.length === 0 ? 'all match' :
      textDrift.map(([k, text]) => `${k}: html=${JSON.stringify(text)} en=${JSON.stringify(catalog[k])}`).join('; '));

  const titleDrift = [...titleFound.entries()].filter(([k, title]) => catalog[k] !== title);
  check('data-i18n-title attribute text equals the English catalog value',
    titleDrift.length === 0,
    titleDrift.length === 0 ? 'all match' :
      titleDrift.map(([k, title]) => `${k}: html=${JSON.stringify(title)} en=${JSON.stringify(catalog[k])}`).join('; '));
}

// ------------------------------------- structured-state formatters (render-time)
// The capture title and status error stopped being pre-formatted strings; pin every
// CaptureLabel variant and the StatusError join against the exact English the shell
// rendered before externalization.

{
  const cases: [CaptureLabel, string][] = [
    [{ kind: 'none' }, 'no capture'],
    [{ kind: 'capturing', channels: 8, rate: 100e6 }, 'capturing 8 ch @ 100 MS/s'],
    [{ kind: 'loaded', source: 'uart.sr @ 16 MSa/s, 16 probes', ms: 12 },
      'uart.sr @ 16 MSa/s, 16 probes · loaded in 12 ms'],
    [{ kind: 'stoppedNoTrigger', samples: 12345 }, 'no trigger · 12,345 samples retained'],
    [{ kind: 'live', samples: 12345, rate: 100e6, seconds: 0.5 },
      'live capture · 12,345 samples @ 100 MS/s · 500.0 ms'],
  ];
  const bad = cases.filter(([label, want]) => formatCaptureLabel(label) !== want);
  check('formatCaptureLabel renders all five variants byte-identical to before',
    bad.length === 0,
    bad.length === 0 ? `${cases.length}/5 variants match`
      : bad.map(([l, want]) => `${l.kind}: got ${JSON.stringify(formatCaptureLabel(l))} want ${JSON.stringify(want)}`).join('; '));
}

{
  const plain = formatStatusError({ what: 'error.openCapture', detail: 'zip: bad' });
  const withVars = formatStatusError({ what: 'error.decode', vars: { id: 'uart' }, detail: 'boom' });
  check('formatStatusError joins translated prefix with raw diagnostic detail',
    plain === 'open capture: zip: bad' && withVars === 'decode uart: boom',
    `${JSON.stringify(plain)}, ${JSON.stringify(withVars)}`);
}

{
  const cases: [AnalyzerNote, string][] = [
    [{ kind: 'pending' }, 'not decoded'],
    [{ kind: 'edges', count: 2048 }, '2,048 edges'],
    [{ kind: 'stats', anns: 512, decodeMs: 41.6, wallMs: 87.4 }, '512 anns, 42 ms (87 ms wall)'],
    [{ kind: 'stats', anns: 1, decodeMs: 2, wallMs: 3, firstError: 'uart: bad frame' },
      '1 anns, 2 ms (3 ms wall) · uart: bad frame'],
    [{ kind: 'timeout' }, 'timed out'],
    [{ kind: 'cancelled' }, 'cancelled'],
    [{ kind: 'error', detail: 'worker exploded' }, 'worker exploded'],
  ];
  const bad = cases.filter(([note, want]) => formatAnalyzerNote(note) !== want);
  check('formatAnalyzerNote renders every variant, diagnostics passing through raw',
    bad.length === 0,
    bad.length === 0 ? `${cases.length}/7 variants match`
      : bad.map(([n, want]) => `${n.kind}: got ${JSON.stringify(formatAnalyzerNote(n))} want ${JSON.stringify(want)}`).join('; '));
}

// ---------------------------------------------------------------------- report

console.log(results.map((r) => `${r.pass ? 'PASS' : 'FAIL'}  ${r.name}\n        ${r.detail}`).join('\n'));
const failed = results.filter((r) => !r.pass).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
nodeProcess.exit(failed === 0 ? 0 : 1);
