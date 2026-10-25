import { describe, expect, it } from "vitest";
import { isEcho } from "./voice";

const reading = "Tarik napas dulu ya, ngerti kok, rugi dua puluh persen itu bikin kepikiran. Yang pertama, jangan ambil keputusan apa pun dalam keadaan panik.";

describe("the assistant's own voice heard back", () => {
  it("is told apart from the user talking over it", () => {
    // The microphone hearing the speakers: most words are the answer's.
    expect(isEcho("rugi dua puluh persen itu bikin kepikiran", reading)).toBe(true);
    expect(isEcho("jangan ambil keputusan", reading)).toBe(true);
    // The user cutting in, even about the same thing.
    expect(isEcho("tunggu sebentar, aku mau tanya soal emas", reading)).toBe(false);
    expect(isEcho("stop", reading)).toBe(false);
    expect(isEcho("terus kalau rugi lebih besar gimana", reading)).toBe(false);
  });

  it("is never assumed when nothing is being read", () => {
    expect(isEcho("rugi dua puluh persen", "")).toBe(false);
    expect(isEcho("", reading)).toBe(false);
  });
});
