import { readFile } from "node:fs/promises";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import manifest from "../../../public/i18n/gtnh/manifest.json";
import type { DatasetResourceIndexEntry } from "@/lib/datasets/types";

export interface LocalizedSearchResource extends DatasetResourceIndexEntry {
  zh?: string;
  made: number;
  uses: number;
  sources: Array<"plants" | "bees">;
}
interface SearchPack {
  datasetHash: string;
  resources: LocalizedSearchResource[];
}
const packs = new Map<string, Promise<SearchPack>>();
const versions: Record<string, { datasetHash: string; search: string }> = manifest.datasets;
export function localizedDatasetHash(id: string): string | undefined {
  return versions[id]?.datasetHash;
}
export async function loadLocalizedResources(version: string): Promise<SearchPack> {
  const entry = versions[version];
  if (!entry) throw new Error("No localized search index for this dataset");
  let pending = packs.get(version);
  if (!pending) {
    pending = readFile(path.join(process.cwd(), "public/i18n/gtnh", entry.search))
      .then((bytes) => {
        const pack = JSON.parse(gunzipSync(bytes).toString("utf8")) as SearchPack;
        if (pack.datasetHash !== entry.datasetHash)
          throw new Error("Localized search index checksum mismatch");
        return pack;
      })
      .catch((error) => {
        packs.delete(version);
        throw error;
      });
    packs.set(version, pending);
    if (packs.size > 2) packs.delete(packs.keys().next().value!);
  }
  return pending;
}
export interface LocalizedSearchQuery {
  query: string;
  offset: number;
  limit: number;
  kind?: string;
  mod?: string;
  source?: string;
  sort?: string;
}
const normalize = (text: string) => text.normalize("NFKC").toLowerCase();
/** Returns canonical English resources. Translations stay in the presentation pack. */
export function searchLocalizedResources(
  resources: readonly LocalizedSearchResource[],
  query: LocalizedSearchQuery,
) {
  const terms = normalize(query.query).trim().split(/\s+/).filter(Boolean);
  const mods = new Map<string, number>();
  const modOf = (resource: LocalizedSearchResource) =>
    resource.id.includes(":")
      ? resource.id.split(":")[0]
      : resource.kind === "fluid"
        ? "fluids"
        : "other";
  const matches: Array<{ resource: LocalizedSearchResource; score: number; mod: string }> = [];
  for (const resource of resources) {
    if (
      (query.kind && query.kind !== resource.kind) ||
      (query.source && !resource.sources.includes(query.source as "plants" | "bees"))
    )
      continue;
    const en = normalize(resource.displayName ?? resource.id),
      zh = normalize(resource.zh ?? ""),
      id = normalize(resource.id);
    if (!terms.every((term) => en.includes(term) || zh.includes(term) || id.includes(term)))
      continue;
    const mod = modOf(resource);
    if (mod) mods.set(mod, (mods.get(mod) ?? 0) + 1);
    if (query.mod && mod !== query.mod) continue;
    const score = terms.reduce(
      (sum, term) =>
        sum +
        (en === term || zh === term ? 100 : en.startsWith(term) || zh.startsWith(term) ? 60 : 20),
      0,
    );
    matches.push({ resource, score, mod });
  }
  const collator = new Intl.Collator("zh-CN", { numeric: true });
  const byName = (a: (typeof matches)[number], b: (typeof matches)[number]) =>
    collator.compare(
      a.resource.zh ?? a.resource.displayName ?? a.resource.id,
      b.resource.zh ?? b.resource.displayName ?? b.resource.id,
    ) || a.resource.id.localeCompare(b.resource.id);
  matches.sort((a, b) => {
    if (query.sort === "name") return byName(a, b);
    if (query.sort === "mod") return a.mod.localeCompare(b.mod) || byName(a, b);
    if (query.sort === "made" || query.sort === "uses")
      return b.resource[query.sort] - a.resource[query.sort] || b.score - a.score || byName(a, b);
    if (query.sort === "recipes")
      return b.resource.recipeCount - a.resource.recipeCount || b.score - a.score || byName(a, b);
    return b.score - a.score || b.resource.recipeCount - a.resource.recipeCount || byName(a, b);
  });
  const page = matches.slice(query.offset, query.offset + query.limit).map(({ resource }) => {
    const { zh, made, uses, sources, ...canonical } = resource;
    return canonical;
  });
  return {
    resources: page,
    total: matches.length,
    offset: query.offset,
    limit: query.limit,
    hasMore: query.offset + query.limit < matches.length,
    mods: [...mods].map(([id, count]) => ({ id, count })),
    searchPhase: "exact" as const,
  };
}
