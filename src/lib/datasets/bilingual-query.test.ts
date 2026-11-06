import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DatasetVersion } from "./types";
const hash = "a".repeat(64);
const version: DatasetVersion = {
  id: "fixture",
  gtnhVersion: "2.9.0-RC-2",
  channel: "experimental",
  publishedAt: "2026-11-05",
  manifestPath: "/manifest.json",
  recipeDatasetPath: "/recipes.json.gz",
  checksumSha256: hash,
  sourceInfo: { sourceId: "gtnh-oracle", generatedAt: "2026-11-05" },
};
beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal("window", { location: { origin: "https://planner.test" } });
});
afterEach(() => vi.unstubAllGlobals());
const json = (value: unknown) =>
  new Response(JSON.stringify(value), { headers: { "Content-Type": "application/json" } });
describe("bilingual query transport", () => {
  it("routes Chinese including extended Han characters to the local index and keeps English queries upstream", async () => {
    const requested: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        requested.push(url);
        return json({
          resources: [
            { kind: "item", id: "gregtech:plate", displayName: "Iron Plate", recipeCount: 1 },
          ],
          total: 1,
          offset: 0,
          limit: 120,
          hasMore: false,
        });
      }),
    );
    const { queryRecipeDatasetResources } = await import("./browser-loader");
    const result = await queryRecipeDatasetResources("/manifest.json", version, {
      query: "𬭳",
      offset: 0,
      limit: 120,
    });
    await queryRecipeDatasetResources("/manifest.json", version, {
      query: "Iron Plate",
      offset: 0,
      limit: 120,
    });
    expect(new URL(requested[0]).pathname).toBe("/api/i18n/fixture/resources");
    expect(new URL(requested[1]).pathname).toBe("/api/datasets/fixture/resources");
    expect(new URL(requested[0]).searchParams.get("datasetHash")).toBe(hash);
    expect(result.resources[0].displayName).toBe("Iron Plate");
  });
  it("turns a confirmed Chinese recipe filter into the canonical English query", async () => {
    const requested: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        requested.push(url);
        if (url.endsWith("manifest.json"))
          return json({
            schemaVersion: 1,
            datasets: { fixture: { datasetHash: hash, messages: "/i18n/gtnh/fixture/zh-CN.json" } },
          });
        if (url.endsWith("zh-CN.json"))
          return json({
            schemaVersion: 1,
            datasetVersionId: "fixture",
            datasetHash: hash,
            names: { "Iron Ingot": "铁锭" },
            aliases: { 铁锭: "Iron Ingot" },
            resources: {},
          });
        return json({
          recipes: [],
          total: 0,
          offset: 0,
          limit: 120,
          hasMore: false,
          recipeMaps: [],
        });
      }),
    );
    const { queryRecipeDatasetRecipes } = await import("./browser-loader");
    await queryRecipeDatasetRecipes("/manifest.json", version, {
      query: "铁锭",
      mode: "recipes",
      maxTier: "all",
      offset: 0,
      limit: 120,
    });
    const request = new URL(requested.at(-1)!);
    expect(request.pathname).toBe("/api/datasets/fixture/recipes");
    expect(request.searchParams.get("query")).toBe("Iron Ingot");
  });
});
