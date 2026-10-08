import { describe, expect, it } from "vitest";
import { crc32, deflateSync } from "node:zlib";
import { imageSize, parseDate, readJournal, writeJournal, type JournalRow } from "./xlsx.js";
import { unzip, zip } from "./zip.js";

/** A w×h solid PNG, made here so the test needs no files. */
function png(w: number, h: number): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const raw = Buffer.alloc((w * 3 + 1) * h, 0x80);
  for (let y = 0; y < h; y++) raw[y * (w * 3 + 1)] = 0;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

const row = (over: Partial<JournalRow>): JournalRow => ({
  traded_at: "2026-04-01", symbol: "BTC", side: null, quantity: null, price: null, reason: "", emotion_before: "",
  emotion_after: "", grade: null, lesson: "", chart_url: null, ...over,
});

describe("zip", () => {
  it("reads back what it writes", () => {
    const files = unzip(zip([{ name: "a.txt", data: Buffer.from("hello") }, { name: "dir/b.bin", data: Buffer.alloc(5000, 7) }]));
    expect(files.get("a.txt")!.toString()).toBe("hello");
    expect(files.get("dir/b.bin")!.length).toBe(5000);
  });
});

describe("journal workbook", () => {
  it("round-trips every field, a photo and characters that need escaping", () => {
    const rows = [
      row({ symbol: "BBCA.JK", side: "BUY", quantity: 100, price: 6050, reason: "Pullback ke EMA 21 & <support>", emotion_before: "Tenang", emotion_after: "Puas", grade: 5, lesson: "Sabar = hasil", chart_url: "https://www.tradingview.com/x/abc/" }),
      row({ traded_at: "2026-04-02", symbol: "ETH", side: "SELL", quantity: 0.5, price: 3200.25, grade: 1, lesson: "Jangan FOMO" }),
    ];
    const photo = { data: png(40, 20), ext: "png" as const };
    const back = readJournal(writeJournal(rows, (i) => (i === 0 ? photo : null), { title: "TRADING JOURNAL", exportedAt: "2026-10-08" }));
    expect(back).toHaveLength(2);
    const { image, ...first } = back[0];
    // A row with a photo keeps the photo, not the link.
    expect(first).toEqual({ ...rows[0], chart_url: null });
    expect(image?.ext).toBe("png");
    expect(imageSize(image!)).toEqual({ w: 40, h: 20 });
    expect(back[1]).toEqual(rows[1]);
  });

  it("reads the template's dates and leaves its empty numbered rows out", () => {
    expect(parseDate("01/04/2026")).toBe("2026-04-01");
    expect(parseDate("2026-04-01")).toBe("2026-04-01");
    expect(parseDate("46113")).toBe("2026-04-01");
    const empty = readJournal(writeJournal([], () => null, { title: "T", exportedAt: "x" }));
    expect(empty).toEqual([]);
  });
});
