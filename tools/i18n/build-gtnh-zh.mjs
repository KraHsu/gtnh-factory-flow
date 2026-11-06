import fs from "node:fs";
import path from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  languagePairs,
  translationIndex,
  tooltipTemplates,
  translateTooltip,
  assetLanguagePairs,
  chineseOverrides,
  oreTooltip,
} from "./gtnh-languages.mjs";

const [
  translations,
  datasetFile,
  lookupFile,
  manifestFile,
  output = "public/i18n/gtnh",
  assetsFile,
] = process.argv.slice(2);
if (!translations || !datasetFile || !lookupFile || !manifestFile)
  throw new Error(
    "Usage: node tools/i18n/build-gtnh-zh.mjs <GTNH-Translations checkout> <resource-index.json.gz> <recipe-lookup-index.json.gz> <datasets.manifest.json> [output] [game-assets.json]",
  );
const read = (file) => {
  const bytes = fs.readFileSync(file);
  return JSON.parse((bytes[0] === 31 ? gunzipSync(bytes) : bytes).toString("utf8"));
};
const data = read(datasetFile),
  lookup = read(lookupFile),
  manifest = read(manifestFile);
if (lookup.datasetVersionId !== data.datasetVersionId)
  throw new Error("Resource and recipe lookup versions differ");
const version = manifest.versions.find((v) => v.id === data.datasetVersionId);
if (!version?.checksumSha256) throw new Error("Dataset checksum is required");
const assets = assetsFile ? read(assetsFile) : undefined;
if (assets && (assets.schemaVersion !== 1 || assets.datasetVersion !== data.gtnhVersion))
  throw new Error("Game language assets do not match the dataset version");
const pairs = [
    ...languagePairs(translations),
    ...(assets ? assetLanguagePairs(assets, chineseOverrides(translations)) : []),
  ],
  index = translationIndex(pairs, { orePrefixes: assets?.orePrefixes }),
  templates = tooltipTemplates(pairs);
const plants = new Set(["Crop Farm", "IC2 Crop", "Tree Growth Simulator"]),
  bees = new Set(["Bee Produce"]);
const counts = new Map();
for (const [key, byMap] of lookup.entries) {
  const mode = key.startsWith("recipes:")
    ? "recipes"
    : key.startsWith("uses:")
      ? "uses"
      : undefined;
  if (!mode) continue;
  const resource = key.slice(mode.length + 1),
    entry = counts.get(resource) ?? { made: 0, uses: 0, sources: [] };
  entry[mode === "recipes" ? "made" : "uses"] = byMap.reduce((n, [, ids]) => n + ids.length, 0);
  if (mode === "recipes")
    for (const [map] of byMap) {
      const name = lookup.recipeMaps[map];
      if (plants.has(name) && !entry.sources.includes("plants")) entry.sources.push("plants");
      if (bees.has(name) && !entry.sources.includes("bees")) entry.sources.push("bees");
    }
  counts.set(resource, entry);
}
const translated = {},
  resolvedNames = new Map(),
  search = [],
  tipCache = new Map();
let names = 0,
  tips = 0,
  tipLines = 0,
  generatedTipLines = 0;
