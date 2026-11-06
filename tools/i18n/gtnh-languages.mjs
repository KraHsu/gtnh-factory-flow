import fs from "node:fs";
import path from "node:path";

export const stripFormatting = (text) => text.replace(/§[0-9a-fk-or]/gi, "").trim();
export function parseLanguage(source) {
  const values = new Map();
  const lines = source.replace(/\\\r?\n\s*/g, "").split(/\r?\n/);
  for (let line of lines) {
    line = line.trim();
    if (!line || /^[#!]/.test(line)) continue;
    const split = line.search(/(?<!\\)=/);
    if (split < 0) continue;
    const decode = (value) =>
      value
        .replace(/\\u([a-f0-9]{4})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
        .replace(/\\([nrt=\\])/g, (_, char) => ({ n: "\n", r: "\r", t: "\t" })[char] ?? char);
    const key = decode(
      line
        .slice(0, split)
        .trim()
        .replace(/^S:/, "")
        .replace(/^"(.*)"$/, "$1"),
    );
    values.set(key, stripFormatting(decode(line.slice(split + 1))));
  }
  return values;
}
export function filesIn(directory) {
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) =>
      entry.isDirectory()
        ? filesIn(path.join(directory, entry.name))
        : [path.join(directory, entry.name)],
    );
}
export function languagePairs(root) {
  const pairs = [];
  const read = (english, chinese, domain, source) => {
    if (!fs.existsSync(chinese)) return;
    const en = parseLanguage(fs.readFileSync(english, "utf8"));
    const zh = parseLanguage(fs.readFileSync(chinese, "utf8"));
    for (const [key, text] of en) {
      const translated = zh.get(key);
      if (translated && translated !== text && /\p{Script=Han}/u.test(translated))
        pairs.push({ key, en: text, zh: translated, domain, source });
    }
  };
  const directory = path.join(root, "daily-history/resources");
  for (const file of filesIn(directory).filter((file) => file.endsWith("/en_US.lang"))) {
    const relative = path.relative(directory, file);
    const domain =
      relative
        .split(path.sep)[0]
        .match(/\[([^\]]+)\]$/)?.[1]
        ?.toLowerCase() ?? "";
    read(
      file,
      path.join(root, "zh_CN/config/txloader/load", relative.replace("en_US.lang", "zh_CN.lang")),
      domain,
      "daily-history/resources/" + relative,
    );
  }
  read(
    path.join(root, "daily-history/GregTech.lang"),
    path.join(root, "zh_CN/GregTech_zh_CN.lang"),
    "gregtech",
    "daily-history/GregTech.lang",
  );
  for (const mode of ["load", "forceload"]) {
    const directory = path.join(root, "daily-history/config/txloader", mode);
    if (!fs.existsSync(directory)) continue;
    for (const file of filesIn(directory).filter(
      (file) => file.endsWith("/en_US.lang") && !file.includes("/betterquesting/"),
    )) {
      const relative = path.relative(directory, file);
      read(
        file,
        path.join(
          root,
          "zh_CN/config/txloader",
          mode,
          relative.replace("en_US.lang", "zh_CN.lang"),
        ),
        "",
        "daily-history/config/txloader/" + mode + "/" + relative,
      );
    }
  }
  return pairs;
}

/** Resource-folder names are labels in GTNH's repository; brackets hold the actual mod domain. */
export function chineseOverrides(root) {
  const overlays = new Map();
  const merge = (domain, source) => {
    let values = overlays.get(domain);
    if (!values) overlays.set(domain, (values = new Map()));
    for (const [key, value] of parseLanguage(source)) values.set(key, value);
  };
  for (const mode of ["load", "forceload"]) {
    const directory = path.join(root, "zh_CN/config/txloader", mode);
    if (!fs.existsSync(directory)) continue;
    for (const file of filesIn(directory)
      .sort()
      .filter((file) => /\/lang\/zh_CN\.lang$/.test(file))) {
      const folder = path.relative(directory, file).split(path.sep)[0];
      const domain = folder.match(/\[([^\]]+)\]$/)?.[1]?.toLowerCase() ?? folder.toLowerCase();
      merge(folder.startsWith("____") ? "*" : domain, fs.readFileSync(file, "utf8"));
    }
  }
  merge("gregtech", fs.readFileSync(path.join(root, "zh_CN/GregTech_zh_CN.lang"), "utf8"));
  return overlays;
}

