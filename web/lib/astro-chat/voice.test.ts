import { describe, expect, it } from "vitest";
import { chunks, toSpeech } from "./voice";

describe("the assistant's voice", () => {
  it("reads an answer without its markup, bullets as pauses, signs as words", () => {
    const said = toSpeech("**Yang terlihat:** BTC naik 5%.\n\n• Support 0,00125\n• Target → 0,00145\nRentang ±2%");
    expect(said).not.toMatch(/\*|•|→|±/);
    expect(said).toContain("5 persen");
    expect(said).toContain("ke 0,00145");
    expect(said).toContain("kurang lebih 2 persen");
    // Each bullet ends as a sentence, so the voice pauses between them.
    expect(said).toContain("Support 0,00125.");
    // Icons go; a slash between words reads as a list.
    expect(toSpeech("✦ Claude: harga emas/BTC/DXY 👁")).toBe("Claude: harga emas, BTC, DXY");
  });

  it("speaks a long answer in pieces a voice reads through", () => {
    const text = Array.from({ length: 12 }, (_, i) => `Kalimat nomor ${i + 1} tentang pasar hari ini.`).join(" ");
    const parts = chunks(text, 120);
    expect(parts.length).toBeGreaterThan(3);
    expect(parts.every((p) => p.length <= 120)).toBe(true);
    expect(parts.join(" ")).toBe(text);
    // A sentence longer than a piece goes by its commas.
    const long = `${"satu, dua, tiga, empat, lima, ".repeat(10)}selesai.`;
    expect(chunks(long, 60).every((p) => p.length <= 60)).toBe(true);
  });
});
