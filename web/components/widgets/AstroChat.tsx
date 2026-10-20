"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import type { AstroEvent } from "../../lib/astro-calendar/events";
import { respond, type Context } from "../../lib/astro-chat/answer";
import { chatEnv } from "../../lib/astro-chat/env";
import type { QuantForecast } from "../../lib/quant";
import { useWidgetSetting } from "../../store/terminal";

// The Astro Calendar's chat (offline: lib/astro-chat). A reply to one of its messages carries on
// from that message's thread (its asset, planet, topic); a message sent without replying starts a
// new one.

type Msg = { id: string; role: "user" | "bot"; text: string; ctx?: Context; replyTo?: string; suggestions?: string[] };

const newId = () => Math.random().toString(36).slice(2, 10);
const WELCOME: Msg = {
  id: "welcome",
  role: "bot",
  text: "Halo! Saya asisten offline Astro Calendar. Tanyakan jadwal langit, pengaruhnya ke harga emas/BTC/DXY, data historis, price action, atau ajak saya berdiskusi.\n**Balas** sebuah pesan saya untuk melanjutkan topiknya; pesan tanpa membalas dianggap topik baru.",
  suggestions: ["Kapan Merkurius retrograde berikutnya?", "Bagaimana emas selama Merkurius retrograde?", "Saya rasa gerhana bikin bitcoin turun", "Menurutmu astrologi berpengaruh ke harga?", "Pola musiman emas", "Apa itu support dan resistance?"],
};

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

export default function AstroChat({ events, forecast }: { events: AstroEvent[] | null; forecast?: QuantForecast }) {
  const [saved, setSaved] = useWidgetSetting<Msg[]>("chat", []);
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
    // Worked out after the question shows (some answers read decades of prices).
    setTimeout(() => {
      let bot: Msg;
      try {
        const r = respond(q, env, target?.ctx ?? {});
        bot = { id: newId(), role: "bot", text: r.text, ctx: r.ctx, suggestions: r.suggestions, replyTo: user.id };
      } catch (err) {
        bot = { id: newId(), role: "bot", text: `Maaf, terjadi kesalahan saat menghitung: ${err instanceof Error ? err.message : String(err)}` };
      }
      setSaved((prev) => [...prev, bot].slice(-80));
      setBusy(false);
    }, 20);
    setSaved((prev) => [...(prev.length ? prev : [WELCOME]), user].slice(-80));
  };

  const replying = byId(replyTo);
  const lastBot = [...messages].reverse().find((m) => m.role === "bot");

  return (
    <div className="flex-1 min-h-0 flex flex-col gap-2">
      <div className="flex items-center gap-2 text-fs-10 dim">
        <span>💬 Offline: menjawab dari data dan hitungan aplikasi ini (posisi planet, harga emas/DXY sejak 1990, BTC sejak 2011, uji dampak, prakiraan quant), tanpa AI berbayar.</span>
        <button className="term-btn ml-auto shrink-0" onClick={() => setSaved([])} title="Hapus riwayat dan mulai dari awal">
          Percakapan baru
        </button>
      </div>
      <div ref={box} className="flex-1 min-h-0 overflow-auto flex flex-col gap-2 pr-1">
        {messages.map((m) => {
          const quoted = byId(m.replyTo);
          const isUser = m.role === "user";
          return (
            <div key={m.id} className={`flex flex-col max-w-[88%] ${isUser ? "self-end items-end" : "self-start items-start"}`}>
              {isUser && quoted && quoted.role === "bot" && (
                <div className="text-fs-9 dim border-l-2 border-[#c8963c] pl-1.5 mb-0.5 max-w-full truncate" title={quoted.text}>
                  ↩ {firstLine(quoted.text)}
                </div>
              )}
              <div className={`rounded-lg px-3 py-2 leading-relaxed text-fs-11 ${isUser ? "bg-[#3b2a14] text-[#f6ead6]" : "bg-[#1a1a1a] border border-[var(--border)] text-[#d8d8d8]"}`}>
                <Rich text={m.text} />
              </div>
              {!isUser && (
                <div className="flex flex-wrap items-center gap-1 mt-1">
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
                        className="text-fs-10 px-1.5 rounded-sm border border-[#c8963c55] text-[#e0b860] hover:bg-[#c8963c22]"
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
      <div className="border border-[var(--border)] rounded-md bg-[var(--panel-2)]">
        {replying && (
          <div className="flex items-center gap-2 px-2 pt-1.5 text-fs-10">
            <span className="text-[#ff9a3c]">↩ Membalas:</span>
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
            placeholder={replying ? "Lanjutkan topik ini… (Enter kirim, Esc batal membalas)" : "Tanya hal baru… (Enter kirim). Untuk melanjutkan, klik ↩ Balas pada pesan."}
            className="flex-1 resize-none bg-transparent outline-none text-fs-11"
          />
          <button className="term-btn active shrink-0" onClick={() => send(input, replyTo)} disabled={busy || !input.trim()}>
            Kirim
          </button>
        </div>
      </div>
    </div>
  );
}