/** Built-in translations are overlaid by the same GTNH keys, rather than treated as competing guesses. */
export function assetLanguagePairs(bundle, overrides = new Map()) {
  const pairs = [];
  const parse = (language) => (source) =>
    language.format === "json"
      ? new Map(Object.entries(JSON.parse(source || "{}")))
      : parseLanguage(source);
  const domains = new Map();
  for (const language of bundle.languages) {
    let zh = domains.get(language.domain);
    if (!zh) domains.set(language.domain, (zh = new Map()));
    for (const [key, value] of parse(language)(language.zh)) zh.set(key, value);
  }
  for (const [domain, values] of domains)
    for (const overlay of [domain, "*"])
      for (const [key, value] of overrides.get(overlay) ?? []) values.set(key, value);
  const global = new Map();
  for (const values of domains.values())
    for (const [key, value] of values) {
      if (!global.has(key)) global.set(key, new Set());
      global.get(key).add(value);
    }
  for (const language of bundle.languages) {
    const en = parse(language)(language.en);
    const zh = domains.get(language.domain);
    for (const [key, text] of en) {
      const fallback = global.get(key);
      const translated = zh.get(key) ?? (fallback?.size === 1 ? [...fallback][0] : undefined);
      if (
        typeof text === "string" &&
        typeof translated === "string" &&
        translated !== text &&
        /\p{Script=Han}/u.test(translated)
      )
        pairs.push({
          key,
          en: stripFormatting(text),
          zh: stripFormatting(translated),
          domain: language.domain,
          source: `${language.source}/${language.englishFile}`,
        });
    }
  }
  return pairs;
}

