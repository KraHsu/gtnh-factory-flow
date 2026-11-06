import { describe, it, expect } from "vitest";
import {
  parseLanguage,
  translationIndex,
  tooltipTemplates,
  translateTooltip,
} from "./gtnh-languages.mjs";

describe("game language reuse", () => {
  it("reads Forge properties, escaped text and Minecraft formatting without executing content", () => {
    const values = parseLanguage(
      '# ignored\nlanguagefile {\nS:"Material.iron"=§7铁\nitem.test.name=测试\\u7269\\n品\nother=a\\=b\n}',
    );
    expect(values.get("Material.iron")).toBe("铁");
    expect(values.get("item.test.name")).toBe("测试物\n品");
    expect(values.get("other")).toBe("a=b");
  });
  it("uses official ore-prefix templates and leaves ambiguous names in English", () => {
    const pair = (key, en, zh, domain = "gregtech") => ({ key, en, zh, domain, source: "fixture" });
    const index = translationIndex([
      pair("Material.iron", "Iron", "铁"),
      pair("gt.oreprefix.material_plate", "%s Plate", "%s板"),
      pair("a.name", "Shared", "甲", "a"),
      pair("b.name", "Shared", "乙", "b"),
      pair("fluid.oxygen", "Oxygen", "氧气"),
      pair("Material.oxygen", "Oxygen", "氧"),
    ]);
    expect(
      index.resourceName({ id: "gregtech:plate", kind: "item", displayName: "Iron Plate" }),
    ).toBe("铁板");
    expect(index.resourceName({ id: "a:test", kind: "item", displayName: "Shared" })).toBe("甲");
    expect(
      index.resourceName({ id: "unknown:test", kind: "item", displayName: "Shared" }),
    ).toBeUndefined();
    expect(index.resourceName({ id: "oxygen", kind: "fluid", displayName: "Oxygen" })).toBe("氧气");
    expect(
      index.resourceName({ id: "oxygen", kind: "fluid", displayName: "A renamed fluid" }),
    ).toBeUndefined();
  });
  it("replays printf arguments in translated order and keeps uncertain tooltips unchanged", () => {
    const pairs = [
      {
        key: "tooltip",
        en: "Needs %s at %s EU/t",
        zh: "以 %2$s EU/t 运行，需要 %1$s",
        domain: "gregtech",
        source: "fixture",
      },
      { key: "item", en: "Iron", zh: "铁", domain: "gregtech", source: "fixture" },
    ];
    const index = translationIndex(pairs),
      templates = tooltipTemplates(pairs);
    expect(translateTooltip("Needs Iron at 32 EU/t", "gregtech", index, templates)).toBe(
      "以 32 EU/t 运行，需要 铁",
    );
    expect(translateTooltip("Unrecognized 32 EU/t", "gregtech", index, templates)).toBe(
      "Unrecognized 32 EU/t",
    );
  });
});
