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
/** A figure said about the US data, checked against the official data (server: factcheck.ts). */
type FactCheck = {
  line: number;
  /** Still open to the next words (its month, or a "goal" that drops it). */
  provisional?: boolean;
  label?: string;
  /** "%", "rb" (thousands), "jt" (millions), "T$", "poin", "$", "pp". */
  unit?: string;
  indicator: string;
  value: number;
  high?: number;
  month: string | null;
  phrase: string;
  /** null while the official data is still being read. */
  verdict: "match" | "close" | "differs" | "unverifiable" | null;
  official?: number | null;
  officialHigh?: number;
  period?: string | null;
  series?: string | null;
  source?: string | null;
  url?: string | null;
  note?: string | null;
};
/** An event said, and the outlets in the news archive that reported it (server: evidence.ts). */
type EvidenceItem = { text: string; line: number; lastLine: number; sources: Array<{ publisher: string; title: string; link: string; time: number }> };
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
  facts?: FactCheck[];
  evidence?: { checked: number; items: EvidenceItem[] };
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
const FACT_LABEL: Record<string, string> = {
  pce: "Inflasi PCE",
  core_pce: "Inflasi PCE inti",
  cpi: "Inflasi CPI",
  core_cpi: "Inflasi CPI inti",
  inflation: "Inflasi",
  unemployment: "Pengangguran",
  payrolls: "Payroll sebulan",
  payrolls_avg: "Rata-rata payroll",
  gdp: "GDP riil",
  fed_funds: "Suku bunga Fed",
};
const VERDICT: Record<NonNullable<FactCheck["verdict"]>, { text: string; color: string; title: string }> = {
  match: { text: "✓ sesuai data", color: "#26a69a", title: "Angka yang disebut sama dengan data resmi (beda pembulatan saja)" },
  close: { text: "≈ mendekati", color: "#c9a227", title: "Selisih kecil: pembulatan, revisi data, atau periode yang berdekatan" },
  differs: { text: "✗ berbeda", color: "#ef5350", title: "Berbeda dari data resmi untuk periode itu (bisa juga angka lama sebelum revisi, atau ukuran lain)" },
  unverifiable: { text: "? tak terverifikasi", color: "#888", title: "Tidak bisa dicocokkan dengan data resmi" },
};

const unitOf = (f: FactCheck) => f.unit ?? (f.indicator.startsWith("payrolls") ? "rb" : "%");
const labelOf = (f: FactCheck) => f.label ?? FACT_LABEL[f.indicator] ?? f.indicator;
const fmtFact = (f: FactCheck, v: number | null | undefined, hi?: number) => {
  if (v === null || v === undefined) return "—";
  const n = (x: number) => x.toLocaleString("id-ID", { maximumFractionDigits: 2 });
  const u = unitOf(f);
  const range = `${n(v)}${hi !== undefined ? `–${n(hi)}` : ""}`;
  return u === "$" ? `$${range}` : u === "poin" ? range : u === "pp" ? `${v > 0 ? "+" : ""}${range} pp` : `${range}${u === "%" ? "%" : ` ${u}`}`;
};
/** What was said, and the official figure (a date for "unchanged since" and "first since"). */
const saidOf = (f: FactCheck) => (unitOf(f) === "sejak" ? `sejak ${f.month ?? "—"}` : fmtFact(f, f.value, f.high));
const officialOf = (f: FactCheck) => (unitOf(f) === "sejak" ? (f.period ?? "—") : fmtFact(f, f.official, f.officialHigh));

/** A claim's verdict beside the line it was said in. */
function FactBadge({ f }: { f: FactCheck }) {
  const v = f.verdict ? VERDICT[f.verdict] : null;
  const title = `${labelOf(f)}${f.provisional ? " (sementara: kalimatnya belum selesai)" : ""}: disebut ${saidOf(f)}${
    f.verdict ? ` · data resmi ${officialOf(f)}${f.period && unitOf(f) !== "sejak" ? ` (${f.period})` : ""}${f.source ? ` · ${f.source}` : ""}${f.note ? ` · ${f.note}` : ""}` : " · mengecek data resmi…"
  }`;
  return (
    <span
      className={`text-fs-9 px-1 mx-0.5 rounded-sm border not-italic whitespace-nowrap ${f.provisional ? "border-dashed opacity-80" : ""}`}
      style={{ borderColor: v?.color ?? "#555", color: v?.color ?? "#888" }}
      title={title}
    >
      {v ? v.text : "… cek fakta"}
      {f.provisional && v && <span className="dim"> · sementara</span>}
    </span>
  );
}

