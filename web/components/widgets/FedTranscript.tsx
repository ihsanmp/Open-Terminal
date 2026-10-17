"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiGet, fmt } from "../../lib/api";

// A Fed broadcast's live transcript and the Fed Sentiment Index (server: providers/fedtranscript.ts,
// fedsentiment.ts, fedmedia.ts), in three layers:
//   1. the words: YouTube's live captions, read every 5 seconds, scored hawkish or dovish by phrase;
//   2. the voice: the main speaker told apart from the others, their pitch, swings, pauses and
//      fillers against their own baseline (stress, hesitation);
//   3. the face: the main speaker's face locked by lip sync, its expressions (tension).
// Questions from the floor and other voices are left out of the words' index; layers 2 and 3 make
// it firmer or softer (10%).

type Side = 1 | -1;
type Stance = "hawkish" | "dovish" | "neutral";
export type TranscriptLine = {
  seq: number;
  at: number;
  text: string;
  turn: number;
  score: number;
  phrases: Array<{ phrase: string; side: Side }>;
  question: boolean;
  speaker?: number | null;
  main?: boolean | null;
  excluded?: boolean;
};
type Prosody = {
  pitchHz: number | null;
  baseHz: number | null;
  pitchZ: number;
  swings: number;
  loudZ: number;
  pausesPerMin: number;
  fillersPerMin: number;
  wordsPerMin: number | null;
  stress: number;
  hesitation: number;
};
type Media = {
  audio: "starting" | "on" | "off" | "error";
  video: "starting" | "on" | "off" | "error";
  message: string | null;
  speakers: Array<{ id: number; seconds: number; main: boolean }>;
  prosody: Prosody | null;
  face: { lockedShare: number; expressions: Record<string, number>; tension: number; frames: number; facesSeen: number } | null;
  confidence: number | null;
};
type Sentiment = {
  index: number;
  stance: Stance;
  hawkish: number;
  dovish: number;
  recent: { index: number; stance: Stance; hawkish: number; dovish: number };
  timeline: Array<{ at: number; index: number }>;
  top: Array<{ phrase: string; side: Side; count: number }>;
  questionTurns: number[];
  othersLeftOut?: number;
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
  media?: Media;
  combined?: { index: number; stance: Stance } | null;
};

export type FedTranscriptState = { videoId: string | null; lines: TranscriptLine[]; reply: Reply | null; error: string | null };

