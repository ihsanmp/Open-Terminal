// The trading journal as an .xlsx laid out like the TWX journal template the user keeps theirs
// in (# · TANGGAL · PAIR · REASON · EMOTION SEBELUM · EMOTION SESUDAH · GRADE · LESSON · FOTO
// CHART, dark with a gold header), with SIDE · QTY · PRICE after it for the holdings; and the
// same layout (or the template itself, filled in) read back, chart photos included.

import { XMLParser } from "fast-xml-parser";
import { unzip, zip, type ZipEntry } from "./zip.js";

export type JournalRow = {
  traded_at: string; // YYYY-MM-DD
  symbol: string;
  side: "BUY" | "SELL" | null;
  quantity: number | null;
  price: number | null;
  reason: string;
  emotion_before: string;
  emotion_after: string;
  grade: number | null;
  lesson: string;
  chart_url: string | null;
};
export type JournalImage = { data: Buffer; ext: "png" | "jpeg" };
export type ImportedRow = JournalRow & { image?: JournalImage };

/** The template's columns, B onward, then the three it leaves to the exchange. */
const COLUMNS = [
  { key: "n", head: "#", width: 5 },
  { key: "date", head: "TANGGAL", width: 14 },
  { key: "pair", head: "PAIR", width: 12 },
  { key: "reason", head: "REASON\n(Tulis SEBELUM trade)", width: 35 },
  { key: "before", head: "EMOTION SEBELUM\n(Tulis SEBELUM trade)", width: 28 },
  { key: "after", head: "EMOTION SESUDAH\n(Tulis SESUDAH trade)", width: 28 },
  { key: "grade", head: "GRADE\n(1-5)", width: 8 },
  { key: "lesson", head: "LESSON / PEMBELAJARAN\n(1 kalimat)", width: 35 },
  { key: "chart", head: "FOTO CHART", width: 30 },
  { key: "side", head: "SIDE", width: 8 },
  { key: "qty", head: "QTY", width: 12 },
  { key: "price", head: "PRICE", width: 14 },
] as const;
const FIRST_COL = 1; // column B (A is a margin)
const HEADER_ROW = 6;
/** Numbered rows in a fresh journal, as in the template; a longer one gets some to spare. */
const MIN_ROWS = 200;
const SPARE_ROWS = 20;
const ROW_HEIGHT = 50;
const IMAGE_ROW_HEIGHT = 100;
const EMU_PER_PX = 9525;

const colLetter = (i: number) => {
  let s = "";
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
};
const colIndex = (letters: string) => [...letters].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
const esc = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    // Characters XML 1.0 can't hold at all.
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");

// ---- styles: the template's palette ----
const GOLD = "FFF0B90B";
const INK = "FFF5F5F5";
const GREY = "FF888888";
const PAGE = "FF0A0A0A";
const STRIPES = ["FF222222", "FF1A1A1A"];
const fonts = [
  `<font><sz val="11"/><name val="Calibri"/></font>`,
  `<font><b/><sz val="20"/><color rgb="${GOLD}"/><name val="Arial"/></font>`, // 1 title
  `<font><sz val="9"/><color rgb="${GREY}"/><name val="Arial"/></font>`, // 2 subtitle, #
  `<font><b/><sz val="9"/><color rgb="${PAGE}"/><name val="Arial"/></font>`, // 3 header
  `<font><sz val="10"/><color rgb="${INK}"/><name val="Arial"/></font>`, // 4 text
  `<font><b/><sz val="10"/><color rgb="${GOLD}"/><name val="Arial"/></font>`, // 5 pair
  `<font><b/><sz val="14"/><color rgb="${GOLD}"/><name val="Arial"/></font>`, // 6 grade
  `<font><b/><sz val="10"/><color rgb="FF26A69A"/><name val="Arial"/></font>`, // 7 BUY
  `<font><b/><sz val="10"/><color rgb="FFEF5350"/><name val="Arial"/></font>`, // 8 SELL
];
const solid = (rgb: string) => `<fill><patternFill patternType="solid"><fgColor rgb="${rgb}"/><bgColor indexed="64"/></patternFill></fill>`;
const fills = [`<fill><patternFill patternType="none"/></fill>`, `<fill><patternFill patternType="gray125"/></fill>`, solid(PAGE), solid(GOLD), solid(STRIPES[0]), solid(STRIPES[1])];
const thin = `<left style="thin"><color rgb="FF2C2C2C"/></left><right style="thin"><color rgb="FF2C2C2C"/></right><top style="thin"><color rgb="FF2C2C2C"/></top><bottom style="thin"><color rgb="FF2C2C2C"/></bottom>`;
const borders = [`<border><left/><right/><top/><bottom/><diagonal/></border>`, `<border>${thin}<diagonal/></border>`];

