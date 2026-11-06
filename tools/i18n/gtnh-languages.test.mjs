import { describe, it, expect } from "vitest";
import {
  parseLanguage,
  translationIndex,
  tooltipTemplates,
  translateTooltip,
  assetLanguagePairs,
  oreTooltip,
} from "./gtnh-languages.mjs";

describe("game language reuse", () => {
  it("pairs built-in language keys, applies GTNH overrides and shares only unambiguous legacy keys", () => {
    const language = (domain, en, zh) => ({
      domain,
      en,
      zh,
      format: "lang",
      source: "fixture.jar",
      englishFile: "en_US.lang",
    });
    const bundle = {
      languages: [
        language(
          "minecraft",
          "item.bottle.name=Glass Bottle\nitem.shared=Shared",
          "item.bottle.name=玻璃瓶\nitem.shared=甲",
        ),
        language("example", "item.shared=Shared\nitem.bottle.name=New Bottle", "item.shared=乙"),
      ],
    };
    const pairs = assetLanguagePairs(
      bundle,
      new Map([["minecraft", new Map([["item.bottle.name", "瓶子"]])]]),
    );
    expect(
      pairs.find((pair) => pair.domain === "minecraft" && pair.key === "item.bottle.name").zh,
    ).toBe("瓶子");
    expect(pairs.find((pair) => pair.en === "New Bottle").zh).toBe("瓶子");
    expect(translationIndex(pairs).exact("Shared", "unknown")).toBeUndefined();
  });

  it("expands game material placeholders, potion and spawn-egg names without leaking runtime markers", () => {
    const pair = (key, en, zh, domain = "gregtech") => ({ key, en, zh, domain, source: "fixture" });
    const index = translationIndex([
      pair("Material.aluminium", "Aluminium", "铝"),
      pair("Material.air.flavorText", "An air joke", "空气玩笑"),
      pair("tgregworks.toolpart.tool_rod", "%%material Tool Rod", "%%material手柄", "tgregworks"),
      pair("gt.oreprefix.material_infused_stone", "%s Infused Stone", "%s{remove_crystal}蕴魔石"),
      pair("potion.prefix.grenade", "Splash", "喷溅型", "minecraft"),
      pair("potion.damageBoost.postfix", "Potion of Strength", "力量药水", "minecraft"),
      pair("item.monsterPlacer.name", "Spawn", "生成", "minecraft"),
      pair("entity.Silverfish.name", "Silverfish", "蠹虫", "minecraft"),
    ]);
    expect(
      index.resourceName({ kind: "item", id: "tgregworks:rod", displayName: "Aluminium Tool Rod" }),
    ).toBe("铝手柄");
    expect(index.exact("Aluminium Infused Stone", "gregtech")).toBe("铝蕴魔石");
    expect(index.exact("An air joke Infused Stone", "gregtech")).toBeUndefined();
    expect(index.exact("Splash Potion of Strength", "minecraft")).toBe("喷溅型力量药水");
    expect(index.exact("Spawn Silverfish", "minecraft")).toBe("生成蠹虫");
  });

  it("localizes ore categories from the pinned prefix registry or unanimous alternatives without changing identity", () => {
    const pair = (key, en, zh) => ({ key, en, zh, domain: "gregtech", source: "fixture" });
    const index = translationIndex(
      [
        pair("Material.steel", "Steel", "钢"),
        pair("gt.oreprefix.material_plate", "%s Plate", "%s板"),
        pair("Material.steel.fluidpipe.newname", "Steely", "钢制"),
      ],
      { orePrefixes: [{ key: "plate", prefix: "", suffix: " Plate" }] },
    );
    const resource = {
      kind: "item",
      id: "oredict:plateSteel",
      displayName: "Ore Dictionary: plateSteel",
      oreDictionary: ["plateSteel"],
      alternatives: [{ kind: "item", id: "gregtech:steel", displayName: "Steel Plate" }],
    };
    const before = structuredClone(resource);
    expect(index.resourceName(resource)).toBe("任意钢板");
    expect(oreTooltip(resource, "Ore dictionary: plateSteel", index)).toBe(
      "矿物词典词条：plateSteel",
    );
    expect(oreTooltip(resource, "Accepts: Steel Plate", index)).toBe("接受：钢板");
    expect(oreTooltip(resource, "Accepts: a different recipe", index)).toBeUndefined();
    expect(resource).toEqual(before);
    expect(index.resourceName({ ...resource, displayName: "A custom label" })).toBeUndefined();
    expect(
      index.resourceName({
        ...resource,
        id: "oredict:unknown",
        oreDictionary: ["unknown"],
        displayName: "Ore Dictionary: unknown",
        alternatives: [
          ...resource.alternatives,
          { kind: "item", id: "unknown:material", displayName: "Unknown" },
        ],
      }),
    ).toBeUndefined();
  });

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
