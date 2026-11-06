// @vitest-environment jsdom
import { act, cleanup, render, screen, fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useState } from "react";
import { setLocale } from ".";
import { loadGameLanguage } from "./game-catalog";
import { useDisplayT } from "./game";
beforeEach(() => setLocale("en"));
afterEach(() => {
  cleanup();
  setLocale("en");
  vi.unstubAllGlobals();
});
it("repaints late game names and translated sentence parameters without replacing an active edit", async () => {
  const hash = "c".repeat(64);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => ({
      ok: true,
      json: async () =>
        url.endsWith("manifest.json")
          ? {
              schemaVersion: 1,
              datasets: { ui: { datasetHash: hash, messages: "/i18n/gtnh/ui/messages.json" } },
            }
          : {
              schemaVersion: 1,
              datasetVersionId: "ui",
              datasetHash: hash,
              names: { "Iron Plate": "铁板" },
              resources: {},
            },
    })),
  );
  function Editor() {
    const t = useDisplayT(),
      [text, setText] = useState("");
    return (
      <>
        <p data-testid="name">{t("Iron Plate")}</p>
        <p data-testid="rule">
          {t("No target: the plan {p0} whatever it needs.", { p0: "draws from it" })}
        </p>
        <input aria-label="Draft" value={text} onChange={(e) => setText(e.target.value)} />
      </>
    );
  }
  render(<Editor />);
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "my factory" } });
  await act(async () => {
    setLocale("zh-CN");
    await loadGameLanguage({ id: "ui", checksumSha256: hash });
  });
  expect(screen.getByTestId("name").textContent).toBe("铁板");
  expect(screen.getByTestId("rule").textContent).toBe("未设目标：方案按需从中取用。");
  expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe("my factory");
  act(() => setLocale("en"));
  expect(screen.getByTestId("name").textContent).toBe("Iron Plate");
  expect(screen.getByTestId("rule").textContent).toBe(
    "No target: the plan draws from it whatever it needs.",
  );
});
