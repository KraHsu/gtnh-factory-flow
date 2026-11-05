// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import catalog from "./zh-CN.json";
import { getLocale, LOCALE_STORAGE_KEY, resolveLocale, setLocale, translate, useT } from ".";
import { SiteHeader } from "@/components/krahsu/SiteHeader";

beforeEach(() => {
  localStorage.clear();
  setLocale("en");
  document.documentElement.dataset.theme = "light";
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("interface language", () => {
  it("prefers a saved supported language and otherwise uses the browser language", () => {
    expect(resolveLocale("en", ["zh-TW"])).toBe("en");
    expect(resolveLocale("zh-CN", ["en-US"])).toBe("zh-CN");
    expect(resolveLocale("bad", ["zh-HK"])).toBe("zh-CN");
    expect(resolveLocale(null, ["en-GB"])).toBe("en");
    expect(resolveLocale(null, [])).toBe("en");
  });

  it("falls back to source text, interpolates named values and preserves missing values", () => {
    expect(translate("zh-CN", "New design")).toBe("新建方案");
    expect(translate("en", "New design")).toBe("New design");
    expect(translate("zh-CN", "Unknown {count}: {missing}", { count: 3 })).toBe(
      "Unknown 3: {missing}",
    );
    for (const [key, value] of Object.entries(catalog)) {
      const tokens = (text: string) => text.match(/\{\w+\}/g)?.sort() ?? [];
      expect(tokens(value), key).toEqual(tokens(key));
    }
  });

  it("repaints mounted UI without losing an in-progress edit, and remembers the choice", () => {
    function Editor() {
      const t = useT();
      const [text, setText] = useState("my factory");
      return (
        <>
          <p>{t("New design")}</p>
          <input
            aria-label="Draft"
            value={text}
            onChange={(event) => setText(event.target.value)}
          />
        </>
      );
    }
    render(
      <>
        <SiteHeader />
        <Editor />
      </>,
    );
    fireEvent.change(screen.getByLabelText("Draft"), { target: { value: "Copper line" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Language" }), {
      target: { value: "zh-CN" },
    });
    expect(screen.getByText("新建方案")).toBeTruthy();
    expect((screen.getByLabelText("Draft") as HTMLInputElement).value).toBe("Copper line");
    expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe("zh-CN");
    expect(document.documentElement.lang).toBe("zh-CN");
    fireEvent.click(screen.getByRole("button", { name: "切换深色主题" }));
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(localStorage.getItem("gtnh-theme.v1")).toBe("dark");
  });

  it("handles changes from other tabs and unavailable storage", () => {
    render(<SiteHeader />);
    localStorage.setItem(LOCALE_STORAGE_KEY, "zh-CN");
    act(() =>
      window.dispatchEvent(
        new StorageEvent("storage", { key: LOCALE_STORAGE_KEY, newValue: "zh-CN" }),
      ),
    );
    expect(screen.getByRole("combobox", { name: "语言" })).toBeTruthy();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    act(() => setLocale("en"));
    expect(getLocale()).toBe("en");
    expect(screen.getByRole("combobox", { name: "Language" })).toBeTruthy();
  });
});
