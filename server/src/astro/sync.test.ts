import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The server's copy of the astrology calendar's computation (for the quant forecaster's sky
// features) must stay the web's own: the same file but for the import paths.
const web = join(__dirname, "..", "..", "..", "web", "lib");
const server = __dirname;
const strip = (s: string) => s.replace(/^import .*$/gm, "").replace(/\r\n/g, "\n");

describe("the server's astronomy", () => {
  it.each([
    ["astro.ts", join(web, "ta", "astro.ts")],
    ["precise.ts", join(web, "astro-calendar", "precise.ts")],
    ["events.ts", join(web, "astro-calendar", "events.ts")],
  ])("is the web's %s", (name, original) => {
    expect(strip(readFileSync(join(server, name), "utf8"))).toBe(strip(readFileSync(original, "utf8")));
  });
});
