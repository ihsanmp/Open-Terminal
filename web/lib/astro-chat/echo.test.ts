import { describe, expect, it } from "vitest";
import { afterEcho, cutsIn, isEcho } from "./voice";

const reading = "Tarik napas dulu ya, ngerti kok, rugi dua puluh persen itu bikin kepikiran. Yang pertama, jangan ambil keputusan apa pun dalam keadaan panik.";
const market = "Wah, ada beberapa yang seru nih. Emas lagi jatuh lumayan dalam, sekitar 4.015, turun ~6% sebulan, kayaknya bukan dari dolar.";

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

  it("matches numbers and the recognizer's spellings", () => {
    // "4.015" heard as words, "~6%" as "enam persen", "kayaknya" as "kayanya".
    expect(isEcho("sekitar empat ribu lima belas turun enam persen sebulan", market)).toBe(true);
    expect(isEcho("kayanya bukan dari dolar", market)).toBe(true);
  });

  it("is never assumed when nothing is being read", () => {
    expect(isEcho("rugi dua puluh persen", "")).toBe(false);
    expect(isEcho("", reading)).toBe(false);
  });
});

describe("cutting in while an answer is read out", () => {
  it("isn't the answer's echo, with a word or two of it misheard", () => {
    expect(cutsIn("emas lagi jatuh", market)).toBe(false);
    expect(cutsIn("emas lagi jatuh lumayan dalem", market)).toBe(false);
    expect(cutsIn("ada beberapa yang seru nih emas lagi jatoh lumayan dalem sekitar", market)).toBe(false);
    // One word of the user's own isn't enough to tell yet.
    expect(cutsIn("aku", market)).toBe(false);
  });

  it("is the user's own words, even after the answer's echo in the same breath", () => {
    expect(cutsIn("tunggu", market)).toBe(true);
    expect(cutsIn("aku mau tanya soal bitcoin", market)).toBe(true);
    expect(cutsIn("turun sebulan kayaknya bukan aku mau tanya soal bitcoin", market)).toBe(true);
    expect(afterEcho("turun sebulan kayaknya bukan aku mau tanya soal bitcoin", market)).toBe("aku mau tanya soal bitcoin");
  });
});
