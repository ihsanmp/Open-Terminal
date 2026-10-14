"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { apiGet, fmt } from "../../lib/api";

// A Fed broadcast's live transcript and the Fed Sentiment Index (server: providers/fedtranscript.ts
// and fedsentiment.ts): YouTube's live captions, read every 5 seconds, and how hawkish or dovish
// the speaker sounds by the phrases they use. Questions from the floor are left out.

type Side = 1 | -1;
type Stance = "hawkish" | "dovish" | "neutral";
export type TranscriptLine = { seq: number; at: number; text: string; turn: number; score: number; phrases: Array<{ phrase: string; side: Side }>; question: boolean };
type Sentiment = {
  index: number;
  stance: Stance;
  hawkish: number;
  dovish: number;
  recent: { index: number; stance: Stance; hawkish: number; dovish: number };
  timeline: Array<{ at: number; index: number }>;
  top: Array<{ phrase: string; side: Side; count: number }>;
  questionTurns: number[];
};
type Reply = {
  videoId: string;
  title: string;
  status: "starting" | "live" | "offline" | "no-captions" | "error";
  error: string | null;
  lines: TranscriptLine[];
  total: number;
  catchUp: { done: number; of: number } | null;
  sentiment: Sentiment;
};

export type FedTranscriptState = { videoId: string | null; lines: TranscriptLine[]; reply: Reply | null; error: string | null };

/** Polls a broadcast's transcript every 5 s, adding the new lines to what it has. */
export function useFedTranscript(videoId: string | null): FedTranscriptState {
  const [state, setState] = useState<FedTranscriptState>({ videoId: null, lines: [], reply: null, error: null });
  useEffect(() => {
    setState({ videoId, lines: [], reply: null, error: null });
    if (!videoId) return;
    let since = 0;
    let lines: TranscriptLine[] = [];
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        const r = await apiGet<Reply>(`/api/fed/transcript/${videoId}?since=${since}`);
        if (stopped) return;
        if (r.total < since) {
          // The server started over (restarted): read it all again.
          since = 0;
          lines = [];
          timer = setTimeout(tick, 0);
          return;
        }
        lines = r.lines.length ? lines.concat(r.lines) : lines;
        since = r.total;
        setState({ videoId, lines, reply: r, error: null });
      } catch (err) {
        if (!stopped) setState((s) => ({ ...s, error: err instanceof Error ? err.message : String(err) }));
      }
      if (!stopped) timer = setTimeout(tick, 5000);
    };
    timer = setTimeout(tick, 0);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [videoId]);
  return state;
}

const STANCE: Record<Stance, { label: string; color: string; cls: string }> = {
  hawkish: { label: "🦅 HAWKISH", color: "#ef5350", cls: "bg-[#ef5350] text-black" },
  dovish: { label: "🕊 DOVISH", color: "#26a69a", cls: "bg-[#26a69a] text-black" },
  neutral: { label: "⚖ NETRAL", color: "#9e9e9e", cls: "border border-[#555] dim" },
};

const signed = (n: number) => `${n > 0 ? "+" : ""}${fmt(n, 2)}`;
const clock = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });

/** −1..+1 as a bar: dovish to the left, hawkish to the right. */
function Gauge({ value }: { value: number }) {
  const x = ((Math.max(-1, Math.min(1, value)) + 1) / 2) * 100;
  return (
    <div className="relative h-2 rounded-sm w-full" style={{ background: "linear-gradient(90deg, #26a69a, #2a2a2a 50%, #ef5350)" }}>
      <div className="absolute top-[-3px] h-[14px] w-[3px] bg-white rounded-sm" style={{ left: `calc(${x}% - 1px)` }} />
    </div>
  );
}

