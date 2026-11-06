import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

it("extracts only pinned language resources and rejects a changed game archive", () => {
  const file = fileURLToPath(new URL("./test_extract_game_languages.py", import.meta.url));
  expect(() => execFileSync("python3", ["-B", file], { stdio: "pipe" })).not.toThrow();
});
