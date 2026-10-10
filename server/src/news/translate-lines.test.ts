import { describe, expect, it } from "vitest";
import { batches, linesOf } from "./translate-lines.js";

describe("translation batches", () => {
  it("reads the reply's lines back in order", () => {
    const reply = [[["Minyak\n", "Oil\n"], ["Badai Isaias\n", "Hurricane Isaias\n"], ["Harga turun. ", "Prices fall. "], ["Kalimat kedua.", "Second sentence."]]];
    expect(linesOf(reply)).toEqual(["Minyak", "Badai Isaias", "Harga turun. Kalimat kedua."]);
    expect(linesOf(null)).toEqual([""]);
  });

  it("keeps each request under the limit", () => {
    expect(batches(["aaaa", "bbbb", "cccc"], 10)).toEqual([["aaaa", "bbbb"], ["cccc"]]);
    expect(batches(["a".repeat(20)], 10)).toEqual([["a".repeat(20)]]);
    expect(batches([], 10)).toEqual([]);
  });
});
