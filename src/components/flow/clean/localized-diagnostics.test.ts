import { describe, expect, it } from "vitest";
import { translate } from "@/lib/i18n";
import { mockUnneeded } from "@/lib/solver/plan/__fixtures__/mock-extras";
import { buildNotices } from "./rail/notices";
import { buildFootView } from "./clean-model";
import { loopSentence } from "./loops";
import type { MessageTranslator } from "@/lib/i18n/message";
const names: Record<string, string> = { "Steel Plate": "钢板", "Iron Ingot": "铁锭" };
const chinese: MessageTranslator = (key, values) =>
  translate(
    "zh-CN",
    key,
    values &&
      Object.fromEntries(
        Object.entries(values).map(([name, value]) => [
          name,
          typeof value === "string" ? (names[value] ?? value) : value,
        ]),
      ),
  );
describe("localized solver explanations", () => {
  it("translates parameterized notices while preserving focus identities and the saved plan", () => {
    const before = JSON.stringify(mockUnneeded);
    const english = buildNotices(mockUnneeded.project, mockUnneeded.result);
    const localized = buildNotices(mockUnneeded.project, mockUnneeded.result, chinese);
    expect(localized[0].text).toMatch(/钢板.*10.*6/);
    expect(localized[0].text).not.toContain("can only");
    expect(localized.map(({ id, focus, severity }) => ({ id, focus, severity }))).toEqual(
      english.map(({ id, focus, severity }) => ({ id, focus, severity })),
    );
    expect(JSON.stringify(mockUnneeded)).toBe(before);
  });
  it("changes a bottleneck's words without changing its rate, bar or facts", () => {
    const count = { rule: "upTo" as const, set: 5 },
      reason = { capacity: 5, reached: 5, reason: "BOTTLENECK" as const, wants: 8 },
      ports = { inputs: [], outputs: [] };
    const english = buildFootView(count, reason, ports)!;
    const localized = buildFootView(count, reason, ports, undefined, undefined, chinese)!;
    expect(localized.say).toContain("需要");
    expect([localized.fill, localized.ghost, localized.frac, localized.facts]).toEqual([
      english.fill,
      english.ghost,
      english.frac,
      english.facts,
    ]);
    expect(loopSentence({ kind: "DEAD_LOOP" }, 2, chinese)).toMatch(/循环缺料/);
  });
});
