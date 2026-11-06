"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import type { DatasetVersion } from "@/lib/datasets/types";
import { useLocale, useT } from ".";
import {
  gameLanguageRevision,
  gameLanguageStatus,
  gameText,
  loadGameLanguage,
  subscribeGameLanguage,
} from "./game-catalog";
import type { MessageTranslator } from "./message";

export function useGameT() {
  const locale = useLocale();
  const revision = useSyncExternalStore(subscribeGameLanguage, gameLanguageRevision, () => 0);
  return useCallback((text: string) => gameText(locale, text), [locale, revision]);
}

/** Game names are localized only in presentation components that opt in. */
export function useDisplayT(): MessageTranslator {
  const t = useT();
  const game = useGameT();
  return useCallback(
    (key, values) =>
      game(
        t(
          key,
          values &&
            Object.fromEntries(
              Object.entries(values).map(([name, value]) => [
                name,
                typeof value === "string" ? game(t(value)) : value,
              ]),
            ),
        ),
      ),
    [t, game],
  );
}

export function DatasetLanguage({ version }: { version?: DatasetVersion }) {
  const locale = useLocale();
  const t = useT();
  useSyncExternalStore(subscribeGameLanguage, gameLanguageRevision, () => 0);
  useEffect(() => {
    if (locale === "zh-CN" && version) void loadGameLanguage(version);
  }, [locale, version?.id, version?.checksumSha256]);
  return locale === "zh-CN" && gameLanguageStatus() === "unavailable" ? (
    <p role="status" className="border-b border-line px-4 py-1 text-xs text-fg-muted">
      {t("Chinese item names are temporarily unavailable. You can still search in English.")}
    </p>
  ) : null;
}