const xfs: string[] = [];
const xf = (font: number, fill: number, border: number, h: string, v = "center", wrap = false, numFmt = 0) => {
  xfs.push(
    `<xf numFmtId="${numFmt}" fontId="${font}" fillId="${fill}" borderId="${border}" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="${h}" vertical="${v}"${wrap ? ` wrapText="1"` : ""}/></xf>`
  );
  return xfs.length - 1;
};
xf(0, 0, 0, "general");
const S = {
  page: xf(4, 2, 0, "left"),
  title: xf(1, 2, 0, "left"),
  subtitle: xf(2, 2, 0, "left"),
  header: xf(3, 3, 1, "center", "center", true, 49),
  // Per stripe: [#, date, pair, text, grade, number, BUY, SELL]
  rows: [4, 5].map((fill) => ({
    n: xf(2, fill, 1, "center"),
    date: xf(4, fill, 1, "center", "center", false, 49),
    pair: xf(5, fill, 1, "center", "center", false, 49),
    text: xf(4, fill, 1, "left", "center", true, 49),
    grade: xf(6, fill, 1, "center"),
    num: xf(4, fill, 1, "right"),
    buy: xf(7, fill, 1, "center", "center", false, 49),
    sell: xf(8, fill, 1, "center", "center", false, 49),
  })),
};
const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="${fonts.length}">${fonts.join("")}</fonts><fills count="${fills.length}">${fills.join("")}</fills><borders count="${borders.length}">${borders.join("")}</borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="${xfs.length}">${xfs.join("")}</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

/** A picture's size in pixels, from its PNG or JPEG header. */
export function imageSize(img: JournalImage): { w: number; h: number } | null {
  const b = img.data;
  if (img.ext === "png") return b.length > 24 ? { w: b.readUInt32BE(16), h: b.readUInt32BE(20) } : null;
  for (let i = 2; i + 9 < b.length; ) {
    if (b[i] !== 0xff) return null;
    const marker = b[i + 1];
    const len = b.readUInt16BE(i + 2);
    // Start-of-frame markers carry the size (not DHT, JPG or DAC).
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { h: b.readUInt16BE(i + 5), w: b.readUInt16BE(i + 7) };
    i += 2 + len;
  }
  return null;
}

const ddmmyyyy = (iso: string) => {
  const [y, m, d] = iso.slice(0, 10).split("-");
  return y && m && d ? `${d}/${m}/${y}` : iso;
};