for (const resource of data.resourceIndex) {
  const key = resource.kind + ":" + resource.id,
    en = resource.displayName ?? resource.id,
    zh = index.resourceName(resource);
  const domain = resource.modId?.toLowerCase() ?? resource.id.split(":")[0].toLowerCase();
  const tooltip = resource.tooltip?.map((line) => {
    const generated = oreTooltip(resource, line, index);
    if (generated) {
      generatedTipLines++;
      return generated;
    }
    const cacheKey = domain + "\0" + line;
    if (!tipCache.has(cacheKey))
      tipCache.set(cacheKey, translateTooltip(line, domain, index, templates));
    return tipCache.get(cacheKey);
  });
  const changed = tooltip?.some((line, i) => line !== resource.tooltip[i]);
  if (zh) {
    names++;
    const translations = resolvedNames.get(en) ?? new Set();
    translations.add(zh);
    resolvedNames.set(en, translations);
  }
  if (changed) {
    tips++;
    tipLines += tooltip.filter((line, i) => line !== resource.tooltip[i]).length;
    for (let i = 0; i < tooltip.length; i++)
      if (tooltip[i] !== resource.tooltip[i]) {
        const translations = resolvedNames.get(resource.tooltip[i]) ?? new Set();
        translations.add(tooltip[i]);
        resolvedNames.set(resource.tooltip[i], translations);
      }
  }
  if (zh || changed) translated[key] = [en, zh ?? null, changed ? tooltip : null];
  const statistics = counts.get(key) ?? { made: 0, uses: 0, sources: [] };
  search.push({ ...resource, zh: zh ?? undefined, ...statistics });
}
const text = {};
for (const [en, values] of resolvedNames) if (values.size === 1) text[en] = [...values][0];
const titles = new Set(
  [
    ...data.recipeMaps,
    ...(data.machineHandlerIcons ?? []).flatMap((x) => [
      x.familyId,
      x.resource?.displayName,
      ...(x.tiers ?? []).map((t) => t.resource?.displayName),
    ]),
  ].filter(Boolean),
);
for (const en of titles) {
  const recipeLabels = new Set(
    pairs
      .filter((pair) => pair.key.startsWith("gt.recipe.") && pair.en === en)
      .map((pair) => pair.zh),
  );
  const zh = recipeLabels.size === 1 ? [...recipeLabels][0] : index.exact(en, "gregtech");
  if (zh) text[en] = zh;
}
const commit = execFileSync("git", ["-C", translations, "rev-parse", "HEAD"], {
  encoding: "utf8",
}).trim();
const source = {
  repository: "https://github.com/GTNewHorizons/GTNH-Translations",
  commit,
  translationLicense: "CC-BY-NC-SA (as declared in the Chinese translation README)",
  attribution: "GTNH Chinese translation contributors / ParaTranz project 4964",
  datasetVersion: data.gtnhVersion,
  method:
    "Paired language keys, pinned built-in game languages, GTNH overrides, material/tool templates and unanimous ore alternatives; ambiguous matches fall back to English.",
  ...(assets
    ? {
        gameAssets: {
          sourceInventory: "/i18n/gtnh/game-sources/sources.json",
          modpackVersion: assets.datasetVersion,
          modpackSha256: assets.lock.modpack.sha256,
          minecraftVersion: assets.lock.minecraft.version,
          jars: assets.sources.length - 1,
          languageDomains: assets.languages.length,
          assetBundleSha256: createHash("sha256").update(fs.readFileSync(assetsFile)).digest("hex"),
        },
      }
    : {}),
};
const coverage = {
  resources: data.resourceIndex.length,
  translatedNames: names,
  translatedTooltipResources: tips,
  translatedTooltipLines: tipLines,
  translatedGameTooltipLines: tipLines - generatedTipLines,
  translatedGeneratedTooltipLines: generatedTipLines,
  languagePairs: pairs.length,
};
const aliasSets = new Map();
for (const [en, zh] of [
  ...Object.entries(text),
  ...pairs
    .filter((p) => p.key.startsWith("Material.") && !p.key.endsWith("ChemicalFormula"))
    .map((p) => [p.en, p.zh]),
]) {
  const names = aliasSets.get(zh) ?? new Set();
  names.add(en);
  aliasSets.set(zh, names);
}
const aliases = {};
for (const [zh, values] of aliasSets) if (values.size === 1) aliases[zh] = [...values][0];
const pack = {
  schemaVersion: 1,
  datasetVersionId: data.datasetVersionId,
  datasetHash: version.checksumSha256,
  source,
  coverage,
  names: text,
  aliases,
  resources: translated,
};
const bytes = JSON.stringify(pack) + "\n",
  hash = createHash("sha256").update(bytes).digest("hex").slice(0, 16);
const directory = path.join(output, data.datasetVersionId);
fs.mkdirSync(directory, { recursive: true });
fs.writeFileSync(path.join(directory, `zh-CN.${hash}.json`), bytes);
fs.writeFileSync(
  path.join(directory, "resources.json.gz"),
  gzipSync(
    JSON.stringify({
      schemaVersion: 1,
      datasetVersionId: data.datasetVersionId,
      datasetHash: version.checksumSha256,
      resources: search,
    }) + "\n",
    { level: 9 },
  ),
);
const outManifest = path.join(output, "manifest.json"),
  previous = fs.existsSync(outManifest) ? read(outManifest) : { schemaVersion: 1, datasets: {} };
previous.datasets[data.datasetVersionId] = {
  datasetHash: version.checksumSha256,
  messages: `/i18n/gtnh/${data.datasetVersionId}/zh-CN.${hash}.json`,
  search: `${data.datasetVersionId}/resources.json.gz`,
  coverage,
};
fs.writeFileSync(outManifest, JSON.stringify(previous, null, 2) + "\n");
fs.writeFileSync(
  path.join(directory, "provenance.json"),
  JSON.stringify(
    {
      ...source,
      coverage,
      resourceIndexSha256: createHash("sha256").update(fs.readFileSync(datasetFile)).digest("hex"),
      lookupIndexSha256: createHash("sha256").update(fs.readFileSync(lookupFile)).digest("hex"),
    },
    null,
    2,
  ) + "\n",
);
fs.copyFileSync(path.join(translations, "LICENSE"), path.join(output, "UPSTREAM-LICENSE"));
fs.writeFileSync(
  path.join(output, "NOTICE.txt"),
  `GTNH Chinese names and tooltips are derived from ${source.repository}\nRevision: ${commit}\nContributors: https://paratranz.cn/projects/4964/members\nTranslation terms: https://github.com/GTNewHorizons/GTNH-Translations/blob/${commit}/readmes/README_zh_CN.md\nThe Chinese translation README declares CC-BY-NC-SA for its translation content.\nThe upstream repository license is preserved in UPSTREAM-LICENSE.\n${assets ? "Built-in Minecraft and mod language files are from the pinned game release. Minecraft and individual mod authors retain their own rights; these are not relicensed under CC-BY-NC-SA or the planner code license.\nSource inventory and embedded license notices: /i18n/gtnh/game-sources/sources.json\n" : ""}Only confirmed matching names, language templates and unanimous ore alternatives are used; recipe identities and calculations are unchanged.\nRebuild: tools/i18n/build-gtnh-zh.mjs\n`,
);
console.log(
  JSON.stringify({ ...coverage, hash, commit, packBytes: Buffer.byteLength(bytes) }, null, 2),
);
