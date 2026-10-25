"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import type { AstroEvent } from "../../lib/astro-calendar/events";
import { respond, type Context } from "../../lib/astro-chat/answer";
import { chatEnv } from "../../lib/astro-chat/env";
import type { QuantForecast } from "../../lib/quant";
import { apiGet, apiPost } from "../../lib/api";
import { lookAtScreen, NO_PICTURE, wantsScreen } from "../../lib/astro-chat/screen";
import { canListen, canSpeak, listen, refreshEleven, setPref, setVoiceReply, speak, stopSpeaking, useEleven, useElevenIssue, usePref, useSpeakingId, useVoiceReply, type Mood } from "../../lib/astro-chat/voice";

// The Astro Calendar's chat (offline: lib/astro-chat), in the floating bubble's panel
// (AstroChatBubble). A reply to one of its messages carries on from that message's thread (its asset,
// planet, topic); a message sent without replying starts a new one. The conversation is kept in this
// browser (localStorage), across tabs and restarts.

export type Msg = {
  id: string;
  role: "user" | "bot";
  text: string;
  ctx?: Context;
  replyTo?: string;
  suggestions?: string[];
  /** Who answered: Claude (its model, how long) or the offline engine (and why, when Claude couldn't). */
  engine?: "claude" | "offline";
  model?: string;
  ms?: number;
  note?: string;
  /** Asked with a look at the screen (lib/astro-chat/screen.ts); for an answer, whether it had the picture. */
  screen?: "picture" | "text";
  /** The mood Claude marked for reading it out (lib/astro-chat/voice.ts MOODS). */
  tone?: Mood;
};
type Engine = "online" | "offline";
const ENGINE_KEY = "ot-astro-engine";
const readEngine = (): Engine => {
  try {
    return window.localStorage.getItem(ENGINE_KEY) === "offline" ? "offline" : "online";
  } catch {
    return "online";
  }
};
/** "claude-sonnet-5-5" → "Sonnet 5.5". */
const modelName = (m?: string) => {
  const x = /claude-(\w+)-(\d+)-(\d+)/.exec(m ?? "");
  return x ? `${x[1][0].toUpperCase()}${x[1].slice(1)} ${x[2]}.${x[3]}` : m ?? "";
};

const newId = () => Math.random().toString(36).slice(2, 10);
const WELCOME: Msg = {
  id: "welcome",
  role: "bot",
  text: "Halo! Saya Asisten Astro. Tanyakan jadwal langit, pengaruhnya ke harga emas/BTC/DXY, data historis, price action, atau ajak saya berdiskusi.\n• **✦ Claude**: jawaban disusun Claude (akun Claude Anda) dari data yang dikumpulkan aplikasi dan riset Crypto-Analis.\n• **Offline**: langsung dari hitungan aplikasi, tanpa internet.\n**Balas** sebuah pesan saya untuk melanjutkan topiknya; pesan tanpa membalas dianggap topik baru.",
  suggestions: ["Kapan Merkurius retrograde berikutnya?", "Bagaimana emas selama Merkurius retrograde?", "Saya rasa gerhana bikin bitcoin turun", "Menurutmu astrologi berpengaruh ke harga?", "Pola musiman emas", "Apa itu support dan resistance?"],
};