/** Every claim checked so far, newest first, each with the official figure and its source. */
function FactList({ facts }: { facts: FactCheck[] }) {
  const [open, setOpen] = useState(false);
  if (!facts.length) return null;
  const count = (v: FactCheck["verdict"]) => facts.filter((f) => f.verdict === v).length;
  return (
    <div className="px-2 py-1 border-b border-[var(--border)] text-fs-10">
      <button className="dim hover:text-[var(--text)]" onClick={() => setOpen((o) => !o)} title="Angka data ekonomi AS yang disebut di siaran, dicocokkan dengan data resmi (BLS/BEA/The Fed lewat FRED)">
        {open ? "▾" : "▸"} Cek fakta {facts.length} klaim:{" "}
        <span style={{ color: VERDICT.match.color }}>{count("match")} sesuai</span> · <span style={{ color: VERDICT.close.color }}>{count("close")} mendekati</span> ·{" "}
        <span style={{ color: VERDICT.differs.color }}>{count("differs")} berbeda</span>
        {count("unverifiable") > 0 && <span> · {count("unverifiable")} tak terverifikasi</span>}
      </button>
      {open && (
        <div className="mt-1 space-y-1 max-h-48 overflow-auto">
          {[...facts].reverse().map((f) => (
            <div key={`${f.line}:${f.indicator}:${f.value}`} className="leading-snug">
              <FactBadge f={f} /> <b>{labelOf(f)}</b>: disebut {saidOf(f)}
              {f.verdict && f.verdict !== "unverifiable" && (
                <>
                  {" "}
                  · data resmi {officialOf(f)}
                  {f.period && unitOf(f) !== "sejak" && <span className="dim"> ({f.period})</span>}
                </>
              )}
              {f.note && <span className="dim"> · {f.note}</span>}
              {f.url && (
                <a href={f.url} target="_blank" rel="noreferrer" className="amber hover:underline ml-1">
                  {f.source ?? "sumber"} ↗
                </a>
              )}
              <div className="dim italic truncate" title={f.phrase}>
                “…{f.phrase.slice(-140)}”
              </div>
            </div>
          ))}
          <div className="dim text-fs-9">
            Dicocokkan otomatis, begitu angkanya terdengar (“sementara” sampai kalimatnya selesai), dengan: angka rilis pertama data AS (CPI/PCE bulanan, PPI, retail sales, payroll, pengangguran, klaim, ISM, JOLTS, ADP, sentimen Michigan), FRED (inflasi tahunan, GDP, upah, KPR, neraca dan suku bunga Fed) dan harga pasar TradingView saat diucapkan (yield, DXY, S&amp;P 500, minyak, emas, bitcoin). Proyeksi, target (mis. “2 percent objective”), perbandingan, perubahan (“turun sebesar…”) dan angka masa lalu tidak dicek. Diuji pada 72 konferensi pers FOMC 2016–2026: ±90% klaim yang terbaca memang klaim fakta; “berbeda” kebanyakan karena revisi data sesudahnya.
          </div>
        </div>
      )}
    </div>
  );
}

/** Beside the line a statement ends on: the outlets that reported it. */
function EvidenceBadge({ e }: { e: EvidenceItem }) {
  const title = `Ada pemberitaan:\n${e.sources.map((x) => `${x.publisher}: ${x.title}`).join("\n")}\n\n“${e.text}”`;
  return (
    <a href={e.sources[0]?.link} target="_blank" rel="noreferrer" className="text-fs-9 px-1 mx-0.5 rounded-sm border not-italic whitespace-nowrap hover:underline" style={{ borderColor: "#5c9ded", color: "#5c9ded" }} title={title}>
      📰 {e.sources[0]?.publisher}
      {e.sources.length > 1 && ` +${e.sources.length - 1}`}
    </a>
  );
}

