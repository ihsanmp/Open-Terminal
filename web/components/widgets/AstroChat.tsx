"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import type { AstroEvent } from "../../lib/astro-calendar/events";
import { respond, type Context } from "../../lib/astro-chat/answer";
import { chatEnv } from "../../lib/astro-chat/env";
import type { QuantForecast } from "../../lib/quant";

// The Astro Calendar's chat (offline: lib/astro-chat), in the floating bubble's panel
// (AstroChatBubble). A reply to one of its messages carries on from that message's thread (its asset,
// planet, topic); a message sent without replying starts a new one. The conversation is kept in this
// browser (localStorage), across tabs and restarts.

export type Msg = { id: string; role: "user" | "bot"; text: string; ctx?: Context; replyTo?: string; suggestions?: string[] };

const newId = () => Math.random().toString(36).slice(2, 10);
const WELCOME: Msg = {
  id: "welcome",
  role: "bot",
  text: "Halo! Saya asisten offline Astro Calendar. Tanyakan jadwal langit, pengaruhnya ke harga emas/BTC/DXY, data historis, price action, atau ajak saya berdiskusi.\n**Balas** sebuah pesan saya untuk melanjutkan topiknya; pesan tanpa membalas dianggap topik baru.",
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
  const box = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const env = useMemo(() => chatEnv(events, forecast), [events, forecast]);

  useEffect(() => {
    box.current?.scrollTo({ top: box.current.scrollHeight });
  }, [messages.length]);

  const byId = (id: string | null | undefined) => (id ? messages.find((m) => m.id === id) : undefined);

  const send = (text: string, reply: string | null) => {
    const q = text.trim();
    if (!q || busy) return;
    const target = byId(reply);
    const user: Msg = { id: newId(), role: "user", text: q, replyTo: target?.id };
    setBusy(true);
    setInput("");
    setReplyTo(null);
    update((prev) => [...(prev.length ? prev : [WELCOME]), user]);
    // Worked out after the question shows (some answers read decades of prices).
    setTimeout(() => {
      let bot: Msg;
      try {
        const r = respond(q, env, target?.ctx ?? {});
        bot = { id: newId(), role: "bot", text: r.text, ctx: r.ctx, suggestions: r.suggestions, replyTo: user.id };
      } catch (err) {
        bot = { id: newId(), role: "bot", text: `Maaf, terjadi kesalahan saat menghitung: ${err instanceof Error ? err.message : String(err)}` };
      }
      update((prev) => [...prev, bot]);
      setBusy(false);
    }, 20);
  };

  const replying = byId(replyTo);
  const lastBot = [...messages].reverse().find((m) => m.role === "bot");

  return (
    <div className="flex-1 min-h-0 flex flex-col gap-2">
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
              {!isUser && (
                <div className={`mt-1 ${m.id === "welcome" ? "flex flex-col items-start gap-1" : "flex flex-wrap items-center gap-1"}`}>
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
                            ? "text-fs-11 px-2.5 py-1.5 rounded-lg bg-[#1f1f1f] border border-[var(--border)] text-[#e6e6e6] hover:border-[#c8963c] text-left"
                            : "text-fs-10 px-1.5 rounded-sm border border-[#c8963c55] text-[#e0b860] hover:bg-[#c8963c22]"
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
        {busy && <div className="self-start dim text-fs-10">Menghitung…</div>}
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
            placeholder={replying ? "Lanjutkan topik ini… (Esc batal membalas)" : "Tanya hal baru… (↩ Balas untuk melanjutkan)"}
            className="flex-1 resize-none bg-transparent outline-none text-fs-11 px-1"
          />
          <button className="term-btn active shrink-0" onClick={() => send(input, replyTo)} disabled={busy || !input.trim()}>
            Kirim
          </button>
        </div>
      </div>
    </div>
  );
}
