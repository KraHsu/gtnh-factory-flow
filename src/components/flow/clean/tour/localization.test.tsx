// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale, translate } from "@/lib/i18n";
import catalog from "@/lib/i18n/zh-CN.json";
import { CONTROLS } from "@/components/chrome/ControlsList";
import { Callout } from "./Callout";
import { parseLines } from "./markup";
import { STEPS } from "./script";
import { matches, named, textOf } from "./targets";
import {
  addRecipe,
  itemsSearch,
  menuRow,
  overlayKey,
  recipeOverlay,
  settingsSheet,
  topKey,
} from "./script-targets";

beforeEach(() => {
  setLocale("zh-CN");
  vi.stubGlobal("requestAnimationFrame", () => 1);
  vi.stubGlobal("cancelAnimationFrame", () => undefined);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    width: 100,
    height: 40,
    right: 100,
    bottom: 40,
    toJSON: () => ({}),
  });
});
afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  setLocale("en");
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function copyFrom(file: string, properties: Set<string>): string[] {
  const source = ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const result: string[] = [];
  function visit(node: ts.Node) {
    if (ts.isPropertyAssignment(node) && properties.has(node.name.getText(source))) {
      function literals(value: ts.Node) {
        if (ts.isStringLiteral(value)) result.push(value.text);
        else ts.forEachChild(value, literals);
      }
      literals(node.initializer);
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return result;
}

const plain = (text: string) =>
  parseLines(text)
    .flatMap((line) => line.spans.map((span) => span.text))
    .join("");

describe("localized guidance", () => {
  it("covers every tour note, including conditional live/public notes, without losing markup", () => {
    const notes = copyFrom(path.join(__dirname, "script.ts"), new Set(["text"]));
    expect(notes.length).toBeGreaterThanOrEqual(41);
    for (const source of notes) {
      expect(Object.hasOwn(catalog, source), source).toBe(true);
      const translated = translate("zh-CN", source);
      expect(translated, source).toMatch(/[\u3400-\u9fff]/);
      const markup = (text: string) =>
        parseLines(text).map((line) => ({
          glyph: line.glyph,
          emphasis: line.spans.filter((span) => span.ink !== "plain").map((span) => span.ink),
        }));
      expect(markup(translated), source).toEqual(markup(source));
    }
  });

  it("renders every active note in Chinese and repaints the mounted note on a language change", () => {
    const props = {
      last: false,
      done: true,
      canBack: true,
      onNext: vi.fn(),
      onBack: vi.fn(),
      onLeave: vi.fn(),
    };
    const view = render(<Callout {...props} note={{ text: STEPS[0].note.text, nothing: true }} />);
    for (const step of STEPS) {
      view.rerender(<Callout {...props} note={{ text: step.note.text, nothing: true }} />);
      expect(document.querySelector(".tour-note-body")?.textContent).toBe(
        plain(translate("zh-CN", step.note.text)),
      );
      expect(screen.getByRole("button", { name: "退出导览" })).toBeTruthy();
    }
    act(() => setLocale("en"));
    expect(document.querySelector(".tour-note-body")?.textContent).toBe(
      plain(STEPS.at(-1)!.note.text),
    );
    expect(screen.getByRole("button", { name: "Leave the tour" })).toBeTruthy();
  });

  it("covers the controls list and every help-card heading and explanation", () => {
    for (const row of CONTROLS)
      for (const text of row) expect(Object.hasOwn(catalog, text), text).toBe(true);
    const help = copyFrom(path.join(__dirname, "../../BoardHelp.tsx"), new Set(["title", "text"]));
    for (const text of help) expect(Object.hasOwn(catalog, text), text).toBe(true);
  });

  it("finds translated controls and menus without depending on their display language", () => {
    document.body.innerHTML = `
      <input aria-label="搜索物品和流体" />
      <button aria-label="自动布局" data-tour-label="Arrange"></button>
      <button data-tour-label="Combine 2" id="combine">合并 2 到一台机器</button>
      <div class="fixed" id="recipes"><button aria-label="关闭配方搜索"></button>
        <div data-recipe-tab-title>Bending Machine</div>
        <input aria-label="按名称筛选配方" id="recipe-filter" />
        <button aria-label="下一组机器" id="next-machines"></button>
        <div data-recipe-page><article data-recipe><div data-glyph="plus" aria-label="添加配方节点" id="add"></div></article></div>
      </div>
      <div data-cc-sheet id="settings"></div>
      <div class="rail-sec" data-tour-label="INPUTS">输入2/s</div>
      <div role="menu"><div role="menuitem" data-tour-label="Clone" id="clone">复制</div></div>`;
    expect(itemsSearch()).toBeTruthy();
    expect(recipeOverlay()?.id).toBe("recipes");
    expect(named("input", "Filter recipes by name", recipeOverlay)()?.id).toBe("recipe-filter");
    expect(overlayKey("Next machines")()?.id).toBe("next-machines");
    expect(addRecipe(/Bending Machine/)()?.id).toBe("add");
    expect(topKey(/^Arrange/)()).toBeTruthy();
    expect(textOf("button", /^Combine\s*2/i)()?.id).toBe("combine");
    expect(menuRow(/^Clone$/)()?.id).toBe("clone");
    expect(settingsSheet()?.id).toBe("settings");
    expect(matches(document.querySelector(".rail-sec")!, /^INPUTS$/)).toBe(true);
    act(() => setLocale("en"));
    document.querySelector("input")!.setAttribute("aria-label", "Search items and fluids");
    expect(named("input", "Search items and fluids")()).toBeTruthy();
  });

  it("omits the unavailable Community shelf and explains local saving in the public tool", async () => {
    vi.stubEnv("NEXT_PUBLIC_PUBLIC_TOOL", "1");
    vi.resetModules();
    const { STEPS: publicSteps } = await import("./script");
    expect(publicSteps.some((step) => step.id === "library")).toBe(false);
    expect(publicSteps.find((step) => step.id === "plans")?.note.text).toContain("this browser");
    expect(publicSteps.at(-1)?.note.text).toContain("GitHub");
  });
});