function Sparkline({ points }: { points: Array<{ index: number }> }) {
  if (points.length < 2) return null;
  const w = points.length - 1;
  const path = points.map((p, i) => `${i},${(1 - p.index).toFixed(3)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${w} 2`} preserveAspectRatio="none" className="w-full h-7 block" aria-label="Indeks per menit">
      <line x1="0" x2={w} y1="1" y2="1" stroke="#444" strokeWidth="0.02" vectorEffect="non-scaling-stroke" strokeDasharray="2 2" />
      <polyline points={path} fill="none" stroke="#e0e0e0" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/** The index under the video: where it stands, the last five minutes, and how it got there. */
export function SentimentBar({ state }: { state: FedTranscriptState }) {
  const s = state.reply?.sentiment;
  if (!state.reply || !s) return null;
  const heard = s.hawkish + s.dovish;
  return (
    <div className="shrink-0 border-t border-[var(--border)] bg-[#0b0b0b] px-2 py-1.5 flex items-center gap-3 text-fs-11">
      <div className="shrink-0">
        <div className="dim text-fs-9">FED SENTIMENT INDEX</div>
        <div className="flex items-center gap-1.5">
          <span className="text-fs-18 font-bold tabular-nums" style={{ color: STANCE[s.stance].color }}>
            {signed(s.index)}
          </span>
          <span className={`text-fs-9 px-1 rounded-sm font-bold ${STANCE[s.stance].cls}`}>{STANCE[s.stance].label}</span>
        </div>
      </div>
      <div className="flex-1 min-w-[120px] flex flex-col gap-1">
        <Gauge value={s.index} />
        <div className="flex justify-between dim text-fs-9">
          <span>−1 dovish</span>
          <span>
            {s.hawkish} frasa hawkish · {s.dovish} dovish
          </span>
          <span>hawkish +1</span>
        </div>
      </div>
      <div className="shrink-0 w-[70px]" title="Indeks 5 menit terakhir">
        <div className="dim text-fs-9">5 MENIT</div>
        <div className="tabular-nums font-bold" style={{ color: STANCE[s.recent.stance].color }}>
          {s.recent.hawkish + s.recent.dovish ? signed(s.recent.index) : "-"}
        </div>
      </div>
      <div className="hidden sm:block w-[140px] shrink-0" title="Indeks di akhir tiap menit">
        {heard > 0 ? <Sparkline points={s.timeline} /> : <div className="dim text-fs-9">belum ada frasa kebijakan</div>}
      </div>
    </div>
  );
}

/** A line's text with the phrases it scored on coloured. */
function Marked({ line, dimmed }: { line: TranscriptLine; dimmed: boolean }) {
  if (dimmed || !line.phrases.length) return <>{line.text} </>;
  const lower = line.text.toLowerCase().replace(/[’‘]/g, "'");
  const marks: Array<{ start: number; end: number; side: Side }> = [];
  for (const p of line.phrases) {
    // (A phrase that runs on into the next line isn't marked; the line's border still shows it.)
    const at = lower.indexOf(p.phrase);
    const end = at + p.phrase.length;
    if (at >= 0 && !marks.some((m) => at < m.end && end > m.start)) marks.push({ start: at, end, side: p.side });
  }
  marks.sort((a, b) => a.start - b.start);
  const parts: React.ReactNode[] = [];
  let i = 0;
  marks.forEach((m, k) => {
    if (m.start > i) parts.push(line.text.slice(i, m.start));
    parts.push(
      <mark key={k} className="rounded-sm px-0.5 text-black" style={{ background: m.side === 1 ? "#ef5350" : "#26a69a" }}>
        {line.text.slice(m.start, m.end)}
      </mark>,
    );
    i = m.end;
  });
  parts.push(line.text.slice(i));
  return <>{parts} </>;
}

/** The transcript, by speaker turn and minute, following the newest line unless scrolled up. */
export function TranscriptPanel({ state, live }: { state: FedTranscriptState; live: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const r = state.reply;
  const questions = new Set(r?.sentiment.questionTurns ?? []);
  const shown = state.lines.slice(-1500);

  useLayoutEffect(() => {
    if (follow.current && box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [shown.length]);

  // Paragraphs: one speaker turn, at most a minute each.
  const blocks: Array<{ at: number; turn: number; lines: TranscriptLine[] }> = [];
  for (const l of shown) {
    const b = blocks.at(-1);
    if (b && b.turn === l.turn && l.at - b.at < 60_000) b.lines.push(l);
    else blocks.push({ at: l.at, turn: l.turn, lines: [l] });
  }

  return (
    <div className="flex flex-col flex-1 min-h-0 text-fs-11">
      {r && r.sentiment.top.length > 0 && (
        <div className="px-2 py-1.5 border-b border-[var(--border)] flex flex-wrap gap-1">
          {r.sentiment.top.map((t) => (
            <span key={`${t.side}${t.phrase}`} className="text-fs-9 px-1 rounded-sm border" style={{ borderColor: t.side === 1 ? "#ef5350" : "#26a69a", color: t.side === 1 ? "#ef5350" : "#26a69a" }}>
              {t.phrase} ×{t.count}
            </span>
          ))}
        </div>
      )}
      {r?.catchUp && (
        <div className="px-2 py-1 amber text-fs-10">
          Membaca siaran dari awal… {Math.round((r.catchUp.done / Math.max(1, r.catchUp.of)) * 100)}%
        </div>
      )}
      <div
        ref={box}
        className="overflow-auto flex-1 min-h-0 px-2 py-1 leading-relaxed"
        onScroll={(e) => {
          const el = e.currentTarget;
          follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
      >
        {!state.videoId && <div className="dim py-2">Tidak ada siaran The Fed yang diputar. Transkrip dan indeks berjalan otomatis begitu ada siaran live.</div>}
        {state.videoId && !r && !state.error && <div className="dim py-2">Menghubungkan ke caption siaran…</div>}
        {state.error && <div className="down py-2">Transkrip gagal dimuat: {state.error}</div>}
        {r && shown.length === 0 && (
          <div className="dim py-2">
            {r.status === "no-captions"
              ? "Siaran ini tidak menyediakan caption live, jadi transkrip tidak tersedia."
              : r.status === "offline" || !live
                ? "Transkrip berjalan otomatis saat siaran live. Siaran ini belum/tidak sedang live."
                : r.status === "error"
                  ? `Caption siaran tidak bisa dibaca: ${r.error ?? ""}`
                  : "Menunggu caption pertama…"}
          </div>
        )}
        {blocks.map((b) => {
          const q = questions.has(b.turn);
          const score = b.lines.reduce((n, l) => n + l.score, 0);
          return (
            <div key={`${b.lines[0].seq}-${b.lines[0].at}`} className={`py-1 border-l-2 pl-2 mb-0.5 ${q ? "opacity-60 italic" : ""}`} style={{ borderColor: q ? "#555" : score > 0 ? "#ef5350" : score < 0 ? "#26a69a" : "transparent" }}>
              <div className="dim text-fs-9 tabular-nums">
                {clock(b.at)}
                {q && " · pertanyaan (tidak dihitung)"}
                {!q && score !== 0 && <span style={{ color: score > 0 ? "#ef5350" : "#26a69a" }}> · {score > 0 ? `+${score}` : score}</span>}
              </div>
              <div className="text-[var(--text)]">
                {b.lines.map((l) => (
                  <Marked key={`${l.seq}-${l.at}-${l.text}`} line={l} dimmed={q} />
                ))}
              </div>
            </div>
          );
        })}
      </div>
      <div className="px-2 py-1 border-t border-[var(--border)] dim text-fs-9 leading-relaxed">
        Caption live YouTube (otomatis atau dari penyiar), dibaca tiap 5 detik. Indeks = (frasa hawkish − dovish) / (total + 3): frasa seperti “inflation remains elevated”, “rate cuts”, “labor market has softened”; negasi membalik arahnya. Giliran bicara yang diakhiri pertanyaan (penanya) tidak dihitung bila caption menandai pergantian pembicara (&gt;&gt;). Bacaan arah, bukan sinyal trading.
      </div>
    </div>
  );
}