/** The journal, oldest first, as an .xlsx; `imageOf` gives a row's chart photo if it has one. */
export function writeJournal(rows: JournalRow[], imageOf: (i: number) => JournalImage | null, opts: { title: string; exportedAt: string }): Buffer {
  const lastCol = FIRST_COL + COLUMNS.length - 1;
  const cell = (col: number, row: number, style: number, value?: string | number | null) => {
    const ref = `${colLetter(col)}${row}`;
    if (value === undefined || value === null || value === "") return `<c r="${ref}" s="${style}"/>`;
    if (typeof value === "number") return `<c r="${ref}" s="${style}"><v>${value}</v></c>`;
    return `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${esc(value)}</t></is></c>`;
  };
  const pageRow = (r: number, ht: number, inner: (c: number) => string) => {
    const cells = [cell(0, r, S.page)];
    for (let c = FIRST_COL; c <= lastCol; c++) cells.push(inner(c));
    return `<row r="${r}" ht="${ht}" customHeight="1">${cells.join("")}</row>`;
  };

  const out: string[] = [];
  out.push(pageRow(1, 13.5, (c) => cell(c, 1, S.page)));
  out.push(pageRow(2, 25.3, (c) => (c === FIRST_COL ? cell(c, 2, S.title, opts.title) : cell(c, 2, S.title))));
  out.push(
    pageRow(3, 13.55, (c) =>
      c === FIRST_COL
        ? cell(c, 3, S.subtitle, `Tulis REASON & EMOTION SEBELUM trade; EMOTION SESUDAH, GRADE dan LESSON SESUDAH trade. Diekspor dari OpenTerminal ${opts.exportedAt}.`)
        : cell(c, 3, S.subtitle)
    )
  );
  out.push(pageRow(4, 13.5, (c) => cell(c, 4, S.page)));
  out.push(pageRow(5, 13.5, (c) => cell(c, 5, S.page)));
  out.push(pageRow(HEADER_ROW, 40, (c) => cell(c, HEADER_ROW, S.header, COLUMNS[c - FIRST_COL].head)));

  const anchors: string[] = [];
  const media: ZipEntry[] = [];
  const total = Math.max(MIN_ROWS, rows.length + SPARE_ROWS);
  for (let i = 0; i < total; i++) {
    const r = HEADER_ROW + 1 + i;
    const st = S.rows[i % 2];
    const row = rows[i];
    const img = row ? imageOf(i) : null;
    const cells = [cell(0, r, S.page)];
    const put = (key: (typeof COLUMNS)[number]["key"], style: number, value?: string | number | null) =>
      cells.push(cell(FIRST_COL + COLUMNS.findIndex((c) => c.key === key), r, style, value));
    put("n", st.n, i + 1);
    put("date", st.date, row ? ddmmyyyy(row.traded_at) : null);
    put("pair", st.pair, row?.symbol);
    put("reason", st.text, row?.reason);
    put("before", st.text, row?.emotion_before);
    put("after", st.text, row?.emotion_after);
    put("grade", st.grade, row?.grade ?? null);
    put("lesson", st.text, row?.lesson);
    put("chart", st.text, img ? null : row?.chart_url);
    put("side", row?.side === "SELL" ? st.sell : st.buy, row?.side);
    put("qty", st.num, row?.quantity ?? null);
    put("price", st.num, row?.price ?? null);
    out.push(`<row r="${r}" ht="${img ? IMAGE_ROW_HEIGHT : ROW_HEIGHT}" customHeight="1">${cells.join("")}</row>`);

    if (img) {
      const n = media.length + 1;
      media.push({ name: `xl/media/image${n}.${img.ext}`, data: img.data });
      // Fitted inside the photo cell, its proportions kept.
      const boxW = COLUMNS.find((c) => c.key === "chart")!.width * 7 - 8;
      const boxH = (IMAGE_ROW_HEIGHT * 96) / 72 - 8;
      const size = imageSize(img) ?? { w: boxW, h: boxH };
      const k = Math.min(boxW / size.w, boxH / size.h);
      const [cx, cy] = [Math.round(size.w * k * EMU_PER_PX), Math.round(size.h * k * EMU_PER_PX)];
      const col = FIRST_COL + COLUMNS.findIndex((c) => c.key === "chart");
      anchors.push(
        `<xdr:oneCellAnchor><xdr:from><xdr:col>${col}</xdr:col><xdr:colOff>${4 * EMU_PER_PX}</xdr:colOff><xdr:row>${r - 1}</xdr:row><xdr:rowOff>${4 * EMU_PER_PX}</xdr:rowOff></xdr:from><xdr:ext cx="${cx}" cy="${cy}"/><xdr:pic><xdr:nvPicPr><xdr:cNvPr id="${n + 1}" name="Chart ${i + 1}"/><xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr><xdr:blipFill><a:blip r:embed="rId${n}"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill><xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic><xdr:clientData/></xdr:oneCellAnchor>`
      );
    }
  }
  const lastRow = HEADER_ROW + total;

  const cols = [`<col min="1" max="1" width="3" style="${S.page}" customWidth="1"/>`]
    .concat(COLUMNS.map((c, i) => `<col min="${FIRST_COL + 1 + i}" max="${FIRST_COL + 1 + i}" width="${c.width}" style="${S.page}" customWidth="1"/>`))
    .concat(`<col min="${lastCol + 2}" max="16384" width="9" style="${S.page}" customWidth="1"/>`);
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><dimension ref="A1:${colLetter(lastCol)}${lastRow}"/><sheetViews><sheetView workbookViewId="0" showGridLines="0"><pane ySplit="${HEADER_ROW}" topLeftCell="A${HEADER_ROW + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="15"/><cols>${cols.join("")}</cols><sheetData>${out.join("")}</sheetData><mergeCells count="2"><mergeCell ref="${colLetter(FIRST_COL)}2:${colLetter(lastCol)}2"/><mergeCell ref="${colLetter(FIRST_COL)}3:${colLetter(lastCol)}3"/></mergeCells><pageMargins left="0.75" right="0.75" top="1" bottom="1" header="0.5" footer="0.5"/>${anchors.length ? `<drawing r:id="rId1"/>` : ""}</worksheet>`;

  const files: ZipEntry[] = [
    {
      name: "[Content_Types].xml",
      data: Buffer.from(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="jpeg" ContentType="image/jpeg"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${anchors.length ? `<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>` : ""}</Types>`
      ),
    },
    {
      name: "_rels/.rels",
      data: Buffer.from(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`
      ),
    },
    {
      name: "xl/workbook.xml",
      data: Buffer.from(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Trading Journal" sheetId="1" r:id="rId1"/></sheets></workbook>`
      ),
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      data: Buffer.from(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`
      ),
    },
    { name: "xl/styles.xml", data: Buffer.from(STYLES) },
    { name: "xl/worksheets/sheet1.xml", data: Buffer.from(sheet) },
  ];
  if (anchors.length) {
    files.push(
      {
        name: "xl/worksheets/_rels/sheet1.xml.rels",
        data: Buffer.from(
          `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/></Relationships>`
        ),
      },
      {
        name: "xl/drawings/drawing1.xml",
        data: Buffer.from(
          `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">${anchors.join("")}</xdr:wsDr>`
        ),
      },
      {
        name: "xl/drawings/_rels/drawing1.xml.rels",
        data: Buffer.from(
          `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${media
            .map((m, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/${m.name.split("/").pop()}"/>`)
            .join("")}</Relationships>`
        ),
      },
      ...media
    );
  }
  return zip(files);
}

// ---- reading ----

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  removeNSPrefix: true,
  parseTagValue: false,
  trimValues: false,
  isArray: (name) => ["row", "c", "si", "r", "sheet", "Relationship", "oneCellAnchor", "twoCellAnchor", "absoluteAnchor"].includes(name),
});
const textOf = (node: unknown): string => {
  if (node === undefined || node === null) return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  const n = node as Record<string, unknown>;
  if ("#text" in n) return textOf(n["#text"]);
  if ("t" in n || "r" in n) return textOf(n.t) + textOf(n.r);
  return "";
};

/** Which journal field a header names, from the template's own words and the obvious others. */
function fieldOf(header: string): keyof JournalRow | "image" | null {
  const h = header.toUpperCase().split("\n")[0].trim();
  if (/^(TANGGAL|DATE|TGL)/.test(h)) return "traded_at";
  if (/^(PAIR|SYMBOL|TICKER|ASET|ASSET|SAHAM|KODE)/.test(h)) return "symbol";
  if (/^REASON|^ALASAN/.test(h)) return "reason";
  if (/^EMOTION SEBELUM|^EMOTION BEFORE|^EMOSI SEBELUM/.test(h)) return "emotion_before";
  if (/^EMOTION SESUDAH|^EMOTION AFTER|^EMOSI SESUDAH/.test(h)) return "emotion_after";
  if (/^GRADE|^NILAI/.test(h)) return "grade";
  if (/^LESSON|^PEMBELAJARAN/.test(h)) return "lesson";
  if (/^FOTO|^CHART|^SCREENSHOT/.test(h)) return "image";
  if (/^(SIDE|ARAH|POSISI|BUY\/SELL)/.test(h)) return "side";
  if (/^(QTY|QUANTITY|JUMLAH|LOT|UNIT)/.test(h)) return "quantity";
  if (/^(PRICE|HARGA|ENTRY)/.test(h)) return "price";
  return null;
}

/** A date cell as YYYY-MM-DD: the template's DD/MM/YYYY text, ISO text, or an Excel serial. */
export function parseDate(v: string): string | null {
  const s = v.trim();
  let m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const serial = Number(s);
  if (Number.isFinite(serial) && serial > 20000 && serial < 80000) return new Date(Math.round((serial - 25569) * 86_400_000)).toISOString().slice(0, 10);
  return null;
}
const parseNumber = (v: string) => {
  const s = v.trim().replace(/[^\d.,-]/g, "");
  if (!s) return null;
  // "1.234,5" (Indonesian) or "1,234.5": the last separator is the decimal one.
  const normalized = s.lastIndexOf(",") > s.lastIndexOf(".") ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
};
/** What the database takes: a quantity above 0, a price of 0 or more. */
const positive = (n: number | null, zeroOk = false) => (n === null || n < 0 || (n === 0 && !zeroOk) ? null : n);
const parseSide = (v: string): "BUY" | "SELL" | null => {
  const s = v.trim().toUpperCase();
  if (/^(BUY|B|BELI|LONG)$/.test(s)) return "BUY";
  if (/^(SELL|S|JUAL|SHORT)$/.test(s)) return "SELL";
  return null;
};

const resolve = (base: string, target: string) => {
  if (target.startsWith("/")) return target.slice(1);
  const parts = base.split("/").slice(0, -1);
  for (const seg of target.split("/")) {
    if (seg === "..") parts.pop();
    else if (seg !== ".") parts.push(seg);
  }
  return parts.join("/");
};
const relsOf = (files: Map<string, Buffer>, part: string): Map<string, string> => {
  const dir = part.split("/").slice(0, -1).join("/");
  const file = `${dir}/_rels/${part.split("/").pop()}.rels`;
  const buf = files.get(file);
  if (!buf) return new Map();
  const rels = parser.parse(buf.toString("utf8"))?.Relationships?.Relationship ?? [];
  return new Map(rels.map((r: any) => [r["@_Id"], resolve(part, r["@_Target"])]));
};

/** The journal rows in an .xlsx laid out like the template (its first sheet, headed by TANGGAL and PAIR). */
export function readJournal(buf: Buffer): ImportedRow[] {
  const files = unzip(buf);
  const wb = parser.parse(files.get("xl/workbook.xml")?.toString("utf8") ?? "");
  const first = wb?.workbook?.sheets?.sheet?.[0];
  if (!first) throw new Error("no sheet in this workbook");
  const sheetPart = relsOf(files, "xl/workbook.xml").get(first["@_id"]);
  const sheetXml = sheetPart && files.get(sheetPart);
  if (!sheetXml) throw new Error("the workbook's first sheet is missing");
  const shared: string[] = (parser.parse(files.get("xl/sharedStrings.xml")?.toString("utf8") ?? "")?.sst?.si ?? []).map(textOf);

  const grid = new Map<number, Map<number, string>>();
  for (const row of parser.parse(sheetXml.toString("utf8"))?.worksheet?.sheetData?.row ?? []) {
    const cells = new Map<number, string>();
    for (const c of row.c ?? []) {
      const ref: string = c["@_r"] ?? "";
      const col = colIndex(ref.replace(/\d+/g, ""));
      const t = c["@_t"];
      const v = t === "s" ? shared[Number(textOf(c.v))] ?? "" : t === "inlineStr" ? textOf(c.is) : textOf(c.v);
      if (v !== "") cells.set(col, v);
    }
    grid.set(Number(row["@_r"]), cells);
  }

  // The header row: the first with both a date and a pair column.
  let header: number | null = null;
  let fields = new Map<number, keyof JournalRow | "image">();
  for (const [r, cells] of [...grid].sort((a, b) => a[0] - b[0])) {
    const f = new Map<number, keyof JournalRow | "image">();
    for (const [c, v] of cells) {
      const k = fieldOf(v);
      if (k && ![...f.values()].includes(k)) f.set(c, k);
    }
    if ([...f.values()].includes("traded_at") && [...f.values()].includes("symbol")) {
      header = r;
      fields = f;
      break;
    }
  }
  if (header === null) throw new Error("no journal header (TANGGAL and PAIR) in the first sheet");
  const imageCol = [...fields].find(([, k]) => k === "image")?.[0] ?? null;

  // Chart photos placed over a row's cells.
  const photos = new Map<number, JournalImage>();
  const drawingPart = [...relsOf(files, sheetPart!).values()].find((p) => p.includes("drawings/"));
  if (drawingPart && files.get(drawingPart)) {
    const drawRels = relsOf(files, drawingPart);
    const dr = parser.parse(files.get(drawingPart)!.toString("utf8"))?.wsDr ?? {};
    for (const a of [...(dr.oneCellAnchor ?? []), ...(dr.twoCellAnchor ?? [])]) {
      const row = Number(textOf(a.from?.row)) + 1;
      const col = Number(textOf(a.from?.col));
      const embed = a.pic?.blipFill?.blip?.["@_embed"];
      const target = embed && drawRels.get(embed);
      const data = target && files.get(target);
      const ext = target?.toLowerCase().endsWith(".png") ? "png" : /\.jpe?g$/i.test(target ?? "") ? "jpeg" : null;
      if (data && ext && !photos.has(row) && (imageCol === null || Math.abs(col - imageCol) <= 1)) photos.set(row, { data, ext });
    }
  }

  const rows: ImportedRow[] = [];
  for (const [r, cells] of [...grid].sort((a, b) => a[0] - b[0])) {
    if (r <= header) continue;
    const get = (k: keyof JournalRow | "image") => {
      const col = [...fields].find(([, f]) => f === k)?.[0];
      return col === undefined ? "" : (cells.get(col) ?? "").trim();
    };
    const symbol = get("symbol").toUpperCase();
    if (!symbol) continue;
    const gradeN = Math.round(Number(get("grade")));
    const link = get("image");
    rows.push({
      traded_at: parseDate(get("traded_at")) ?? new Date().toISOString().slice(0, 10),
      symbol,
      side: parseSide(get("side")),
      quantity: positive(parseNumber(get("quantity"))),
      price: positive(parseNumber(get("price")), true),
      reason: get("reason"),
      emotion_before: get("emotion_before"),
      emotion_after: get("emotion_after"),
      grade: gradeN >= 1 && gradeN <= 5 ? gradeN : null,
      lesson: get("lesson"),
      chart_url: /^https?:\/\//i.test(link) ? link : null,
      image: photos.get(r),
    });
  }
  return rows;
}
