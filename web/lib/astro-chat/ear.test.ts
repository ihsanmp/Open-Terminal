import { beforeEach, describe, expect, it } from "vitest";
import { hear, resetEar, userSpoke } from "./ear";
import { whose } from "./voice";

const frames = (level: number, n: number, from: number) => {
  for (let i = 0; i < n; i++) hear(level, from + i * 40);
  return from + n * 40;
};

describe("the second ear", () => {
  beforeEach(resetEar);

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
  });
});
