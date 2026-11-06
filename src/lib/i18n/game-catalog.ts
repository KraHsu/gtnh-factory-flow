export interface GameTranslationPack {
  schemaVersion: 1;
  datasetVersionId: string;
  datasetHash: string;
  names: Record<string, string>;
  aliases?: Record<string, string>;
  resources: Record<string, [english: string, chinese: string | null, tooltip: string[] | null]>;
}
interface GameManifest {
  schemaVersion: 1;
  datasets: Record<string, { datasetHash: string; messages: string }>;
}
export type GameLanguageStatus = "idle" | "loading" | "ready" | "unavailable";
let active: GameTranslationPack | undefined;
let revision = 0;
let generation = 0;
let status: GameLanguageStatus = "idle";
let manifest: Promise<GameManifest> | undefined;
const cache = new Map<string, GameTranslationPack>();
const pendingPacks = new Map<string, Promise<GameTranslationPack>>();
let desiredKey = "";
const fetchGame = (url: string) =>
  fetch(url, {
    signal: typeof AbortSignal.timeout === "function" ? AbortSignal.timeout(12000) : undefined,
  });
const listeners = new Set<() => void>();
export const subscribeGameLanguage = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
export const gameLanguageRevision = () => revision;
export const gameLanguageStatus = () => status;
function emit() {
  revision++;
  for (const listener of listeners) listener();
}

/** Locale data is a display layer. It never mutates the recipes or project. */
export async function loadGameLanguage(version: {
  id: string;
  checksumSha256?: string;
}): Promise<void> {
  const key = version.id + ":" + version.checksumSha256;
  if (desiredKey === key && status === "ready") return;
  if (desiredKey === key && status === "loading" && pendingPacks.has(key)) {
    await pendingPacks.get(key)!.catch(() => undefined);
    return;
  }
  desiredKey = key;
  const ticket = ++generation;
  active = cache.get(key);
  status = active ? "ready" : "loading";
  emit();
  if (active) return;
  try {
    let pending = pendingPacks.get(key);
    if (!pending) {
      pending = (async () => {
        manifest ??= fetchGame("/i18n/gtnh/manifest.json")
          .then(async (response) => {
            if (!response.ok) throw new Error("Game language manifest unavailable");
            return (await response.json()) as GameManifest;
          })
          .catch((error) => {
            manifest = undefined;
            throw error;
          });
        const entry = (await manifest).datasets[version.id];
        if (
          !entry ||
          entry.datasetHash !== version.checksumSha256 ||
          !entry.messages.startsWith("/i18n/gtnh/")
        )
          throw new Error("No matching game language pack");
        const response = await fetchGame(entry.messages);
        if (!response.ok) throw new Error("Game language pack unavailable");
        const pack = (await response.json()) as GameTranslationPack;
        if (
          pack.schemaVersion !== 1 ||
          pack.datasetVersionId !== version.id ||
          pack.datasetHash !== version.checksumSha256 ||
          !pack.names ||
          !pack.resources
        )
          throw new Error("Game language pack version mismatch");
        return pack;
      })().finally(() => pendingPacks.delete(key));
      pendingPacks.set(key, pending);
    }
    const pack = await pending;
    cache.set(key, pack);
    if (cache.size > 2) cache.delete(cache.keys().next().value!);
    if (ticket !== generation) return;
    active = pack;
    status = "ready";
  } catch {
    if (ticket !== generation) return;
    active = undefined;
    status = "unavailable";
  }
  emit();
}
export function gameText(locale: string, text: string): string {
  if (locale !== "zh-CN" || !active) return text;
  const direct = active.names[text];
  if (typeof direct === "string") return direct;
  // Ore categories display a concrete member name prefixed with "Any".
  if (text.startsWith("Any ")) {
    const member = active.names[text.slice(4)];
    if (typeof member === "string") return "任意" + member;
  }
  const parts = text.split(": ");
  if (parts.length === 2 && parts.every((part) => Object.hasOwn(active!.names, part)))
    return parts.map((part) => active!.names[part]).join("：");
  for (const separator of [", ", " and "]) {
    const labels = text.split(separator);
    if (labels.length > 1 && labels.every((label) => Object.hasOwn(active!.names, label)))
      return labels.map((label) => active!.names[label]).join("、");
  }
  return text;
}
export function gameResourceLabel(
  locale: string,
  resource: { kind: string; id: string; displayName?: string },
): string {
  const english = resource.displayName ?? resource.id;
  if (locale !== "zh-CN" || !active) return english;
  const entry = active.resources[resource.kind + ":" + resource.id];
  return entry?.[0] === english && entry[1] ? entry[1] : english;
}
export function gameResourceTooltip(
  locale: string,
  resource: { kind: string; id: string; displayName?: string; tooltip?: readonly string[] },
): readonly string[] {
  if (locale !== "zh-CN" || !active) return resource.tooltip ?? [];
  const entry = active.resources[resource.kind + ":" + resource.id];
  return entry?.[0] === resource.displayName && entry[2] ? entry[2] : (resource.tooltip ?? []);
}
export function supportsGameLanguage(versionId: string, checksum?: string): boolean {
  return active?.datasetVersionId === versionId && active.datasetHash === checksum;
}

/** Recipe-book name filters keep the upstream query semantics and canonical names. */
export function localizedGameQuery(query: string, version: string, checksum?: string): string {
  if (!supportsGameLanguage(version, checksum) || !active?.aliases) return query;
  const source = query.trim();
  if (Object.hasOwn(active.aliases, source)) return active.aliases[source];
  return query
    .split(/(\s+)/)
    .map((part) =>
      active!.aliases && Object.hasOwn(active!.aliases, part) ? active!.aliases[part] : part,
    )
    .join("");
}
