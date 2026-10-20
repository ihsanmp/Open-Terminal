"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";

// The Astro chat as a small floating bubble over every page: dragged anywhere (kept where it's
// left), clicked open into a compact portrait panel beside it, on the side with room, so the data
// underneath stays in sight. The panel moves by its header too. What it shows (the chat, the
// planets, the prices) is loaded the first time it opens.

const ChatPanel = dynamic(() => import("./AstroChatPanel"), { ssr: false, loading: () => <div className="p-3 dim text-fs-11">Memuat asisten…</div> });

type Pos = { x: number; y: number };
const SIZE = 52;
const MARGIN = 8;
const BUBBLE_KEY = "ot-astro-bubble";

const read = (key: string): Pos | null => {
  try {
    const v = JSON.parse(window.localStorage.getItem(key) ?? "null");
    return v && Number.isFinite(v.x) && Number.isFinite(v.y) ? v : null;
  } catch {
    return null;
  }
};
const write = (key: string, p: Pos) => {
  try {
    window.localStorage.setItem(key, JSON.stringify(p));
  } catch {
    // Not kept: it goes back to its corner next time.
  }
};
const clamp = (p: Pos, w: number, h: number): Pos => ({
  x: Math.min(Math.max(MARGIN, p.x), window.innerWidth - w - MARGIN),
  y: Math.min(Math.max(MARGIN, p.y), window.innerHeight - h - MARGIN),
});

/** The panel's size: portrait, and never more than the window leaves room for. */
const panelSize = () => ({ w: Math.min(360, window.innerWidth - 2 * MARGIN), h: Math.min(560, window.innerHeight - 2 * MARGIN) });

/** Where the panel opens: beside the bubble on the side with more room, its bottom level with the bubble's. */
function panelBeside(b: Pos): Pos {
  const { w, h } = panelSize();
  const right = b.x + SIZE / 2 > window.innerWidth / 2;
  const x = right ? b.x - w - MARGIN : b.x + SIZE + MARGIN;
  return clamp({ x, y: b.y + SIZE - h }, w, h);
}

function Face() {
  // A gold rounded diamond with a smile.
  return (
    <svg viewBox="0 0 52 52" width={SIZE} height={SIZE} aria-hidden>
      <defs>
        <radialGradient id="astro-gold" cx="35%" cy="30%" r="80%">
          <stop offset="0%" stopColor="#ffe9a3" />
          <stop offset="55%" stopColor="#f1c14b" />
          <stop offset="100%" stopColor="#c48a1c" />
        </radialGradient>
      </defs>
      <rect x="10" y="10" width="32" height="32" rx="8" transform="rotate(45 26 26)" fill="url(#astro-gold)" stroke="#fff2c4" strokeOpacity="0.5" />
      <circle cx="21" cy="24" r="2" fill="#3a2600" />
      <circle cx="31" cy="24" r="2" fill="#3a2600" />
      <path d="M20.5 29 Q26 33.5 31.5 29" stroke="#3a2600" strokeWidth="2" fill="none" strokeLinecap="round" />
    </svg>
  );
}

export default function AstroChatBubble() {
  const [bubble, setBubble] = useState<Pos>(() => clamp(read(BUBBLE_KEY) ?? { x: window.innerWidth - SIZE - 24, y: window.innerHeight - SIZE - 96 }, SIZE, SIZE));
  const [open, setOpen] = useState(false);
  const [panel, setPanel] = useState<Pos | null>(null);
  const [loaded, setLoaded] = useState(false);
  const drag = useRef<{ kind: "bubble" | "panel"; start: Pos; at: Pos; moved: boolean } | null>(null);

  // A smaller window keeps both on screen.
  useEffect(() => {
    const onResize = () => {
      setBubble((b) => clamp(b, SIZE, SIZE));
      setPanel((p) => (p ? clamp(p, panelSize().w, panelSize().h) : p));
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const toggle = useCallback(() => {
    setOpen((o) => {
      if (!o) {
        setPanel(panelBeside(bubble));
        setLoaded(true);
      }
      return !o;
    });
  }, [bubble]);

  const down = (kind: "bubble" | "panel") => (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { kind, start: { x: e.clientX, y: e.clientY }, at: kind === "bubble" ? bubble : panel!, moved: false };
  };
  const move = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.start.x;
    const dy = e.clientY - d.start.y;
    if (!d.moved && Math.hypot(dx, dy) < 5) return;
    d.moved = true;
    if (d.kind === "bubble") setBubble(clamp({ x: d.at.x + dx, y: d.at.y + dy }, SIZE, SIZE));
    else setPanel(clamp({ x: d.at.x + dx, y: d.at.y + dy }, panelSize().w, panelSize().h));
  };
  const up = () => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (d.kind === "bubble") {
      if (!d.moved) toggle();
      else setBubble((b) => (write(BUBBLE_KEY, b), b));
    }
  };

  const size = panelSize();
  return (
    <>
      {open && panel && (
        <div
          className="fixed z-[60] flex flex-col rounded-2xl border border-[#c8963c55] bg-[#121212] shadow-[0_12px_40px_rgba(0,0,0,0.6)] overflow-hidden"
          style={{ left: panel.x, top: panel.y, width: size.w, height: size.h }}
          role="dialog"
          aria-label="Asisten Astro"
        >
          <div
            className="flex items-center gap-2 px-3 py-2 cursor-move select-none border-b border-[var(--border)]"
            style={{ background: "linear-gradient(180deg, #2a2f3d 0%, #1a1c22 100%)" }}
            onPointerDown={down("panel")}
            onPointerMove={move}
            onPointerUp={up}
            title="Seret untuk memindah"
          >
            <span className="text-[16px]" aria-hidden>
              ✦
            </span>
            <span className="font-bold text-[#c9b8ff]">Asisten Astro</span>
            <span className="ml-auto" />
            <ClearButton />
            <button className="dim hover:text-[var(--text)] px-1 text-[16px] leading-none" onPointerDown={(e) => e.stopPropagation()} onClick={() => setOpen(false)} title="Tutup (percakapan tetap tersimpan)" aria-label="Tutup">
              —
            </button>
          </div>
          {loaded && <ChatPanel />}
          <div className="text-fs-9 dim text-center pb-1">Dihitung dari data aplikasi, bukan saran investasi.</div>
        </div>
      )}
      <button
        className="fixed z-[61] rounded-full touch-none select-none transition-transform hover:scale-105 active:scale-95 drop-shadow-[0_4px_10px_rgba(0,0,0,0.55)]"
        style={{ left: bubble.x, top: bubble.y, width: SIZE, height: SIZE, cursor: drag.current?.moved ? "grabbing" : "grab" }}
        onPointerDown={down("bubble")}
        onPointerMove={move}
        onPointerUp={up}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            toggle();
          }
        }}
        title="Asisten Astro: klik untuk bertanya, seret untuk memindah"
        aria-label="Buka Asisten Astro"
        aria-expanded={open}
      >
        <Face />
      </button>
    </>
  );
}

/** Starts a new conversation (the panel listens for it). */
function ClearButton() {
  return (
    <button
      className="dim hover:text-[var(--text)] px-1 text-fs-11"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={() => window.dispatchEvent(new Event("astro-chat-clear"))}
      title="Percakapan baru (hapus riwayat)"
      aria-label="Percakapan baru"
    >
      ⟲ Baru
    </button>
  );
}