export function translationIndex(pairs, { orePrefixes = [] } = {}) {
  const global = new Map(),
    scoped = new Map(),
    keys = new Map(),
    keyNames = new Map();
  const add = (map, key, value) => {
    if (!map.has(key)) map.set(key, new Set());
    map.get(key).add(value);
  };
  for (const pair of pairs) {
    add(keys, pair.key.toLowerCase(), pair.zh);
    add(keyNames, pair.key.toLowerCase() + "|" + pair.en, pair.zh);
    if (!/%(?:\d+\$)?[sdf]|%%material/.test(pair.en)) {
      add(global, pair.en, pair.zh);
      add(scoped, pair.domain + "|" + pair.en, pair.zh);
    }
  }
  const allMaterials = pairs.filter((pair) =>
    /^(Material|gtpp\.material)\.[^.]+(?:\.(?:fluidpipe|itempipe)\.newname)?$/.test(pair.key),
  );
  const coreNames = new Set(
    allMaterials.filter((pair) => pair.key.startsWith("Material.")).map((pair) => pair.en),
  );
  const materials = allMaterials.filter(
    (pair) => pair.key.startsWith("Material.") || !coreNames.has(pair.en),
  );
  const materialNames = new Map();
  for (const material of materials) {
    if (/\.(?:fluidpipe|itempipe)\.newname$/.test(material.key)) continue;
    const key = material.key
      .replace(/^(?:Material|gtpp\.material)\./, "")
      .split(".")[0]
      .toLowerCase();
    if (!materialNames.has(key)) materialNames.set(key, new Map());
    materialNames.get(key).set(material.zh, material);
  }
  const sortedPrefixes = [...orePrefixes].sort((a, b) => b.key.length - a.key.length);
  for (const prefix of pairs.filter(
    (pair) =>
      pair.key.startsWith("gt.oreprefix.") &&
      (pair.en.match(/%s/g) || []).length === 1 &&
      (pair.zh.match(/%s/g) || []).length === 1,
  )) {
    for (const material of materials) {
      const en = prefix.en.replace("%s", () => material.en),
        // The pinned game has no Chinese inflection rule for remove_crystal;
        // GTInflectionManager consumes that marker and leaves the material unchanged.
        zh = prefix.zh.replace(/%s(?:\{remove_crystal\})?/, () => material.zh);
      if (/\{[^}]+\}/.test(zh)) continue;
      add(global, en, zh);
      add(scoped, "gregtech|" + en, zh);
    }
  }
  for (const template of pairs.filter(
    (pair) =>
      pair.key.startsWith("tgregworks.toolpart.") &&
      (pair.en.match(/%%material/g) ?? []).length === 1 &&
      (pair.zh.match(/%%material/g) ?? []).length === 1,
  )) {
    for (const material of materials) {
      const en = template.en.replace("%%material", () => material.en);
      const zh = template.zh.replace("%%material", () => material.zh);
      add(scoped, "tgregworks|" + en, zh);
      add(global, en, zh);
    }
  }
  const splash = pairs.find(
    (pair) => pair.domain === "minecraft" && pair.key === "potion.prefix.grenade",
  );
  if (splash)
    for (const potion of pairs.filter(
      (pair) => pair.domain === "minecraft" && /^potion\..+\.postfix$/.test(pair.key),
    )) {
      const en = splash.en + " " + potion.en,
        zh = splash.zh + potion.zh;
      add(scoped, "minecraft|" + en, zh);
      add(global, en, zh);
    }
  const bottle = pairs.find(
    (pair) => pair.domain === "minecraft" && pair.key === "item.potion.name",
  );
  if (bottle)
    for (const prefix of pairs.filter(
      (pair) =>
        pair.domain === "minecraft" &&
        pair.key.startsWith("potion.prefix.") &&
        pair.key !== "potion.prefix.grenade",
    )) {
      const en = prefix.en + " " + bottle.en,
        zh = prefix.zh + bottle.zh;
      add(scoped, "minecraft|" + en, zh);
      add(global, en, zh);
    }
  const egg = pairs.find(
    (pair) => pair.domain === "minecraft" && pair.key === "item.monsterPlacer.name",
  );
  if (egg)
    for (const entity of pairs.filter((pair) => /^entity\..+\.name$/.test(pair.key))) {
      const en = egg.en + " " + entity.en,
        zh = egg.zh + entity.zh;
      add(scoped, "minecraft|" + en, zh);
      add(global, en, zh);
    }
  for (const species of pairs.filter((pair) => pair.key.startsWith("for.bees.species.")))
    add(
      scoped,
      "factoryflow|" + species.en + " Bee",
      species.zh.endsWith("蜂") ? species.zh : species.zh + "蜜蜂",
    );
  const unique = (values) => (values?.size === 1 ? [...values][0] : undefined);
  const exact = (text, domain) =>
    unique(scoped.get(domain + "|" + text)) ?? unique(global.get(text));
  function concreteName(resource) {
    if (resource.kind === "fluid") {
      for (const key of [
        "fluid." + resource.id,
        "fluid." + resource.id + ".name",
        "fluid.tile." + resource.id,
      ]) {
        const value = unique(keyNames.get(key.toLowerCase() + "|" + resource.displayName));
        if (value) return value;
      }
    }
    if (resource.kind === "aspect") {
      const value = unique(keys.get("tc.aspect." + resource.id.split(":").at(-1)));
      if (value) return value;
    }
    const direct = exact(
      resource.displayName ?? "",
      resource.modId?.toLowerCase() ?? resource.id.split(":")[0].toLowerCase(),
    );
    if (direct) return direct;
    const tier = resource.displayName?.match(
      /^(.*) (\((?:ULV|LV|MV|HV|EV|IV|LuV|ZPM|UV|UHV|UEV|UIV|UXV|OpV|MAX)\))$/,
    );
    if (tier && resource.id.startsWith("gregtech:")) {
      const name = exact(tier[1], "gregtech");
      if (name) return name + " " + tier[2];
    }
  }
  function resourceName(resource) {
    const name = concreteName(resource);
    if (name) return name;
    const ores = resource.oreDictionary;
    if (
      resource.id.startsWith("oredict:") &&
      ores?.length &&
      resource.id === "oredict:" + ores[0] &&
      resource.displayName === "Ore Dictionary: " + ores.join(", ") &&
      resource.alternatives?.length
    ) {
      const alternatives = resource.alternatives.map(concreteName);
      const labels = ores.map((ore) => {
        for (const prefix of sortedPrefixes) {
          if (!ore.startsWith(prefix.key)) continue;
          const values = materialNames.get(ore.slice(prefix.key.length).toLowerCase());
          if (values?.size !== 1) continue;
          const material = [...values.values()][0];
          const name = exact(prefix.prefix + material.en + prefix.suffix, "gregtech");
          if (name && alternatives.includes(name)) return name;
        }
      });
      if (labels.every(Boolean) && new Set(labels).size === 1) return "任意" + labels[0];
      if (alternatives.every(Boolean) && new Set(alternatives).size === 1)
        return "任意" + alternatives[0];
      const toolNames = {
        craftingToolScrewdriver: "Screwdriver",
        craftingToolHardHammer: "Hammer",
        craftingToolFile: "File",
        craftingToolSaw: "Saw",
        craftingToolWireCutter: "Wire Cutter",
        craftingToolWrench: "Wrench",
        craftingToolSoftHammer: "Soft Mallet",
        craftingToolMortar: "Mortar",
        craftingToolKnife: "Knife",
        craftingToolCrowbar: "Crowbar",
      };
      const tool = ores.length === 1 && Object.hasOwn(toolNames, ores[0]) && toolNames[ores[0]];
      if (tool && resource.alternatives.some((alternative) => alternative.displayName === tool)) {
        const label = exact(tool, "gregtech");
        if (label) return "任意" + label;
      }
    }
  }
  return { exact, resourceName };
}

