import { describe, expect, it } from "vitest";
import { extractClaims } from "./factcheck.js";
import { SEED_CASES } from "./factcheck.seed.js";

// Every labelled sentence of the seed read exactly as labelled: the claims it makes, or none.
describe("the fact-check's test seed", () => {
  it.each(SEED_CASES.map((c) => [c.text, c] as const))("%s", (_text, c) => {
    const read = extractClaims(c.text, new Date(`${c.asOf}T18:30:00Z`)).map((x) => [x.indicator, x.value, x.month]);
    expect(read).toEqual(c.claims);
  });

  it("covers every kind of claim, and as many sentences that make none", () => {
    const kinds = new Set(SEED_CASES.flatMap((c) => c.claims.map((x) => x[0])));
    expect(kinds.size).toBeGreaterThanOrEqual(28);
    expect(SEED_CASES.filter((c) => !c.claims.length).length).toBeGreaterThanOrEqual(20);
  });
});
