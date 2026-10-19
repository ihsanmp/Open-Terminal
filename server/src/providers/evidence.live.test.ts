import { describe, expect, it, vi } from "vitest";

// The live transcript's statements as its lines come in, looked up in a stand-in archive.
let archive: Array<{ words: RegExp; publisher: string; title: string }> = [];
vi.mock("./evidence.js", async (orig) => ({
  ...(await orig<typeof import("./evidence.js")>()),
  findReports: (text: string, time: number) => archive.filter((a) => a.words.test(text)).map((a) => ({ publisher: a.publisher, title: a.title, link: "https://example.com", time })),
}));
const { scanEvidence } = await import("./fedtranscript.js");

const session = () => ({ tr: { lines: [] as Array<{ seq: number; at: number; text: string; turn: number }> }, evidence: { scanned: 0, checked: 0, items: new Map() } }) as unknown as Parameters<typeof scanEvidence>[0];
const at = Date.parse("2026-10-18T15:00:00Z");
const add = (s: ReturnType<typeof session>, now: number, ...texts: string[]) => {
  for (const text of texts) s.tr.lines.push({ seq: s.tr.lines.length, at, text, turn: 0 });
  scanEvidence(s, now);
  return [...s.evidence.items.values()].map((e) => ({ line: e.line, found: e.sources.map((x) => x.publisher) }));
};

describe("the events of a live transcript", () => {
  it("looks a statement up once its sentence is done, once", () => {
    archive = [{ words: /netflix/, publisher: "BBC World", title: "Netflix to lay off 1,000 staff" }];
    const s = session();
    expect(add(s, at, "and in other news netflix announced", "it will lay off about one thousand")).toEqual([]);
    expect(add(s, at, "employees in its deepest cuts since 2022.", "turning now to", "the weather")).toEqual([{ line: 0, found: ["BBC World"] }]);
    expect(add(s, at, "it will be sunny", "all weekend long")).toEqual([{ line: 0, found: ["BBC World"] }]);
    expect(s.evidence.checked).toBe(1);
  });

  it("looks again for one no outlet had yet, for a while", () => {
    archive = [];
    const s = session();
    expect(add(s, at, "boeing announced it has closed its plant in wichita.", "more on that", "later on")).toEqual([{ line: 0, found: [] }]);
    archive = [{ words: /boeing/, publisher: "Reuters", title: "Boeing closes Wichita plant" }];
    expect(add(s, at + 60_000, "back to you")).toEqual([{ line: 0, found: [] }]);
    expect(add(s, at + 11 * 60_000, "thanks")).toEqual([{ line: 0, found: ["Reuters"] }]);
  });
});