/** Only the planner's own ore-tooltip format is rewritten; source item identities stay intact. */
export function oreTooltip(resource, line, index) {
  if (
    !resource.id.startsWith("oredict:") ||
    !resource.oreDictionary?.length ||
    !resource.alternatives?.length
  )
    return undefined;
  if (line === "Ore dictionary: " + resource.oreDictionary.join(", "))
    return "矿物词典词条：" + resource.oreDictionary.join("、");
  const shown = resource.alternatives.slice(0, 12);
  const remaining = resource.alternatives.length - shown.length;
  const english =
    "Accepts: " +
    shown.map((alternative) => alternative.displayName ?? alternative.id).join(", ") +
    (remaining ? `, +${remaining} more` : "");
  if (line !== english) return undefined;
  return (
    "接受：" +
    shown
      .map(
        (alternative) =>
          index.resourceName(alternative) ?? alternative.displayName ?? alternative.id,
      )
      .join("、") +
    (remaining ? `，另有 ${remaining} 种` : "")
  );
}

/** Java printf placeholders are captured in English order and replayed in Chinese order. */
export function tooltipTemplates(pairs) {
  const out = [],
    seen = new Set();
  for (const pair of pairs) {
    const tokens = [...pair.en.matchAll(/%(?:(\d+)\$)?[-+0 #,]*(?:\d+)?(?:\.\d+)?([sdf])/g)];
    if (!tokens.length || tokens.length > 8 || pair.en.length > 1500 || pair.en.includes("\n"))
      continue;
    let position = 0,
      pattern = "^",
      implicit = 0;
    const captures = [];
    const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    for (const token of tokens) {
      pattern += escape(pair.en.slice(position, token.index)) + "(.+?)";
      position = token.index + token[0].length;
      captures.push(token[1] ? Number(token[1]) - 1 : implicit++);
    }
    pattern += escape(pair.en.slice(position)) + "$";
    if (pattern === "^(.+?)$") continue;
    const arity = Math.max(...captures) + 1;
    const zhTokens = [...pair.zh.matchAll(/%(?:(\d+)\$)?[-+0 #,]*(?:\d+)?(?:\.\d+)?([sdf])/g)];
    if (!zhTokens.length || zhTokens.some((m, i) => (m[1] ? Number(m[1]) - 1 : i) >= arity))
      continue;
    const identity = pair.en + "\0" + pair.zh;
    if (seen.has(identity)) continue;
    seen.add(identity);
    const anchor =
      pair.en
        .split(/%(?:(\d+)\$)?[-+0 #,]*(?:\d+)?(?:\.\d+)?[sdf]/)
        .filter(Boolean)
        .sort((a, b) => b.length - a.length)[0] ?? "";
    if (anchor.trim().length < 3) continue;
    out.push({ ...pair, regex: new RegExp(pattern, "u"), captures, anchor });
  }
  return out;
}
export function translateTooltip(line, domain, index, templates) {
  const direct = index.exact(line, domain);
  if (direct) return direct;
  const candidates = new Set();
  for (const template of templates) {
    if (
      (template.domain && domain && template.domain !== domain) ||
      !line.includes(template.anchor)
    )
      continue;
    const match = template.regex.exec(line);
    if (!match) continue;
    const args = [];
    template.captures.forEach(
      (at, i) => (args[at] = index.exact(match[i + 1], domain) ?? match[i + 1]),
    );
    let implicit = 0;
    const result = template.zh.replace(
      /%(?:(\d+)\$)?[-+0 #,]*(?:\d+)?(?:\.\d+)?[sdf]/g,
      (_, at) => args[at ? Number(at) - 1 : implicit++] ?? "",
    );
    candidates.add(result);
  }
  return candidates.size === 1 ? [...candidates][0] : line;
}
