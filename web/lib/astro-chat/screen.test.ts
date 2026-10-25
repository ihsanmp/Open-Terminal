import { describe, expect, it } from "vitest";
import { wantsScreen } from "./screen";

describe("asking about the screen", () => {
  it("knows a question about what's shown", () => {
    for (const q of [
      "lihat layar saya",
      "coba cek chart ini",
      "apa yang kamu lihat?",
      "bagaimana menurutmu chart yang saya buka",
      "analisa grafik ini dong",
      "jelaskan indikator ini",
      "yang ditampilkan sekarang bagus nggak?",
      "look at my screen",
    ])
      expect(wantsScreen(q), q).toBe(true);
  });

  it("leaves other questions alone", () => {
    for (const q of ["kapan merkurius retrograde?", "harga BTC hari ini", "apa itu FOMC", "halo"]) expect(wantsScreen(q), q).toBe(false);
  });
});
