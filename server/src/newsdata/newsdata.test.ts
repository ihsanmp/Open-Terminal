import { describe, expect, it } from "vitest";
import { mergeRows, parseCsv, toCsv } from "./csv.js";
import { articleText, finishFed, gapsOf, heardOf, kindOf, officialUrls, readText, rejectReason, sameEvent, statementText, surnameOf } from "./newsdata.js";

describe("the CSV", () => {
  it("reads back what it writes, commas, quotes and line breaks included", () => {
    const rows = [{ a: "1", b: 'say "hawkish", then\nhold' }, { a: "2", b: "" }];
    expect(parseCsv(toCsv(["a", "b"], rows))).toEqual(rows);
  });

  it("merges by key, keeping a field the new row leaves empty", () => {
    const merged = mergeRows([{ key: "x", live: "12", official: "" }], [{ key: "x", live: "", official: "0.4" }, { key: "y", live: "1", official: "" }], "key");
    expect(merged).toEqual([{ key: "x", live: "12", official: "0.4" }, { key: "y", live: "1", official: "" }]);
  });
});

describe("a Fed event", () => {
  const T = Date.UTC(2026, 9, 28, 18, 30);
  const line = (min: number, text: string) => ({ seq: min, at: T + min * 60_000, text, turn: 0 });

  it("knows how long each kind runs", () => {
    expect(kindOf({ title: "FOMC Press Conference", type: "FOMC" })).toEqual({ kind: "press_conference", minutes: 60 });
    expect(kindOf({ title: "FOMC Meeting", type: "FOMC" }).kind).toBe("statement");
    expect(kindOf({ title: "Speech - Governor Waller", type: "Speeches" })).toEqual({ kind: "speech", minutes: 45 });
  });

  it("counts the minutes heard live, not a pause when the panel was closed", () => {
    const lines = [line(-60, "pre-show"), line(0, "good afternoon"), line(2, "inflation remains elevated"), line(4, "more"), line(30, "back"), line(33, "end")];
    const h = heardOf(lines, T, 60)!;
    expect(h.lines).toHaveLength(5);
    expect(h.minutes).toBe(7);
  });

  it("is heard in full, in part or not at all; the official text's reading wins", () => {
    expect(finishFed({ expected_minutes: "60", live_minutes: "55", live_index: "0.4" })).toMatchObject({ coverage: "full", index: "0.4", stance: "hawkish", index_from: "live" });
    expect(finishFed({ expected_minutes: "60", live_minutes: "10", live_index: "0.4", official_index: "-0.25" })).toMatchObject({ coverage: "partial", index: "-0.25", stance: "dovish", index_from: "official" });
    expect(finishFed({ expected_minutes: "45" })).toMatchObject({ coverage: "none", index: "", stance: "" });
  });

  it("asks for what's missing: a press conference heard in part, with no official text yet", () => {
    const now = T + 24 * 3_600_000;
    const gaps = gapsOf(
      now,
      [
        { key: "2026-10-28|FOMC Press Conference", kind: "press_conference", date_utc: new Date(T).toISOString(), date_wib: "", title: "FOMC Press Conference", coverage: "partial", live_minutes: "10", expected_minutes: "60" },
        { key: "2026-10-28|FOMC Meeting", kind: "statement", date_utc: new Date(T).toISOString(), date_wib: "", title: "FOMC Meeting", coverage: "text", official_file: "texts/x.txt" },
      ],
      [],
    );
    expect(gaps).toHaveLength(1);
    expect(gaps[0].hint).toBe("https://www.federalreserve.gov/mediacenter/files/FOMCpresconf20261028.pdf");
    expect(gaps[0].missing).toMatch(/10 dari ±60 menit/);
  });

  it("takes the FOMC statement's paragraphs from the Board's page, and reads them", () => {
    const html = `<div id="article"><p>October 28, 2026</p><p>Share</p><p>The Federal Open Market Committee approved the following statement:</p><p>Economic activity is expanding at a strong pace. ${"Inflation remains elevated. ".repeat(8)}</p><p>For media inquiries, call.</p><p>Last Update:</p></div>`;
    const text = statementText(html)!;
    expect(text).toMatch(/^The Federal Open Market Committee/);
    expect(text).not.toMatch(/media inquiries/);
    expect(readText(text).hawkish).toBeGreaterThan(1);
  });
});

