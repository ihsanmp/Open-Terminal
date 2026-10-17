import { describe, expect, it } from "vitest";
import { findHits, indexOf, normalize } from "./fedsentiment.js";
import { appendSegment, emptyTranscript, parseCaptionSegment, scoreTranscript } from "./fedtranscript.js";

const segment = (seq: number, wallUs: number, cues: Array<[number, string]>) =>
  `\u0000ftypdash emsg http://youtube.com/streaming/metadata/segment/102015 Sequence-Number: ${seq}\r\nIngestion-Walltime-Us: ${wallUs}\r\nTarget-Duration-Us: 5000000\r\n mdat<?xml version="1.0" encoding="utf-8" ?><timedtext format="3">\n<body>\n${cues
    .map(([t, text]) => `<p t="${t}" d="1000">${text}</p>`)
    .join("\n")}\n</body>\n</timedtext>\n`;

describe("live captions", () => {
  it("reads a caption segment's cues and when it was said", () => {
    const seg = parseCaptionSegment(segment(1324148, 1791976835029671, [[0, "north uh"], [1000, "rebellion it&#39;s\nthe"]]));
    expect(seg).toEqual({ seq: 1324148, wallMs: 1791976835030, cues: [{ t: 0, d: 1000, text: "north uh" }, { t: 1000, d: 1000, text: "rebellion it's the" }] });
  });

  it("reads a cue repeated across a segment boundary once, and splits speaker turns at >>", () => {
    const tr = emptyTranscript();
    appendSegment(tr, parseCaptionSegment(segment(10, 1_000_000_000, [[0, "saying that"], [2000, "they want to"]])), 10);
    appendSegment(tr, parseCaptionSegment(segment(11, 1_005_000_000, [[0, "they want to"], [1000, "go >> Thank you."]])), 11);
    appendSegment(tr, parseCaptionSegment(segment(11, 1_005_000_000, [[0, "again"]])), 11);
    expect(tr.lines.map((l) => [l.text, l.turn, l.at])).toEqual([
      ["saying that", 0, 1_000_000],
      ["they want to", 0, 1_002_000],
      ["go", 0, 1_006_000],
      ["Thank you.", 1, 1_006_000],
    ]);
  });
});

describe("hawkish or dovish", () => {
  const sides = (text: string) => findHits(normalize(text)).map((h) => [h.phrase, h.side]);

  it("knows the phrases each way", () => {
    expect(sides("Inflation remains elevated and the labor market is solid.")).toEqual([
      ["inflation remains elevated", 1],
      ["labor market is solid", 1],
    ]);
    expect(sides("We think it is appropriate to cut rates as the labor market has softened")).toEqual([
      ["cut rates", -1],
      ["labor market has softened", -1],
    ]);
  });

  it("turns a phrase round after a negation, and keeps one phrase where two overlap", () => {
    expect(sides("we are not going to raise rates")).toEqual([["raise rates", -1]]);
    expect(sides("policy is less restrictive now")).toEqual([["less restrictive", -1]]);
    expect(sides("fewer rate cuts this year")).toEqual([["rate cuts", 1]]);
    expect(sides("we are not yet confident")).toEqual([["not yet confident", 1]]);
    expect(sides("inflation is easing")).toEqual([["inflation is easing", -1]]);
    expect(sides("Williams sees one more interest rate hike; signs inflation will slow")).toEqual([
      ["one more interest rate hike", 1],
      ["inflation will slow", -1],
    ]);
    expect(sides("the Fed should not have been easing policy")).toEqual([["easing policy", 1]]);
    expect(sides("we expect the tariff effects to be transitory; a one-time price increase")).toEqual([
      ["transitory", -1],
      ["one-time price increase", -1],
    ]);
    expect(sides("Inflation is persistent, it is not transitory")).toEqual([
      ["inflation is persistent", 1],
      ["transitory", 1],
    ]);
  });

  it("reads the phrases the FOMC calibration found turned round (2016–2026 press conferences)", () => {
    // Removing accommodation is raising rates.
    expect(sides("we will continue removing policy accommodation")).toEqual([["removing policy accommodation", 1]]);
    expect(sides("monetary policy remains accommodative")).toEqual([["accommodative", -1]]);
    // A condition is not a reading.
    expect(sides("we need to see inflation coming down")).toEqual([]);
    expect(sides("inflation is coming down")).toEqual([["inflation is coming down", -1]]);
    // Quiet inflation pressures are dovish.
    expect(sides("inflation pressures remain muted")).toEqual([["inflation pressures remain muted", -1]]);
    // Said either way: recessions, a bare "restrictive", an easing of financial conditions, waiting to see.
    expect(sides("we are not trying to cause a recession")).toEqual([]);
    expect(sides("policy is meaningfully restrictive")).toEqual([]);
    expect(sides("an easing of financial conditions")).toEqual([]);
    expect(sides("we can wait and see")).toEqual([]);
    expect(sides("we will keep policy sufficiently restrictive")).toEqual([["keep policy sufficiently restrictive", 1]]);
  });

  it("damps the index toward zero when little has been said", () => {
    expect([indexOf(0, 0), indexOf(1, 0), indexOf(10, 0), indexOf(2, 2)]).toEqual([0, 0.25, 0.769, 0]);
  });

  it("scores a transcript, leaving out the turns that ask a question", () => {
    const lines = [
      { seq: 1, at: 0, text: "Will you cut rates in December?", turn: 0 },
      { seq: 2, at: 60_000, text: "Inflation remains elevated. Further tightening", turn: 1 },
      { seq: 3, at: 70_000, text: "may be appropriate.", turn: 1 },
      { seq: 4, at: 130_000, text: "Next question.", turn: 2 },
    ];
    const { lines: scored, sentiment } = scoreTranscript(lines);
    expect(scored.map((l) => [l.score, l.question])).toEqual([[0, true], [2, false], [0, false], [0, false]]);
    expect(sentiment).toMatchObject({ hawkish: 2, dovish: 0, index: 0.4, stance: "hawkish", questionTurns: [0] });
    expect(sentiment.timeline.map((p) => p.index)).toEqual([0, 0.4, 0.4]);
  });
});
