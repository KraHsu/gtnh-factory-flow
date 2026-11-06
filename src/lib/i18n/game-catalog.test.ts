import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
const hash = "a".repeat(64),
  otherHash = "b".repeat(64);
const pack = {
  schemaVersion: 1,
  datasetVersionId: "v1",
  datasetHash: hash,
  names: { "Iron Plate": "铁板" },
  aliases: { 铁板: "Iron Plate", 铁: "Iron" },
  resources: { "item:gregtech:plate": ["Iron Plate", "铁板", ["铁板", "厚度：1"]] },
};
beforeEach(() => vi.resetModules());
afterEach(() => vi.unstubAllGlobals());
function network(overrides: Record<string, unknown> = {}) {
  const manifest = {
    schemaVersion: 1,
    datasets: {
      v1: { datasetHash: hash, messages: "/i18n/gtnh/v1/messages.json" },
      v2: { datasetHash: otherHash, messages: "/i18n/gtnh/v2/messages.json" },
    },
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => ({
      ok: !url.includes("missing"),
      json: async () => overrides[url] ?? (url.endsWith("manifest.json") ? manifest : pack),
    })),
  );
}
describe("game display language", () => {
  it("localizes only matching identities, keeps English fallback and never mutates resources", async () => {
    network();
    const game = await import("./game-catalog");
    await game.loadGameLanguage({ id: "v1", checksumSha256: hash });
    const resource = {
      kind: "item",
      id: "gregtech:plate",
      displayName: "Iron Plate",
      tooltip: ["Iron Plate", "Thickness: 1"],
    };
    const before = JSON.stringify(resource);
    expect(game.gameResourceLabel("zh-CN", resource)).toBe("铁板");
    expect(game.gameResourceLabel("en", resource)).toBe("Iron Plate");
    expect(game.gameResourceLabel("zh-CN", { ...resource, displayName: "My plate" })).toBe(
      "My plate",
    );
    expect(game.gameResourceLabel("zh-CN", { ...resource, id: "custom:plate" })).toBe("Iron Plate");
    expect(game.gameResourceTooltip("zh-CN", resource)).toEqual(["铁板", "厚度：1"]);
    expect(game.localizedGameQuery("铁 plate", "v1", hash)).toBe("Iron plate");
    expect(game.localizedGameQuery("铁板", "v1", hash)).toBe("Iron Plate");
    expect(game.localizedGameQuery("铁板", "v2", hash)).toBe("铁板");
    expect(JSON.stringify(resource)).toBe(before);
  });
  it("rejects dataset mismatches and falls back cleanly when assets fail", async () => {
    network();
    const game = await import("./game-catalog");
    await game.loadGameLanguage({ id: "v1", checksumSha256: otherHash });
    expect(game.gameLanguageStatus()).toBe("unavailable");
    expect(game.gameText("zh-CN", "Iron Plate")).toBe("Iron Plate");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("offline");
      }),
    );
    await game.loadGameLanguage({ id: "v1", checksumSha256: hash });
    expect(game.gameLanguageStatus()).toBe("unavailable");
  });
  it("keeps the latest selected dataset when a previous language request finishes late", async () => {
    let started = false;
    let release: (value: unknown) => void = () => {};
    const manifest = {
      schemaVersion: 1,
      datasets: {
        v1: { datasetHash: hash, messages: "/i18n/gtnh/v1/messages.json" },
        v2: { datasetHash: otherHash, messages: "/i18n/gtnh/v2/messages.json" },
      },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => ({
        ok: true,
        json: async () =>
          url.endsWith("manifest.json")
            ? manifest
            : url.includes("/v1/")
              ? await new Promise((resolve) => {
                  started = true;
                  release = resolve;
                })
              : {
                  ...pack,
                  datasetVersionId: "v2",
                  datasetHash: otherHash,
                  names: { "Iron Plate": "第二版铁板" },
                },
      })),
    );
    const game = await import("./game-catalog");
    const first = game.loadGameLanguage({ id: "v1", checksumSha256: hash });
    await vi.waitFor(() => expect(started).toBe(true));
    await game.loadGameLanguage({ id: "v2", checksumSha256: otherHash });
    release(pack);
    await first;
    expect(game.gameText("zh-CN", "Iron Plate")).toBe("第二版铁板");
  });
});

it("coalesces concurrent requests for the same language pack", async () => {
  network();
  const game = await import("./game-catalog");
  await Promise.all([
    game.loadGameLanguage({ id: "v1", checksumSha256: hash }),
    game.loadGameLanguage({ id: "v1", checksumSha256: hash }),
  ]);
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(game.gameLanguageStatus()).toBe("ready");
});
