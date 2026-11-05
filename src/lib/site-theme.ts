"use client";

import { useSyncExternalStore } from "react";

export type SiteTheme = "light" | "dark";
export const THEME_EVENT = "gtnh-theme-change";

function readTheme(): SiteTheme {
  return typeof document !== "undefined" && document.documentElement.dataset.theme === "dark"
    ? "dark"
    : "light";
}

function subscribe(notify: () => void) {
  window.addEventListener(THEME_EVENT, notify);
  return () => window.removeEventListener(THEME_EVENT, notify);
}

export function useSiteTheme(): SiteTheme {
  return useSyncExternalStore(subscribe, readTheme, () => "light");
}
