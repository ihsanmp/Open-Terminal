import { describe, expect, it } from "vitest";
import { MOODS, toneOf } from "./voice";

describe("the reader's moods", () => {
  it("matches an excited user and calms an anxious one", () => {
    const plain = "Harga emas turun empat persen minggu ini.";
    const excited = toneOf(plain, 0, "antusias");
    const calming = toneOf(plain, 0, "menenangkan");
    expect(excited.rate).toBeGreaterThan(calming.rate);
    expect(excited.pitch).toBeGreaterThan(calming.pitch);
    expect(calming.volume).toBeLessThan(excited.volume);
    expect(MOODS.menenangkan.pause).toBeGreaterThan(MOODS.antusias.pause);
  });

  it("keeps a firm answer's questions from rising, and lets a gentle one breathe longest", () => {
    const firm = toneOf("Kamu mau lanjut?", 0, "tegas");
    expect(firm.pitch).toBe(MOODS.tegas.pitch);
    expect(toneOf("Kamu mau lanjut?", 0, "santai").pitch).toBeGreaterThan(MOODS.santai.pitch);
    expect(Math.max(...Object.values(MOODS).map((m) => m.pause))).toBe(MOODS.lembut.pause);
  });

  it("reads an unknown mood as the everyday one", () => {
    expect(toneOf("Halo.", 0, "bingung" as never)).toEqual(toneOf("Halo.", 0, "santai"));
  });
});
