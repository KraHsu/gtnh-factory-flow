"use client";

import { useEffect, useState } from "react";
import { THEME_EVENT } from "@/lib/site-theme";
import { getLocale, setLocale, useLocale, useT } from "@/lib/i18n";

type Theme = "light" | "dark";
const THEME_KEY = "gtnh-theme.v1";

export function SiteHeader() {
  const t = useT();
  const locale = useLocale();
  const [theme, setTheme] = useState<Theme>("light");
  useEffect(() => {
    document.documentElement.lang = getLocale();
    setTheme(document.documentElement.dataset.theme === "dark" ? "dark" : "light");
    const update = (event: StorageEvent) => {
      if (event.key !== THEME_KEY && event.key !== null) return;
      const next = event.newValue === "dark" ? "dark" : "light";
      document.documentElement.dataset.theme = next;
      setTheme(next);
      window.dispatchEvent(new Event(THEME_EVENT));
    };
    window.addEventListener("storage", update);
    return () => window.removeEventListener("storage", update);
  }, []);
  const toggleTheme = () => {
    const next = theme === "light" ? "dark" : "light";
    document.documentElement.dataset.theme = next;
    setTheme(next);
    window.dispatchEvent(new Event(THEME_EVENT));
    try {
      window.localStorage.setItem(THEME_KEY, next);
    } catch {
      /* The visual choice still applies. */
    }
  };
  return (
    <header className="ks-header">
      <a className="ks-brand" href="/" aria-label={t("GTNH Factory Planner")}>
        <span className="ks-mark" aria-hidden>
          工
        </span>
        <span>
          {t("Factory Flow")}
          <small>GREGTECH · NEW HORIZONS</small>
        </span>
      </a>
      <nav aria-label={t("Site navigation")} className="ks-nav">
        <a href="https://blog.krahsu.top/">{t("Blog")} ↗</a>
        <a href="https://iam.krahsu.top/">{t("KraHsu IAM")} ↗</a>
        <label className="ks-language">
          <span className="sr-only">{t("Language")}</span>
          <select
            aria-label={t("Language")}
            value={locale}
            onChange={(event) => setLocale(event.target.value === "zh-CN" ? "zh-CN" : "en")}
          >
            <option value="zh-CN">简体中文</option>
            <option value="en">English</option>
          </select>
        </label>
        <button
          type="button"
          onClick={toggleTheme}
          aria-label={t(theme === "light" ? "Switch to dark theme" : "Switch to light theme")}
        >
          {theme === "light" ? "☾" : "☀"}
        </button>
      </nav>
    </header>
  );
}