/** The events said that an outlet has reported, newest first, with the headlines. */
function EvidenceList({ evidence }: { evidence: { checked: number; items: EvidenceItem[] } | undefined }) {
  const [open, setOpen] = useState(false);
  if (!evidence || !evidence.checked) return null;
  const { checked, items } = evidence;
  return (
    <div className="px-2 py-1 border-b border-[var(--border)] text-fs-10">
      <button className="dim hover:text-[var(--text)]" onClick={() => setOpen((o) => !o)} title="Peristiwa yang disebut di siaran (bukan angka), dicari di arsip berita tab News tujuh hari terakhir">
        {open ? "▾" : "▸"} Cek berita: {checked} pernyataan peristiwa dicek · <span style={{ color: "#5c9ded" }}>{items.length} ada pemberitaan</span>
        {checked > items.length && <span> · sisanya belum ditemukan di arsip</span>}
      </button>
      {open && (
        <div className="mt-1 space-y-1 max-h-48 overflow-auto">
          {[...items].reverse().map((e) => (
            <div key={`${e.line}:${e.text.slice(-40)}`} className="leading-snug">
              <div className="dim italic truncate" title={e.text}>
                “{e.text.slice(0, 160)}”
              </div>
              {e.sources.map((x) => (
                <div key={x.link + x.publisher}>
                  📰{" "}
                  <a href={x.link} target="_blank" rel="noreferrer" className="amber hover:underline">
                    {x.publisher}
                  </a>
                  : {x.title}
                </div>
              ))}
            </div>
          ))}
          <div className="dim text-fs-9">
            Pernyataan tentang peristiwa (bukan opini, rencana, pertanyaan atau angka; pada caption otomatis tanpa tanda baca, potongan ±18 kata yang saling tumpang-tindih) dicari otomatis di arsip berita aplikasi (tab News, tujuh hari terakhir), dengan pencocokan kata langka yang sama seperti tab Insider. “Ada pemberitaan” berarti outlet itu memberitakan hal yang sama, bukan bahwa isinya pasti benar; “belum ditemukan” bukan berarti salah: arsipnya mungkin tidak memuat beritanya, atau pembicara lebih dulu menyebutnya (dicari lagi selama dua jam). Disetel pada 79 pernyataan dari arsip 3–18 Okt; di uji buta terakhir (16 pernyataan, tidak dipakai menyetel): 8 dari 10 berita yang ada ditemukan, dan 0 dari 6 kasus jebakan (tempat/subjek lain dengan kata serupa) salah dicocokkan.
          </div>
        </div>
      )}
    </div>
  );
}

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
  // Each line's place in the whole transcript, which the claims refer to.
  const firstShown = state.lines.length - shown.length;
  const indexOf = new Map(shown.map((l, k) => [l, firstShown + k]));
  const factsByLine = new Map<number, FactCheck[]>();
  for (const f of r?.facts ?? []) (factsByLine.get(f.line) ?? factsByLine.set(f.line, []).get(f.line)!).push(f);
  const evidenceByLine = new Map<number, EvidenceItem[]>();
  for (const e of r?.evidence?.items ?? []) (evidenceByLine.get(e.lastLine) ?? evidenceByLine.set(e.lastLine, []).get(e.lastLine)!).push(e);

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
      <FactList facts={r?.facts ?? []} />
      <EvidenceList evidence={r?.evidence} />
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
                  <span key={`${l.seq}-${l.at}-${l.text}`}>
                    <Marked line={l} dimmed={off} />
                    {(factsByLine.get(indexOf.get(l) ?? -1) ?? []).map((f) => (
                      <FactBadge key={`${f.indicator}:${f.value}`} f={f} />
                    ))}
                    {(evidenceByLine.get(indexOf.get(l) ?? -1) ?? []).map((e) => (
                      <EvidenceBadge key={e.text.slice(-40)} e={e} />
                    ))}
                  </span>
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
