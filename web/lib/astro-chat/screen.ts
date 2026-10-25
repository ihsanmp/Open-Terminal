"use client";

// The Astro chat looking at the screen: when a question is about what's shown ("lihat layar",
// "chart ini", "apa yang kamu lihat"), or the 👁 button is on, the question goes with a picture of
// the app's window (taken by the server: server/src/astrochat/screen.ts), the text the page shows,
// and the chart's state as the app keeps it (symbol, interval, currency, indicators). The chat's
// own panel is hidden for that moment, so the picture shows the app under it.

import { apiPost } from "../api";
import { INDICATOR_BY_ID } from "../ta";
import { DEFAULT_CHART_INDICATORS, useTerminal } from "../../store/terminal";

/** Whether a question asks to look at the screen. */
export function wantsScreen(question: string): boolean {
  const q = question.toLowerCase();
  return (
    /\b(layar|screen|screenshot|tangkapan layar|tampilan(nya)?|ditampilkan|tampil(kan)? di)\b/.test(q) ||
    /\b(lihat|liat|cek|perhatikan|baca|analisa|analisis|bahas|jelaskan)\b.{0,25}\b(chart|grafik|halaman|tabel|ini)\b/.test(q) ||
    /\b(chart|grafik|halaman|tabel|indikator|pola|gambar) (ini|itu|saya|sekarang|yang (saya )?buka)\b/.test(q) ||
    /\bapa yang (kamu|anda|kau|km) (lihat|liat)\b/.test(q)
  );
}

export type ScreenPayload = { title: string; text: string; chart: string; shot: string | null; reason: string };

const MAX_TEXT = 12_000;

/** The page's visible text (what isn't shown, the chat's own panel included, isn't in innerText). */
function visibleText(): string {
  const raw = document.body.innerText ?? "";
  return raw
    .split("\n")
    .map((l) => l.replace(/[ \t]+/g, " ").trim())
    .filter((l, i, all) => l || (i > 0 && all[i - 1]))
    .join("\n")
    .slice(0, MAX_TEXT);
}

/** The chart as the app keeps it: what a picture can't tell for sure (full indicator names, settings). */
export function chartState(): string {
  const st = useTerminal.getState();
  const chart = st.pages.find((p) => p.type === "chart");
  const symbol = chart && !chart.linked && chart.symbol ? chart.symbol : st.activeSymbol;
  const settings = (chart?.settings ?? {}) as Record<string, unknown>;
  const indicators = (chart?.indicators ?? DEFAULT_CHART_INDICATORS)
    .filter((i) => !i.hidden && INDICATOR_BY_ID.has(i.id))
    .map((i) => {
      const def = INDICATOR_BY_ID.get(i.id)!;
      const params = Object.entries(i.params ?? {})
        .filter(([, v]) => typeof v !== "object")
        .map(([k, v]) => `${k}=${v}`)
        .join(", ");
      return `• ${def.name}${params ? ` (${params})` : ""}`;
    });
  const drawings = ((settings.drawings as Record<string, unknown[]> | undefined)?.[symbol] ?? []).length;
  return [
    `Halaman yang dibuka: ${st.view}`,
    `Simbol chart: ${symbol}`,
    `Interval: ${chart?.chartInterval ?? "1D"}`,
    settings.currency ? `Mata uang yang ditampilkan: ${settings.currency} (dikonversi dari mata uang asli simbol)` : "",
    `Tipe chart: ${(settings.chartType as string | undefined) ?? "candles"}`,
    `Indikator di chart:\n${indicators.join("\n") || "(tidak ada)"}`,
    `Gambar/garis buatan pengguna di chart ini: ${drawings}`,
  ]
    .filter(Boolean)
    .join("\n");
}

const frame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

/** Looks at the screen: the chat hidden, the text read, the window pictured, the chat back. */
export async function lookAtScreen(): Promise<ScreenPayload> {
  const root = document.documentElement;
  root.classList.add("ot-capturing");
  try {
    // Two frames: the hidden panel is off the screen before the picture is taken.
    await frame();
    await frame();
    const title = document.title;
    const text = visibleText();
    const chart = chartState();
    let shot: string | null = null;
    let reason = "failed";
    try {
      const r = await apiPost<{ id: string | null; reason: string }>("/api/astro-chat/screen", { title });
      shot = r.id;
      reason = r.reason;
    } catch {
      // the text and the chart's state still go
    }
    return { title, text, chart, shot, reason };
  } finally {
    root.classList.remove("ot-capturing");
  }
}

/** Why the picture is missing, for the reply's note. */
export const NO_PICTURE: Record<string, string> = {
  none: "jendela aplikasi tidak ditemukan; Claude membaca teks layar saja",
  minimized: "jendela aplikasi diminimalkan; Claude membaca teks layar saja",
  unsupported: "gambar layar hanya ada di Windows; Claude membaca teks layar saja",
  failed: "gambar layar gagal diambil; Claude membaca teks layar saja",
};
