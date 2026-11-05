"use client";

import { useCallback, useSyncExternalStore } from "react";
import zhCN from "./zh-CN.json";

export type Locale = "en" | "zh-CN";
export const LOCALE_STORAGE_KEY = "gtnh-locale.v1";
const CHANGE_EVENT = "gtnh-locale-change";
const messages: Readonly<Record<string, string>> = zhCN;
let selected: Locale | undefined;

export function resolveLocale(stored: unknown, languages: readonly string[] = []): Locale {
  if (stored === "en" || stored === "zh-CN") return stored;
  return languages[0]?.toLowerCase().startsWith("zh") ? "zh-CN" : "en";
}

export function getLocale(): Locale {
  if (typeof window === "undefined") return "en";
  if (selected) return selected;
  let stored: string | null = null;
  try {
    stored = window.localStorage.getItem(LOCALE_STORAGE_KEY);
  } catch {
    /* Storage is optional. */
  }
  return resolveLocale(stored, window.navigator.languages ?? [window.navigator.language]);
}

export function setLocale(locale: Locale): void {
  selected = locale;
  document.documentElement.lang = locale;
  try {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    /* Keep the in-memory choice. */
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

function subscribe(notify: () => void): () => void {
  const changed = (event: Event) => {
    if (event instanceof StorageEvent && event.key !== LOCALE_STORAGE_KEY && event.key !== null)
      return;
    if (event.type === "storage") selected = undefined;
    document.documentElement.lang = getLocale();
    notify();
  };
  window.addEventListener(CHANGE_EVENT, changed);
  window.addEventListener("storage", changed);
  return () => {
    window.removeEventListener(CHANGE_EVENT, changed);
    window.removeEventListener("storage", changed);
  };
}

export function useLocale(): Locale {
  return useSyncExternalStore(subscribe, getLocale, () => "en");
}

/** English source text is the fallback. Only UI copy belongs in this catalog. */
export function translate(
  locale: Locale,
  key: string,
  values?: Record<string, string | number>,
): string {
  const text = locale === "zh-CN" ? (messages[key] ?? key) : key;
  return values
    ? text.replace(/\{(\w+)\}/g, (token, name: string) => String(values[name] ?? token))
    : text;
}

export function useT() {
  const locale = useLocale();
  return useCallback(
    (key: string, values?: Record<string, string | number>) => translate(locale, key, values),
    [locale],
  );
}
