import { describe, expect, it } from "vitest";
import { elevenPieces } from "./voice";

describe("the ElevenLabs voice's pieces", () => {
  it("makes the first piece short, so it's heard sooner, and the rest up to a few sentences", () => {
    const text = Array.from({ length: 14 }, (_, i) => `Ini kalimat nomor ${i + 1} tentang pasar hari ini.`).join(" ");
    const parts = elevenPieces(text);
    expect(parts[0].length).toBeLessThanOrEqual(160);
    expect(parts.slice(1).every((p) => p.length <= 400)).toBe(true);
    expect(parts.join(" ")).toBe(text);
  });

  it("keeps a short answer in one piece", () => {
    expect(elevenPieces("Hai! Aku di sini.")).toEqual(["Hai! Aku di sini."]);
  });
});
