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
export function translationIndex(pairs) {
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
    if (!/%(?:\d+\$)?[sdf]/.test(pair.en)) {
      add(global, pair.en, pair.zh);
      add(scoped, pair.domain + "|" + pair.en, pair.zh);
    }
  }
  const materials = pairs.filter(
    (pair) =>
      /^(Material\.|gtpp\.material\.)/.test(pair.key) && !pair.key.endsWith("ChemicalFormula"),
  );
  for (const prefix of pairs.filter(
    (pair) =>
      pair.key.startsWith("gt.oreprefix.") &&
      (pair.en.match(/%s/g) || []).length === 1 &&
      (pair.zh.match(/%s/g) || []).length === 1,
  )) {
    for (const material of materials) {
      const en = prefix.en.replace("%s", () => material.en),
        zh = prefix.zh.replace("%s", () => material.zh);
      add(global, en, zh);
      add(scoped, "gregtech|" + en, zh);
    }
  }
  const unique = (values) => (values?.size === 1 ? [...values][0] : undefined);
  const exact = (text, domain) =>
    unique(scoped.get(domain + "|" + text)) ?? unique(global.get(text));
  function resourceName(resource) {
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
    return exact(
      resource.displayName ?? "",
      resource.modId?.toLowerCase() ?? resource.id.split(":")[0].toLowerCase(),
    );
  }
  return { exact, resourceName };
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