/** Polls a broadcast's transcript every 5 s, adding the new lines to what it has. */
export function useFedTranscript(videoId: string | null, faces = true, fed = true, watcher = true): FedTranscriptState {
  const [state, setState] = useState<FedTranscriptState>({ videoId: null, lines: [], reply: null, error: null });
  const facesRef = useRef(faces);
  facesRef.current = faces;
  const fedRef = useRef(fed);
  fedRef.current = fed;
  const watcherRef = useRef(watcher);
  watcherRef.current = watcher;
  useEffect(() => {
    setState({ videoId, lines: [], reply: null, error: null });
    if (!videoId) return;
    let since = 0;
    let lines: TranscriptLine[] = [];
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        // The last 40 lines again too: their voice is known only once their audio has been heard,
        // a moment after the captions.
        const from = Math.max(0, since - 40);
        const r = await apiGet<Reply>(`/api/fed/transcript/${videoId}?since=${from}${facesRef.current ? "" : "&faces=0"}${fedRef.current ? "" : "&src=link"}${watcherRef.current ? "" : "&media=0"}`);
        if (stopped) return;
        if (r.total < since) {
          // The server started over (restarted): read it all again.
          since = 0;
          lines = [];
          timer = setTimeout(tick, 0);
          return;
        }
        lines = lines.slice(0, from).concat(r.lines);
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

const pct0 = (v: number) => `${Math.round(v * 100)}%`;
const EXPRESSION: Record<string, string> = { neutral: "netral", happy: "senang", sad: "sedih", angry: "marah", fearful: "takut", disgusted: "jijik", surprised: "terkejut" };

/** The panel's switches: the mode (regular: words only; watcher: voice and face too) and the face layer. */
export type Controls = { faces: boolean; setFaces: (v: boolean) => void; watcher: boolean; setWatcher: (v: boolean) => void };

type Usage = { rssMb: number; heapMb: number; cpuPct: number; faceWorker: boolean };

/** What the server is using, every ten seconds while the panel is open. */
function UsageNote() {
  const { data } = useQuery({ queryKey: ["system-usage"], queryFn: () => apiGet<Usage>("/api/system/usage"), refetchInterval: 10_000 });
  if (!data) return null;
  return (
    <span className="dim tabular-nums" title="Pemakaian proses server OpenTerminal (CPU dalam % satu core)">
      server RAM {data.rssMb} MB · CPU {fmt(data.cpuPct, 0)}%{data.faceWorker ? " · model wajah dimuat" : ""}
    </span>
  );
}

function ModeSwitch({ c }: { c: Controls }) {
  return (
    <span className="flex gap-1" title="Reguler: teks saja, ringan. Watcher: suara & wajah juga (butuh CPU, RAM ±150 MB untuk model wajah).">
      <button className={`term-btn !py-0 ${!c.watcher ? "active" : ""}`} onClick={() => c.setWatcher(false)}>
        Reguler
      </button>
      <button className={`term-btn !py-0 ${c.watcher ? "active" : ""}`} onClick={() => c.setWatcher(true)}>
        Watcher
      </button>
    </span>
  );
}

/** Layers 2 and 3 in one line: how the main speaker sounds and looks, and the delivery's confidence. */
function Delivery({ media, c }: { media: Media; c: Controls }) {
  const { faces, setFaces } = c;
  if (!c.watcher) {
    return (
      <div className="shrink-0 border-t border-[#1c1c1c] bg-[#0b0b0b] px-2 py-1 flex items-center gap-x-3 gap-y-0.5 flex-wrap text-fs-10">
        <ModeSwitch c={c} />
        <span className="dim">Mode reguler: teks saja (lapisan suara & wajah mati, hemat CPU & RAM).</span>
        <span className="ml-auto">
          <UsageNote />
        </span>
      </div>
    );
  }
  const p = media.prosody;
  const f = media.face;
  const voices = media.speakers.filter((v) => v.seconds >= 3);
  const z = (v: number) => `${v > 0 ? "+" : ""}${fmt(v, 1)}σ`;
  return (
    <div className="shrink-0 border-t border-[#1c1c1c] bg-[#0b0b0b] px-2 py-1 flex items-center gap-x-3 gap-y-0.5 flex-wrap text-fs-10">
      <ModeSwitch c={c} />
      <span className="dim" title="Layer 2: suara pembicara utama dibanding dirinya sendiri sepanjang siaran">
        🎙 SUARA
      </span>
      {media.audio === "off" || media.audio === "error" ? (
        <span className="dim">{media.message ?? "tidak tersedia"}</span>
      ) : !p ? (
        <span className="dim">mengenali suara… {voices.length ? `(${voices.length} suara, utama ${voices.find((v) => v.main)?.seconds ?? 0} dtk)` : ""}</span>
      ) : (
        <>
          <span title={`Pitch 1 menit terakhir ${p.pitchHz} Hz vs rata-rata siaran ${p.baseHz} Hz`}>
            pitch <b className="text-[var(--text)]">{p.pitchHz} Hz</b> <span className={p.pitchZ > 1 ? "down" : "dim"}>{z(p.pitchZ)}</span>
          </span>
          <span title="Rentang naik-turun nada dibanding biasanya">ayunan {fmt(p.swings, 2)}×</span>
          <span title="Jeda ≥300 ms per menit bicara">jeda {fmt(p.pausesPerMin, 0)}/mnt</span>
          <span title="“uh”, “um” per menit bicara">filler {fmt(p.fillersPerMin, 1)}/mnt</span>
          {p.wordsPerMin !== null && <span>{p.wordsPerMin} kata/mnt</span>}
          <span className={p.stress >= 0.4 ? "down font-bold" : ""}>stres {pct0(p.stress)}</span>
          <span className={p.hesitation >= 0.4 ? "amber font-bold" : ""}>ragu {pct0(p.hesitation)}</span>
          <span className="dim" title="Suara berbeda yang terdengar; yang paling lama bicara dianggap pembicara utama">
            {voices.length} suara
          </span>
        </>
      )}
      <span className="dim" title="Layer 3: ekspresi wajah pembicara utama, dikunci lewat gerak bibir saat suaranya terdengar">
        🙂 WAJAH
      </span>
      {!faces ? (
        <span className="dim">dimatikan</span>
      ) : media.video === "off" || media.video === "error" ? (
        <span className="dim">{media.message ?? "tidak tersedia"}</span>
      ) : !f ? (
        <span className="dim">memuat model wajah…</span>
      ) : f.lockedShare === 0 ? (
        <span className="dim">wajah utama belum terkunci ({f.facesSeen} wajah terlihat)</span>
      ) : (
        <>
          <span title="Porsi frame 1 menit terakhir dengan wajah utama terkunci">terkunci {pct0(f.lockedShare)}</span>
          {Object.entries(f.expressions)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 2)
            .map(([k, v]) => (
              <span key={k}>
                {EXPRESSION[k] ?? k} {pct0(v)}
              </span>
            ))}
          <span className={f.tension >= 0.3 ? "down font-bold" : ""} title="Marah + takut + sedih + jijik">
            tegang {pct0(f.tension)}
          </span>
        </>
      )}
      <label className="dim flex items-center gap-1 cursor-pointer" title="Analisis wajah memakai CPU paling banyak">
        <input type="checkbox" checked={faces} onChange={(e) => setFaces(e.target.checked)} /> wajah
      </label>
      {media.confidence !== null && (
        <span className="ml-auto" title="Keyakinan penyampaian: 1 − (50% stres + 30% ragu + 20% tegang)">
          KEYAKINAN <b className={media.confidence >= 0.7 ? "up" : media.confidence >= 0.5 ? "amber" : "down"}>{pct0(media.confidence)}</b>
        </span>
      )}
      <span className={media.confidence !== null ? "" : "ml-auto"}>
        <UsageNote />
      </span>
    </div>
  );
}

/**
 * The index under the video: where it stands (all three layers once the voice has been heard; the
 * words alone until then), the last five minutes, how it got there, and layers 2 and 3.
 */
export function SentimentBar({ state, controls }: { state: FedTranscriptState; controls: Controls }) {
  const s = state.reply?.sentiment;
  if (!state.reply || !s) return null;
  const heard = s.hawkish + s.dovish;
  const combined = state.reply.combined ?? null;
  const shown = combined ?? { index: s.index, stance: s.stance };
  return (
    <>
      <div className="shrink-0 border-t border-[var(--border)] bg-[#0b0b0b] px-2 py-1.5 flex items-center gap-3 text-fs-11">
        <div className="shrink-0">
          <div className="dim text-fs-9" title={combined ? "Teks 90%, nada suara & wajah 10%" : "Teks saja (nada suara & wajah menyusul)"}>
            FED SENTIMENT INDEX{combined ? " · 3 LAYER" : ""}
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-fs-18 font-bold tabular-nums" style={{ color: STANCE[shown.stance].color }}>
              {signed(shown.index)}
            </span>
            <span className={`text-fs-9 px-1 rounded-sm font-bold ${STANCE[shown.stance].cls}`}>{STANCE[shown.stance].label}</span>
          </div>
        </div>
        <div className="flex-1 min-w-[120px] flex flex-col gap-1">
          <Gauge value={shown.index} />
          {/* On a phone the scale's ends shorten to −1 / +1 and the count gives way rather than overlap. */}
          <div className="flex justify-between gap-1 dim text-fs-9 whitespace-nowrap">
            <span className="shrink-0">
              −1<span className="hidden sm:inline"> dovish</span>
            </span>
            <span className="min-w-0 truncate" title={`${s.hawkish} frasa hawkish · ${s.dovish} dovish`}>
              {s.hawkish}🦅 · {s.dovish}🕊{combined ? ` · teks ${signed(s.index)}` : ""}
            </span>
            <span className="shrink-0">
              <span className="hidden sm:inline">hawkish </span>+1
            </span>
          </div>
        </div>
        <div className="shrink-0 w-[70px]" title="Indeks teks 5 menit terakhir">
          <div className="dim text-fs-9">5 MENIT</div>
          <div className="tabular-nums font-bold" style={{ color: STANCE[s.recent.stance].color }}>
            {s.recent.hawkish + s.recent.dovish ? signed(s.recent.index) : "-"}
          </div>
        </div>
        <div className="hidden sm:block w-[140px] shrink-0" title="Indeks teks di akhir tiap menit">
          {heard > 0 ? <Sparkline points={s.timeline} /> : <div className="dim text-fs-9">belum ada frasa kebijakan</div>}
        </div>
      </div>
      {state.reply.media && <Delivery media={state.reply.media} c={controls} />}
    </>
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

  // Paragraphs: one speaker turn in one voice, at most a minute each.
  const blocks: Array<{ at: number; turn: number; speaker: number | null; lines: TranscriptLine[] }> = [];
  for (const l of shown) {
    const b = blocks.at(-1);
    const speaker = l.speaker ?? null;
    if (b && b.turn === l.turn && (speaker === null || b.speaker === null || b.speaker === speaker) && l.at - b.at < 60_000) {
      b.lines.push(l);
      b.speaker ??= speaker;
    } else blocks.push({ at: l.at, turn: l.turn, speaker, lines: [l] });
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
          const other = !q && b.lines.every((l) => l.excluded);
          const off = q || other;
          const main = b.lines.find((l) => l.main !== null && l.main !== undefined)?.main;
          const score = b.lines.reduce((n, l) => n + l.score, 0);
          return (
            <div key={`${b.lines[0].seq}-${b.lines[0].at}`} className={`py-1 border-l-2 pl-2 mb-0.5 ${off ? "opacity-60 italic" : ""}`} style={{ borderColor: off ? "#555" : score > 0 ? "#ef5350" : score < 0 ? "#26a69a" : "transparent" }}>
              <div className="dim text-fs-9 tabular-nums">
                {clock(b.at)}
                {b.speaker !== null && (main ? <span className="amber"> · 🎙 pembicara utama</span> : <span> · suara {String.fromCharCode(65 + b.speaker)}</span>)}
                {q && " · pertanyaan (tidak dihitung)"}
                {other && " · suara lain (tidak dihitung)"}
                {!q && score !== 0 && <span style={{ color: score > 0 ? "#ef5350" : "#26a69a" }}> · {score > 0 ? `+${score}` : score}</span>}
              </div>
              <div className="text-[var(--text)]">
                {b.lines.map((l) => (
                  <Marked key={`${l.seq}-${l.at}-${l.text}`} line={l} dimmed={off} />
                ))}
              </div>
            </div>
          );
        })}
      </div>
      <div className="px-2 py-1 border-t border-[var(--border)] dim text-fs-9 leading-relaxed">
        Caption live YouTube (otomatis atau dari penyiar), dibaca tiap 5 detik. Indeks = (frasa hawkish − dovish) / (total + 3): frasa seperti “inflation remains elevated”, “rate cuts”, “labor market has softened”; negasi membalik arahnya. Yang tidak dihitung: giliran bicara yang diakhiri pertanyaan (bila caption menandai pergantian pembicara, &gt;&gt;) dan, setelah suara-suara dikenali, kalimat dari suara selain pembicara utama (yang paling lama bicara). Nada suara dan wajah menguatkan/melemahkan indeks 10%. Dikalibrasi pada 71 konferensi pers FOMC 2016–2026: indeksnya searah dengan keputusan suku bunga (r 0,60) dan arah yield 2Y tiga bulan berikutnya (r 0,38), tetapi tidak memprediksi reaksi pasar di hari itu (r ≈ 0). Bacaan arah, bukan sinyal trading.
      </div>
    </div>
  );
}