describe("an official transcript", () => {
  it("is read on the chair's words, not the reporters' questions", () => {
    const text = "Transcript\n\n  CHAIRMAN WARSH. Inflation remains elevated.\n  NICK TIMIRAOS. Why not cut rates today?\n  CHAIRMAN WARSH. We removed a dose of accommodation.\n";
    expect(readText(text)).toMatchObject({ hawkish: 2, dovish: 0 });
  });
});

describe("the inbox", () => {
  const words = "word ".repeat(90);

  it("takes a sourced text or release, and says why it won't take another", () => {
    expect(rejectReason({ type: "fed_text", title: "FOMC Press Conference", date: "2026-10-28T18:30:00Z", text: words, source_url: "https://www.federalreserve.gov/x.pdf" })).toBeNull();
    expect(rejectReason({ type: "release", title: "Core PCE", date: "2026-10-29T12:30:00Z", actual: 0.2, source_url: "https://www.bea.gov/" })).toBeNull();
    expect(rejectReason({ type: "fed_text", title: "x", date: "2026-10-28", text: "short", source_url: "https://a.b" })).toMatch(/80 kata/);
    expect(rejectReason({ type: "release", title: "x", date: "2026-10-28", actual: 1, source_url: "http://a.b" })).toMatch(/https/);
    expect(rejectReason({ type: "other", title: "x", date: "2026-10-28", source_url: "https://a.b" })).toMatch(/type/);
  });

  it("matches a text to its event by enough words alike", () => {
    expect(sameEvent("FOMC Press Conference", "Transcript of Chair's FOMC Press Conference")).toBe(true);
    expect(sameEvent("Speech - Governor Waller on the Economic Outlook", "Waller, Economic Outlook")).toBe(true);
    expect(sameEvent("FOMC Press Conference", "Speech - Governor Waller")).toBe(false);
  });
});

describe("the app's own search for official texts", () => {
  it("knows where the Board puts each text, by the US Eastern date", () => {
    const at = (iso: string) => iso;
    expect(officialUrls({ kind: "press_conference", title: "FOMC Press Conference", date_utc: at("2026-10-28T18:30:00Z") }, [])).toEqual([
      "https://www.federalreserve.gov/mediacenter/files/FOMCpresconf20261028.pdf",
    ]);
    // 00:25 WIB on 29 Sep is the 28th in Washington.
    expect(officialUrls({ kind: "speech", title: "Speech - Governor Lisa D. Cook", date_utc: at("2026-09-28T17:25:00Z") }, [])[0]).toBe("https://www.federalreserve.gov/newsevents/speech/cook20260928a.htm");
    expect(officialUrls({ kind: "minutes", title: "FOMC Minutes", date_utc: at("2026-10-07T18:00:00Z") }, ["2026-09-16T18:00:00.000Z", "2026-07-29T18:00:00.000Z"])).toEqual([
      "https://www.federalreserve.gov/monetarypolicy/fomcminutes20260916.htm",
    ]);
    expect(surnameOf("Speech - Vice Chair for Supervision Michelle W. Bowman")).toBe("bowman");
  });

  it("takes a speech's text from its page, without the heading", () => {
    const body = "Thank you for having me. ".repeat(30);
    const text = articleText(`<div id="article"><p>October 01, 2026</p><h3>Title</h3><p>Governor X</p><p>Share</p><p>Watch Live</p><p>${body}</p><p>Last Update: October 1</p></div>`)!;
    expect(text.startsWith("Thank you")).toBe(true);
    expect(text).not.toMatch(/Last Update|Watch Live/);
  });

  it("leaves to the search only what the app looked for twice and didn't find, and never a Discussion", () => {
    const T = Date.UTC(2026, 9, 1, 14);
    const row = (title: string, tries: string) => ({ key: title, kind: "speech", date_utc: new Date(T).toISOString(), date_wib: "", title, coverage: "none", app_tries: tries, expected_minutes: "45", live_minutes: "" });
    const gaps = gapsOf(T + 86_400_000, [row("Speech - Governor A B", "1"), row("Speech - Governor C D", "2"), row("Discussion - Governor E F", "3")], []);
    expect(gaps.map((g) => g.claude_ready)).toEqual(["no", "yes", "no"]);
  });

  it("keeps a row's time when nothing in it changed (the files are committed daily)", () => {
    const old = [{ key: "a", v: "1", updated_at: "then" }];
    expect(mergeRows(old, [{ key: "a", v: "1", updated_at: "now" }], "key")[0].updated_at).toBe("then");
    expect(mergeRows(old, [{ key: "a", v: "2", updated_at: "now" }], "key")[0].updated_at).toBe("now");
  });
});