const STORE = "ot-astro-chat";
function readSaved(): Msg[] {
  try {
    const v = JSON.parse(window.localStorage.getItem(STORE) ?? "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

/** The conversation, kept in localStorage (best effort: a private window just starts afresh). */
export function useChatHistory(): [Msg[], (f: (prev: Msg[]) => Msg[]) => void, () => void] {
  const [msgs, setMsgs] = useState<Msg[]>(readSaved);
  const update = (f: (prev: Msg[]) => Msg[]) =>
    setMsgs((prev) => {
      const next = f(prev).slice(-80);
      try {
        window.localStorage.setItem(STORE, JSON.stringify(next));
      } catch {
        // Full or blocked: kept for this session only.
      }
      return next;
    });
  return [msgs, update, () => update(() => [])];
}

/** **bold** and "•" lines, the only markup the answers use. */
function Rich({ text }: { text: string }) {
  return (
    <>
      {text.split("\n").map((line, i) => (
        <div key={i} className={line.startsWith("• ") ? "pl-3 -indent-3" : line === "" ? "h-2" : ""}>
          {line.split(/(\*\*[^*]+\*\*)/g).map((part, k) =>
            part.startsWith("**") && part.endsWith("**") ? (
              <b key={k} className="text-[var(--text)]">
                {part.slice(2, -2)}
              </b>
            ) : (
              <Fragment key={k}>{part}</Fragment>
            ),
          )}
        </div>
      ))}
    </>
  );
}

const firstLine = (t: string) => t.replace(/\*\*/g, "").split("\n")[0].slice(0, 90);

export default function AstroChat({ events, forecast, history }: { events: AstroEvent[] | null; forecast?: QuantForecast; history: ReturnType<typeof useChatHistory> }) {
  const [saved, update] = history;
  const messages = saved.length ? saved : [WELCOME];
  const [input, setInput] = useState("");
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // The ✦ Claude menu's switches, all online: 👁 a look at the screen with every question (without
  // it, only when a question is about the screen), 🎤 the microphone button, 🔊 answers read out.
  const screenAlways = usePref("astroScreenAlways", false);
  const micOn = usePref("astroMic", true);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: MouseEvent) => !menuRef.current?.contains(e.target as Node) && setMenuOpen(false);
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [menuOpen]);
  const [looking, setLooking] = useState(false);
  // Voice: answers read out (🔊), questions said (🎤).
  const voiceReply = useVoiceReply();
  const speakingId = useSpeakingId();
  const [listening, setListening] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const stopListening = useRef<(() => void) | null>(null);
  const [hasVoice, setHasVoice] = useState({ speak: false, listen: false });
  useEffect(() => setHasVoice({ speak: canSpeak(), listen: canListen() }), []);
  // Whether the assistant's own ElevenLabs voice is set up; why it last fell back to Gadis.
  useEffect(() => void refreshEleven(), []);
  const elevenIssue = useElevenIssue();
  const box = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const env = useMemo(() => chatEnv(events, forecast), [events, forecast]);
  const [engine, setEngineState] = useState<Engine>(readEngine);
  const setEngine = (e: Engine) => {
    setEngineState(e);
    try {
      window.localStorage.setItem(ENGINE_KEY, e);
    } catch {
      // Kept for this session only.
    }
  };
  // Whether Claude Code is installed on this machine (the server asks it).
  const [claude, setClaude] = useState<{ ok: boolean; version: string | null } | null>(null);
  useEffect(() => {
    apiGet<{ claude: boolean; version: string | null }>("/api/astro-chat/status")
      .then((s) => setClaude({ ok: s.claude, version: s.version }))
      .catch(() => setClaude({ ok: false, version: null }));
  }, []);
  const online = engine === "online" && claude?.ok !== false;

  useEffect(() => {
    box.current?.scrollTo({ top: box.current.scrollHeight });
  }, [messages.length]);

  const byId = (id: string | null | undefined) => (id ? messages.find((m) => m.id === id) : undefined);

  const threadOf = (target: Msg | undefined) => {
    const out: Array<{ role: "user" | "assistant"; text: string }> = [];
    let m = target;
    while (m && out.length < 8) {
      if (m.id !== "welcome") out.unshift({ role: m.role === "user" ? "user" : "assistant", text: m.text });
      m = byId(m.replyTo);
    }
    return out;
  };

  const send = (text: string, reply: string | null, spoken = false) => {
    const q = text.trim();
    if (!q || busy) return;
    const target = byId(reply);
    const thread = threadOf(target);
    const withScreen = online && (screenAlways || wantsScreen(q));
    const user: Msg = { id: newId(), role: "user", text: q, replyTo: target?.id, screen: withScreen ? "picture" : undefined };
    setBusy(true);
    setInput("");
    setReplyTo(null);
    update((prev) => [...(prev.length ? prev : [WELCOME]), user]);
    // The offline answer first (after the question shows: some read decades of prices). Online, it
    // goes to Claude as the app's own numbers, with the thread replied to; if Claude can't answer,
    // it's shown itself.
    setTimeout(async () => {
      let r: ReturnType<typeof respond> | null = null;
      try {
        r = respond(q, env, target?.ctx ?? {});
      } catch {
        r = null;
      }
      const offlineMsg = (note?: string): Msg =>
        r
          ? { id: newId(), role: "bot", text: r.text, ctx: r.ctx, suggestions: r.suggestions, replyTo: user.id, engine: "offline", note }
          : { id: newId(), role: "bot", text: "Maaf, terjadi kesalahan saat menghitung.", replyTo: user.id, engine: "offline", note };
      let bot: Msg;
      if (online) {
        try {
          setLooking(withScreen);
          const screen = withScreen ? await lookAtScreen() : null;
          setLooking(false);
          const c = await apiPost<{ text: string; model: string; ms: number; tone?: Mood }>("/api/astro-chat", { question: q, thread, offline: r?.text ?? "", screen, spoken: voiceReply || spoken });
          bot = {
            id: newId(),
            role: "bot",
            text: c.text,
            ctx: r?.ctx,
            suggestions: r?.suggestions,
            replyTo: user.id,
            engine: "claude",
            model: c.model,
            tone: c.tone,
            ms: c.ms,
            screen: screen ? (screen.shot ? "picture" : "text") : undefined,
            note: screen && !screen.shot ? NO_PICTURE[screen.reason] ?? NO_PICTURE.failed : undefined,
          };
        } catch (err) {
          bot = offlineMsg(`Claude tidak menjawab (${err instanceof Error ? err.message : String(err)}); ini jawaban offline.`);
        }
      } else bot = offlineMsg();
      update((prev) => [...prev, bot]);
      setBusy(false);
      // Read out when answers are (🔊), and always when the question was said.
      if (online && (voiceReply || spoken)) speak(bot.text, bot.id, bot.tone);
    }, 20);
  };

  const replying = byId(replyTo);

  /** 🎤: what's said goes in the box as it's heard, and is sent when the speaker stops. */
  const mic = () => {
    if (listening) {
      stopListening.current?.();
      return;
    }
    setVoiceError(null);
    setListening(true);
    const target = replyTo;
    stopListening.current = listen({
      onText: (t) => setInput(t),
      onDone: (t) => {
        setListening(false);
        stopListening.current = null;
        if (t) send(t, target, true);
      },
      onError: (m) => {
        setListening(false);
        stopListening.current = null;
        setVoiceError(m);
      },
    });
  };
  const lastBot = [...messages].reverse().find((m) => m.role === "bot");

  return (
    <div className="flex-1 min-h-0 flex flex-col gap-2">
      <div className="flex items-center gap-1 px-2 pt-1.5 text-fs-10">
        <div ref={menuRef} className="relative shrink-0">
          <button
            className={`px-2 py-0.5 rounded-full border whitespace-nowrap ${online ? "border-[#9b87f5] text-[#c9b8ff] bg-[#9b87f51a]" : "border-[var(--border)] dim"}`}
            onClick={() => {
              if (!online) setEngine("online");
              setMenuOpen((o) => !o);
            }}
            disabled={claude?.ok === false}
            aria-expanded={menuOpen}
            title={claude?.ok === false ? "Claude Code CLI tidak ditemukan di komputer ini" : "Jawaban disusun Claude (akun Claude Anda, lewat Claude Code), dengan data dan hitungan aplikasi. Klik untuk fitur online: suara dan layar."}
          >
            ✦ Claude{claude?.ok === false ? " (tidak tersedia)" : ""}
            {online && (
              <span className="ml-1">
                {voiceReply && hasVoice.speak ? "🔊" : ""}
                {micOn && hasVoice.listen ? "🎤" : ""}
                {screenAlways ? "👁" : ""}
              </span>
            )}
            <span className="ml-1 dim">▾</span>
          </button>
          {menuOpen && online && (
            <div className="absolute left-0 top-full mt-1 z-20 w-[250px] bg-[#1a1a1a] border border-[var(--border)] rounded-lg shadow-xl p-1.5 text-fs-11 flex flex-col gap-0.5">
              <div className="dim text-fs-9 uppercase tracking-wider px-1.5 pb-0.5">Fitur online</div>
              {(
                [
                  ["🔊 Jawab dengan suara", "Setiap jawaban dibacakan (suara perempuan, layanan online Microsoft lewat Edge). Pertanyaan lewat 🎤 selalu dijawab dengan suara.", voiceReply, (on: boolean) => setVoiceReply(on), hasVoice.speak],
                  ["🎤 Tanya dengan suara", "Tombol mikrofon di kotak pesan: bicara, lalu terkirim saat Anda berhenti (pengenalan suara online).", micOn, (on: boolean) => setPref("astroMic", on), hasVoice.listen],
                  ["👁 Lihat layar setiap bertanya", "Claude melihat tangkapan jendela aplikasi, teks yang tampil, dan keadaan chart di setiap pertanyaan. Tanpa ini: hanya saat pertanyaan menyebut layar/chart.", screenAlways, (on: boolean) => setPref("astroScreenAlways", on), true],
                ] as const
              ).map(([label, help, on, set, available]) => (
                <label key={label} className={`flex items-start gap-2 px-1.5 py-1 rounded ${available ? "cursor-pointer hover:bg-[#262626]" : "opacity-40"}`} title={help}>
                  <input type="checkbox" className="mt-0.5" checked={available && on} disabled={!available} onChange={(e) => set(e.target.checked)} />
                  <span>
                    <span className="text-[var(--text)]">{label}</span>
                    <span className="block dim text-fs-9 leading-snug">{available ? help : "Tidak didukung browser ini (buka lewat Edge atau Chrome)."}</span>
                  </span>
                </label>
              ))}
              {hasVoice.speak && <ElevenSettings />}
            </div>
          )}
        </div>
        <button
          className={`px-2 py-0.5 rounded-full border whitespace-nowrap shrink-0 ${!online ? "border-[#c8963c] text-[#e0b860] bg-[#c8963c1a]" : "border-[var(--border)] dim"}`}
          onClick={() => setEngine("offline")}
          title="Tanpa internet: jawaban langsung dari hitungan aplikasi"
        >
          Offline
        </button>
        <span className="ml-auto dim truncate">{online ? "online · data dikumpulkan aplikasi" : "hitungan aplikasi saja"}</span>
      </div>
      <div ref={box} className="flex-1 min-h-0 overflow-auto flex flex-col gap-2 px-2 pt-2">
        {messages.map((m) => {
          const quoted = byId(m.replyTo);
          const isUser = m.role === "user";
          return (
            <div key={m.id} className={`flex flex-col max-w-[92%] ${isUser ? "self-end items-end" : "self-start items-start"}`}>
              {isUser && quoted && quoted.role === "bot" && (
                <div className="text-fs-9 dim border-l-2 border-[#c8963c] pl-1.5 mb-0.5 max-w-full truncate" title={quoted.text}>
                  ↩ {firstLine(quoted.text)}
                </div>
              )}
              <div className={`rounded-xl px-3 py-2 leading-relaxed text-fs-11 ${isUser ? "bg-[#3b2a14] text-[#f6ead6]" : "bg-[#1a1a1a] border border-[var(--border)] text-[#d8d8d8]"}`}>
                <Rich text={m.text} />
              </div>
              {isUser && m.screen && <div className="text-fs-9 dim mt-0.5">👁 dengan layar</div>}
              {!isUser && m.id !== "welcome" && (m.engine || m.note) && (
                <div className="text-fs-9 dim mt-0.5">
                  {m.engine === "claude" ? `✦ Claude ${modelName(m.model)}${m.ms ? ` · ${Math.round(m.ms / 1000)} dtk` : ""}` : "offline"}
                  {m.screen === "picture" && <span title="Jawaban ini melihat tangkapan jendela aplikasi, teks yang tampil, dan keadaan chart"> · 👁 melihat layar</span>}
                  {m.note && <span className="text-[#e0a050]"> · {m.note}</span>}
                </div>
              )}
              {!isUser && (
                <div className={`mt-1 ${m.id === "welcome" ? "flex flex-col items-start gap-1" : "flex flex-wrap items-center gap-1"}`}>
                  {hasVoice.speak && (
                    <button
                      className={`text-fs-10 px-1.5 rounded-sm border ${speakingId === m.id ? "border-[#4fc3f7] text-[#8fd8ff]" : "border-[var(--border)] dim hover:text-[var(--text)]"}`}
                      onClick={() => (speakingId === m.id ? stopSpeaking() : speak(m.text, m.id, m.tone))}
                      title={speakingId === m.id ? "Hentikan" : "Dengarkan jawaban ini"}
                    >
                      {speakingId === m.id ? "■ Berhenti" : "🔊 Dengar"}
                    </button>
                  )}
                  {m.id !== "welcome" && (
                    <button
                      className={`text-fs-10 px-1.5 rounded-sm border ${replyTo === m.id ? "border-[#ff9a3c] text-[#ff9a3c]" : "border-[var(--border)] dim hover:text-[var(--text)]"}`}
                      onClick={() => {
                        setReplyTo(replyTo === m.id ? null : m.id);
                        field.current?.focus();
                      }}
                      title="Balas pesan ini: pertanyaan berikutnya melanjutkan topiknya"
                    >
                      ↩ Balas
                    </button>
                  )}
                  {m === lastBot &&
                    m.suggestions?.map((s) => (
                      <button
                        key={s}
                        className={
                          m.id === "welcome"
                            ? "text-fs-11 px-2.5 py-1.5 rounded-lg bg-[#f0c040] border border-[#f0c040] text-[#1a1200] font-semibold hover:bg-[#ffd25a] text-left"
                            : "text-fs-10 px-1.5 rounded-sm bg-[#f0c04026] border border-[#f0c04099] text-[#f0c040] hover:bg-[#f0c04040]"
                        }
                        // A suggestion follows from this message: sent as a reply to it.
                        onClick={() => send(s, m.id === "welcome" ? null : m.id)}
                        title={m.id === "welcome" ? s : "Dikirim sebagai balasan pesan ini"}
                      >
                        {s}
                      </button>
                    ))}
                </div>
              )}
            </div>
          );
        })}
        {busy && (
          <div className="self-start dim text-fs-10">
            {looking ? "👁 Melihat layar…" : online ? "✦ Claude sedang menyusun jawaban… (biasanya 10–40 detik)" : "Menghitung…"}
          </div>
        )}
      </div>
      <div className="border border-[var(--border)] rounded-xl bg-[var(--panel-2)] mx-2 mb-2">
        {replying && (
          <div className="flex items-center gap-2 px-2.5 pt-1.5 text-fs-10">
            <span className="text-[#ff9a3c] shrink-0">↩ Membalas:</span>
            <span className="dim truncate flex-1" title={replying.text}>
              {firstLine(replying.text)}
            </span>
            <button className="dim hover:text-[var(--text)]" onClick={() => setReplyTo(null)} title="Batal membalas: pesan berikutnya jadi topik baru" aria-label="Batal membalas">
              ✕
            </button>
          </div>
        )}
        {elevenIssue && voiceReply && (
          <div className="px-2.5 pt-1.5 text-fs-10 text-[#e0a050]">{elevenIssue}</div>
        )}
        {voiceError && (
          <div className="flex items-center gap-2 px-2.5 pt-1.5 text-fs-10 text-[#e0a050]">
            <span className="flex-1">{voiceError}</span>
            <button className="dim hover:text-[var(--text)]" onClick={() => setVoiceError(null)} aria-label="Tutup">
              ✕
            </button>
          </div>
        )}
        <div className="flex items-end gap-2 p-1.5">
          <textarea
            ref={field}
            value={input}
            rows={2}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send(input, replyTo);
              }
              if (e.key === "Escape") setReplyTo(null);
            }}
            placeholder={listening ? "Mendengarkan… silakan bicara" : replying ? "Lanjutkan topik ini… (Esc batal membalas)" : "Tanya hal baru… (↩ Balas untuk melanjutkan)"}
            className="flex-1 resize-none bg-transparent outline-none text-fs-11 px-1"
          />
          {online && micOn && hasVoice.listen && (
            <button
              className={`term-btn shrink-0 ${listening ? "!border-[var(--down)] !text-[var(--down)] animate-pulse" : ""}`}
              onClick={mic}
              disabled={busy && !listening}
              title={listening ? "Sedang mendengarkan… klik untuk berhenti" : "Tanya dengan suara (Bahasa Indonesia); dikirim saat Anda berhenti bicara, dan dijawab dengan suara"}
              aria-pressed={listening}
            >
              {listening ? "■ 🎤" : "🎤"}
            </button>
          )}
          <button className="term-btn active shrink-0" onClick={() => send(input, replyTo)} disabled={busy || !input.trim()}>
            Kirim
          </button>
        </div>
      </div>
    </div>
  );
}

