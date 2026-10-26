import { describe, expect, it } from "vitest";
import { afterEcho, afterStopWord, isEcho, stopWordAt } from "./voice";

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

describe("stopping the answer while it's read out", () => {
  it("takes only a word that means stop, never its garbled echo", () => {
    // From a real trace: "Dari layar kamu, memang kelihatan…" heard back.
    const reading = "Dari layar kamu, memang kelihatan jual agresifnya sedikit lebih banyak.";
    expect(stopWordAt("milenial lahir kamu memang kelihat", reading)).toBe(-1);
    expect(stopWordAt("aku mau tanya soal bitcoin", market)).toBe(-1);
    expect(stopWordAt("tunggu", market)).toBe(0);
    expect(stopWordAt("lumayan dalam Stop, aku mau tanya", market)).toBe(2);
  });

  it("not one the answer is saying itself", () => {
    expect(stopWordAt("tunggu dulu sampai tutup", "Mending tunggu dulu sampai candle harian tutup.")).toBe(-1);
  });

  it("keeps what the user says after it", () => {
    expect(afterStopWord("lumayan dalam stop aku mau tanya soal bitcoin", market)).toBe("aku mau tanya soal bitcoin");
    expect(afterStopWord("tunggu", market)).toBe("");
    expect(afterEcho("turun sebulan kayaknya bukan aku mau tanya", market)).toBe("aku mau tanya");
  });
});
