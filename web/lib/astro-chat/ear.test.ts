import { beforeEach, describe, expect, it } from "vitest";
import { hear, resetEar, userSpoke } from "./ear";
import { dropFillers, stillGoing, whose } from "./voice";

const frames = (level: number, n: number, from: number, played = 0) => {
  for (let i = 0; i < n; i++) hear(level, played, from + i * 40);
  return from + n * 40;
};

/** The answer playing (its level going up and down like speech) and the microphone hearing it at `share`, plus the user at `user`. */
const speech = (share: number, user: number, n: number, from: number) => {
  for (let i = 0; i < n; i++) {
    const played = 0.08 + 0.06 * Math.sin(i / 3);
    hear(Math.hypot(played * share, user), played, from + i * 40);
  }
  return from + n * 40;
};

describe("the second ear", () => {
  beforeEach(() => resetEar());

  it("hears a voice over the room, not the room or a click", () => {
    let t = frames(0.003, 50, 0);
    expect(userSpoke(500, t)).toBe(false);
    // A click: one frame.
    t = frames(0.2, 1, t);
    t = frames(0.003, 2, t);
    expect(userSpoke(100, t)).toBe(false);
    // Talking.
    t = frames(0.05, 10, t);
    expect(userSpoke(100, t)).toBe(true);
    // And a while after, no more.
    t = frames(0.003, 75, t);
    expect(userSpoke(2000, t)).toBe(false);
  });

  it("doesn't take a steady noisy room for a voice", () => {
    // A fan, say: the room's level comes up to it over some seconds.
    let t = frames(0.02, 600, 0);
    t = frames(0.02, 25, t);
    expect(userSpoke(500, t)).toBe(false);
  });

  it("doesn't take the answer's echo for the user, however loud it comes back", () => {
    let t = frames(0.003, 50, 0);
    // The speakers loud, close to the microphone: the echo as loud as what's played.
    t = speech(1, 0, 100, t);
    expect(userSpoke(2000, t)).toBe(false);
    // Louder than first thought (twice what's played): heard as the user for a moment at most,
    // then learned as echo.
    resetEar();
    t = frames(0.003, 50, 0);
    t = speech(2.2, 0, 300, t);
    expect(userSpoke(2000, t)).toBe(false);
  });

  it("hears the user talking over the answer", () => {
    let t = frames(0.003, 50, 0);
    t = speech(0.6, 0, 150, t);
    expect(userSpoke(2000, t)).toBe(false);
    t = speech(0.6, 0.3, 15, t);
    expect(userSpoke(200, t)).toBe(true);
  });
});

const said = "Wah, ada beberapa yang seru nih. Emas lagi jatuh lumayan dalam, sekitar 4.015, turun ~6% sebulan.";

describe("whose voice the recognizer heard", () => {
  it("while the answer is read out, goes by the ear when it can tell", () => {
    // No voice on the echo-cancelled microphone: its echo, even words that don't match.
    expect(whose("emas lagi jatoh lumayan dalem", said, true, false)).toBe("echo");
    expect(whose("tunggu aku mau tanya", said, true, false)).toBe("echo");
    // The user's voice there: a word of their own is enough.
    expect(whose("bitcoin", said, true, true)).toBe("user");
    expect(whose("emas lagi jatuh", said, true, true)).toBe("echo");
    // Can't tell: the words alone.
    expect(whose("emas lagi jatoh lumayan dalem", said, true, null)).toBe("echo");
    expect(whose("aku mau tanya soal bitcoin", said, true, null)).toBe("user");
  });

  it("just after, hears the user answering straight away", () => {
    expect(whose("iya lanjut", said, false, null)).toBe("user");
    expect(whose("turun enam persen sebulan", said, false, null)).toBe("echo");
    // Their own "seru nih", with the ear hearing them.
    expect(whose("seru nih", said, false, true)).toBe("user");
    // Its last words coming in late, misheard, with no voice on the ear: still its echo.
    expect(whose("sekitar empat ribu lima belas turun enam person", said, false, false)).toBe("echo");
  });
});

describe("when the user has finished", () => {
  it("waits on after 'ehmm' or a word that leads on", () => {
    expect(stillGoing("harga emas sekarang berapa ehmm")).toBe(true);
    expect(stillGoing("harga emas sekarang berapa, hmm…")).toBe(true);
    expect(stillGoing("bandingkan emas dan")).toBe(true);
    expect(stillGoing("kalau bitcoin turun terus")).toBe(true);
    expect(stillGoing("harga emas sekarang berapa")).toBe(false);
    expect(stillGoing("")).toBe(false);
  });

  it("sends the question without the fillers", () => {
    expect(dropFillers("ehmm harga emas ehm sekarang berapa")).toBe("harga emas sekarang berapa");
    expect(dropFillers("Emm, gimana kalau bitcoin, hmm")).toBe("gimana kalau bitcoin");
    expect(dropFillers("emas naik")).toBe("emas naik");
  });
});