/** The ✦ Claude menu's ElevenLabs part: the switch, the key (kept on the server, never shown) and the voice. */
function ElevenSettings() {
  const el = useEleven();
  const on = usePref("astroEleven", true);
  const [key, setKey] = useState("");
  const [voiceId, setVoiceId] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const save = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await apiPost<{ name: string; voiceId: string }>("/api/astro-voice", { key: key.trim() || undefined, voiceId: voiceId.trim() || el?.voiceId });
      setKey("");
      setVoiceId("");
      setMsg({ ok: true, text: `Tersimpan: suara "${r.name}".` });
      await refreshEleven();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };
  const forget = async () => {
    await fetch("/api/astro-voice/key", { method: "DELETE" });
    setMsg({ ok: true, text: "API key dihapus dari komputer ini." });
    await refreshEleven();
  };
  return (
    <div className="border-t border-[var(--border)] mt-1 pt-1.5 px-1.5 flex flex-col gap-1">
      <label className={`flex items-start gap-2 py-0.5 ${el?.configured ? "cursor-pointer" : "opacity-60"}`}>
        <input type="checkbox" className="mt-0.5" checked={Boolean(el?.configured) && on} disabled={!el?.configured} onChange={(e) => setPref("astroEleven", e.target.checked)} />
        <span>
          <span className="text-[var(--text)]">🎙 Suara sendiri (ElevenLabs)</span>
          <span className="block dim text-fs-9 leading-snug">
            {el?.configured ? `Aktif · voice ${el.voiceId} · ${el.model}. Kalau gagal (kuota habis, offline), dibacakan Gadis.` : "Belum terpasang: tempel API key ElevenLabs di bawah."}
          </span>
        </span>
      </label>
      {!el?.fromEnv && (
        <input
          type="password"
          autoComplete="off"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder={el?.configured ? "API key baru (kosongkan bila tetap)" : "API key ElevenLabs (sk_…)"}
          className="w-full text-fs-10 !py-0.5"
        />
      )}
      <input value={voiceId} onChange={(e) => setVoiceId(e.target.value)} placeholder={`Voice ID (${el?.voiceId ?? "…"})`} spellCheck={false} className="w-full text-fs-10 !py-0.5" />
      <div className="flex flex-wrap gap-1">
        <button className="term-btn !text-fs-10" disabled={busy || (!key.trim() && !voiceId.trim())} onClick={save}>
          {busy ? "Memeriksa…" : "Simpan"}
        </button>
        {el?.configured && (
          <button className="term-btn !text-fs-10" onClick={() => speak("Hai! Aku di sini, siap nemenin kamu lihat chart hari ini. Mau mulai dari mana?", null, "antusias")}>
            ▶ Coba suara
          </button>
        )}
        {el?.configured && !el.fromEnv && (
          <button className="term-btn !text-fs-10" onClick={forget} title="Hapus API key dari komputer ini">
            Hapus key
          </button>
        )}
      </div>
      {msg && <div className={`text-fs-9 ${msg.ok ? "up" : "down"}`}>{msg.text}</div>}
      <div className="dim text-fs-9 leading-snug">Key disimpan di server aplikasi di komputer ini, tidak ditampilkan lagi. Setiap jawaban yang dibacakan memakai kuota karakter ElevenLabs.</div>
    </div>
  );
}
