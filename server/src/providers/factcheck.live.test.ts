import { describe, expect, it, vi } from "vitest";

// The live transcript's claims as its lines come in: no network (the checks answer at once).
vi.mock("./factcheck.js", async (orig) => ({
  ...(await orig<typeof import("./factcheck.js")>()),
  check: async (c: { indicator: string }) => ({ ...c, verdict: "match", official: 1, period: null, series: null, source: null, url: null, note: null }),
}));
const { scanFacts } = await import("./fedtranscript.js");

const session = () => ({ tr: { lines: [] as Array<{ seq: number; at: number; text: string; turn: number }> }, facts: { scanned: 0, read: 0, items: new Map() } }) as unknown as Parameters<typeof scanFacts>[0];
const at = Date.parse("2026-10-29T18:30:00Z");
const add = (s: ReturnType<typeof session>, ...texts: string[]) => {
  for (const text of texts) s.tr.lines.push({ seq: s.tr.lines.length, at, text, turn: 0 });
  scanFacts(s);
  return [...s.facts.items.values()].map((f) => ({ line: f.line, indicator: f.claim.indicator, value: f.claim.value, month: f.claim.month, provisional: f.provisional }));
};

describe("the claims of a live transcript", () => {
  it("checks a figure as soon as it's said, provisionally, takes in its month when it follows, then settles", () => {
    const s = session();
    expect(add(s, "the unemployment rate rose to", "4.3 percent")).toEqual([{ line: 1, indicator: "unemployment", value: 4.3, month: null, provisional: true }]);
    expect(add(s, "in september and payrolls")).toEqual([{ line: 1, indicator: "unemployment", value: 4.3, month: "2026-09", provisional: true }]);
    expect(add(s, "slowed further as", "hiring cooled")).toEqual([{ line: 1, indicator: "unemployment", value: 4.3, month: "2026-09", provisional: false }]);
  });

  it("drops a provisional claim the next words make a goal", () => {
    const s = session();
    expect(add(s, "core pce inflation is running at", "2.4 percent")).toHaveLength(1);
    expect(add(s, "relative to our objective", "of price stability")).toEqual([]);
  });
});
