import { describe, expect, it } from "vitest";
import { searchLocalizedResources, type LocalizedSearchResource } from "./localized-resources";
const resources: LocalizedSearchResource[] = [
  {
    kind: "item",
    id: "gregtech:plate",
    displayName: "Iron Plate",
    zh: "铁板",
    recipeCount: 12,
    made: 3,
    uses: 9,
    sources: [],
  },
  {
    kind: "item",
    id: "other:dense",
    displayName: "Dense Iron Plate",
    zh: "致密铁板",
    recipeCount: 6,
    made: 4,
    uses: 2,
    sources: ["plants"],
  },
  {
    kind: "fluid",
    id: "iron",
    displayName: "Molten Iron",
    zh: "熔融铁",
    recipeCount: 20,
    made: 15,
    uses: 5,
    sources: [],
  },
];
const query = (text: string, extra = {}) =>
  searchLocalizedResources(resources, { query: text, offset: 0, limit: 120, ...extra });
describe("bilingual resource search", () => {
  it("finds Chinese, English and mixed text while returning unchanged canonical resources", () => {
    expect(query("铁板").resources.map((r) => r.id)).toEqual(["gregtech:plate", "other:dense"]);
    expect(query("铁 plate").total).toBe(2);
    expect(query("Iron Plate").resources[0]).toEqual({
      kind: "item",
      id: "gregtech:plate",
      displayName: "Iron Plate",
      recipeCount: 12,
    });
    expect(query("gregtech:plate").total).toBe(1);
    expect(resources[0].zh).toBe("铁板");
  });
  it("preserves kind, mod, source, count sorting and pagination", () => {
    expect(query("铁", { kind: "fluid" }).resources[0].id).toBe("iron");
    expect(query("铁", { mod: "fluids" }).resources[0].id).toBe("iron");
    expect(query("铁", { mod: "other" }).resources[0].id).toBe("other:dense");
    expect(query("铁", { source: "plants" }).total).toBe(1);
    expect(query("铁板", { sort: "made" }).resources[0].id).toBe("other:dense");
    expect(query("铁板", { offset: 1, limit: 1 })).toMatchObject({
      total: 2,
      offset: 1,
      limit: 1,
      hasMore: false,
    });
  });
});
