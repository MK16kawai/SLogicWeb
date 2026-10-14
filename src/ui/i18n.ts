// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Daniel Tralamazza
/**
 * i18n core: message lookup, `{var}` interpolation, locale state, persistence.
 *
 * House-built on purpose - the project carries no runtime dependencies beyond
 * pyodide, and a four-locale string switch does not make the case for one
 * (docs/ARCHITECTURE.md: "no UI framework unless a builder makes a case for one").
 *
 * Design:
 * - The English catalog (locales/en.ts) is the source of truth for the key set;
 *   `Messages` derives from it and tsc proves every other catalog complete.
 * - Locale state is module-level with a subscriber set; panels do NOT subscribe -
 *   they call t() while rebuilding in render(), and App runs one re-render pass on
 *   change (re-render = clear and rebuild, so nothing stale survives).
 * - Persistence is localStorage['logicweb.lang'] [CHOSEN]; unknown or absent stored
 *   values fall back to 'en' (the mandated default - no browser auto-detection).
 * - The module is node-safe at top level (the tools/ self-test bundles it with
 *   --platform=node): module evaluation only reads storage behind a typeof guard;
 *   every document/localStorage touch point sits inside a function.
 */

import { en, type Messages } from './locales/en.js';

/** Known locales. Widened to the full shipping set in the translations commit. */
export const LOCALES = ['en'] as const;
export type Locale = (typeof LOCALES)[number];
export type MessageKey = keyof Messages;
export type MessageVars = Record<string, string | number>;

/**
 * Native display names for the settings menu's language list - they are registry
 * data, not message keys, so the menu reads the same labels in every locale.
 * Widened together with LOCALES [CHOSEN].
 */
export const LOCALE_LABELS: Record<Locale, string> = {
  en: 'English',
};

const DICTS: Record<Locale, Messages> = { en };

/** [CHOSEN] localStorage key holding the persisted locale. */
const STORAGE_KEY = 'logicweb.lang';

/**
 * Replace `{name}` placeholders with `String(vars[name])`. An unknown name keeps
 * its literal `{name}` in the output - a visible mistake beats a swallowed one, and
 * the self-test asserts both directions.
 */
export function formatMessage(template: string, vars?: MessageVars): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (literal, name: string) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : literal);
}

/** Validate a stored value against the known locales; anything else means 'en'. */
export function pickLocale(stored: string | null): Locale {
  return (LOCALES as readonly string[]).includes(stored ?? '') ? stored as Locale : 'en';
}

/**
 * Pure lookup + format against an explicit dict, with fallback to English. t()
 * binds the current locale's dict; the self-test drives this directly with a
 * deliberately incomplete Partial<Messages> to prove the fallback fires.
 */
export function translate(
  dict: Partial<Messages> | undefined,
  key: MessageKey,
  vars?: MessageVars,
): string {
  return formatMessage(dict?.[key] ?? en[key], vars);
}

/** Guarded storage access: undefined under node, throwing in some privacy modes. */
function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

let current: Locale = pickLocale(storage()?.getItem(STORAGE_KEY) ?? null);
const listeners = new Set<() => void>();

export function getLocale(): Locale {
  return current;
}

/**
 * Switch the active locale: persist, sync `<html lang>`, notify subscribers.
 * No-op when the locale is unchanged, so re-picking the active menu item does not
 * trigger a pointless full re-render.
 */
export function setLocale(locale: Locale): void {
  if (locale === current) return;
  current = locale;
  try {
    storage()?.setItem(STORAGE_KEY, locale);
  } catch {
    // Quota/security failures must not break the switch itself - the in-memory
    // locale already changed; persistence is best-effort.
  }
  if (typeof document !== 'undefined') document.documentElement.lang = locale;
  for (const cb of listeners) cb();
}

/** Subscribe to locale changes; returns the unsubscribe. */
export function onLocaleChange(cb: () => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

/** Translate a message key in the current locale, English as fallback. */
export function t(key: MessageKey, vars?: MessageVars): string {
  return translate(DICTS[current], key, vars);
}

/**
 * Apply the catalog to static HTML chrome: `[data-i18n]` sets textContent,
 * `[data-i18n-title]` sets the title attribute. Unknown keys warn and keep the
 * element's existing (English) text - the self-test separately asserts that every
 * attribute in index.html names a real key, so a typo fails there, not silently.
 */
export function applyStaticI18n(root: ParentNode): void {
  const dict = DICTS[current] as Record<string, string>;
  const fallback = en as Record<string, string>;
  const lookup = (key: string): string | null => {
    const v = dict[key] ?? fallback[key];
    if (v === undefined) {
      console.warn(`[i18n] unknown data-i18n key: ${key}`);
      return null;
    }
    return v;
  };
  for (const el of root.querySelectorAll<HTMLElement>('[data-i18n]')) {
    const v = lookup(el.getAttribute('data-i18n') ?? '');
    if (v !== null) el.textContent = v;
  }
  for (const el of root.querySelectorAll<HTMLElement>('[data-i18n-title]')) {
    const v = lookup(el.getAttribute('data-i18n-title') ?? '');
    if (v !== null) el.title = v;
  }
}
