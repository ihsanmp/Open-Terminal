"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import { DEFAULT_PANEL, fitSize, resized, type Edges, type Size } from "../lib/astro-chat/panel-size";

// The Astro chat as a small floating bubble over every page: dragged anywhere (kept where it's
// left), clicked open into a compact portrait panel beside it, on the side with room, so the data
// underneath stays in sight. The panel moves by its header too, and is resized by its edges and
// corners; the size last chosen is kept and the panel opens at it. What it shows (the chat, the
// planets, the prices) is loaded the first time it opens.

const ChatPanel = dynamic(() => import("./AstroChatPanel"), { ssr: false, loading: () => <div className="p-3 dim text-fs-11">Memuat asisten…</div> });

type Pos = { x: number; y: number };
const SIZE = 52;
const MARGIN = 8;
const BUBBLE_KEY = "ot-astro-bubble";
const PANEL_SIZE_KEY = "ot-astro-panel-size";

const read = (key: string): Pos | null => {
  try {
    const v = JSON.parse(window.localStorage.getItem(key) ?? "null");
    return v && Number.isFinite(v.x) && Number.isFinite(v.y) ? v : null;
  } catch {
    return null;
  }
};
const readSize = (): Size | null => {
  try {
    const v = JSON.parse(window.localStorage.getItem(PANEL_SIZE_KEY) ?? "null");
    return v && Number.isFinite(v.w) && Number.isFinite(v.h) ? { w: v.w, h: v.h } : null;
  } catch {
    return null;
  }
};
const write = (key: string, p: Pos | Size) => {
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

const viewSize = (): Size => ({ w: window.innerWidth, h: window.innerHeight });

/** Where the panel opens: beside the bubble on the side with more room, its bottom level with the bubble's. */
function panelBeside(b: Pos, { w, h }: Size): Pos {
  const right = b.x + SIZE / 2 > window.innerWidth / 2;
  const x = right ? b.x - w - MARGIN : b.x + SIZE + MARGIN;
  return clamp({ x, y: b.y + SIZE - h }, w, h);
}

/** The panel's resize handles: each edge, and each corner for both at once. */
const HANDLES: Array<[Edges, string, string]> = [
  [{ l: true }, "left-0 top-3 bottom-3 w-1.5 cursor-ew-resize", "kiri"],
  [{ r: true }, "right-0 top-3 bottom-3 w-1.5 cursor-ew-resize", "kanan"],
  [{ t: true }, "top-0 left-3 right-3 h-1.5 cursor-ns-resize", "atas"],
  [{ b: true }, "bottom-0 left-3 right-3 h-1.5 cursor-ns-resize", "bawah"],
  [{ l: true, t: true }, "left-0 top-0 w-3 h-3 cursor-nwse-resize", "kiri atas"],
  [{ r: true, t: true }, "right-0 top-0 w-3 h-3 cursor-nesw-resize", "kanan atas"],
  [{ l: true, b: true }, "left-0 bottom-0 w-3 h-3 cursor-nesw-resize", "kiri bawah"],
  [{ r: true, b: true }, "right-0 bottom-0 w-3 h-3 cursor-nwse-resize", "kanan bawah"],
];

/** Follows the pointer outside the element while it's held (some pens and touch screens refuse; then it doesn't). */
const capture = (e: React.PointerEvent) => {
  try {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  } catch {
    // the drag still works while the pointer stays over the element
  }
};

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
  // The size chosen last (kept across sessions), fitted to the window as it is now.
  const [wanted, setWanted] = useState<Size>(() => readSize() ?? DEFAULT_PANEL);
  const size = fitSize(wanted, viewSize());
  const sizeRef = useRef(size);
  sizeRef.current = size;
  const resizing = useRef<{ edges: Edges; start: Pos; rect: Pos & Size } | null>(null);
  const [loaded, setLoaded] = useState(false);
  const drag = useRef<{ kind: "bubble" | "panel"; start: Pos; bubbleAt: Pos; panelAt: Pos | null; moved: boolean } | null>(null);

  // A smaller window keeps both on screen.
  useEffect(() => {
    const onResize = () => {
      setBubble((b) => clamp(b, SIZE, SIZE));
      setPanel((p) => (p ? clamp(p, sizeRef.current.w, sizeRef.current.h) : p));
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const toggle = useCallback(() => {
    setOpen((o) => {
      if (!o) {
        setPanel(panelBeside(bubble, sizeRef.current));
        setLoaded(true);
      }
      return !o;
    });
  }, [bubble]);

  const down = (kind: "bubble" | "panel") => (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    capture(e);
    drag.current = { kind, start: { x: e.clientX, y: e.clientY }, bubbleAt: bubble, panelAt: panel, moved: false };
  };
  // The two move together: the open panel stays beside the dragged bubble (switching sides as it
  // crosses the middle), and the bubble keeps its place beside the dragged panel.
  const move = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.start.x;
    const dy = e.clientY - d.start.y;
    if (!d.moved && Math.hypot(dx, dy) < 5) return;
    d.moved = true;
    if (d.kind === "bubble") {
      const b = clamp({ x: d.bubbleAt.x + dx, y: d.bubbleAt.y + dy }, SIZE, SIZE);
      setBubble(b);
      if (open) setPanel(panelBeside(b, size));
    } else if (d.panelAt) {
      const p = clamp({ x: d.panelAt.x + dx, y: d.panelAt.y + dy }, size.w, size.h);
      setPanel(p);
      setBubble(clamp({ x: d.bubbleAt.x + (p.x - d.panelAt.x), y: d.bubbleAt.y + (p.y - d.panelAt.y) }, SIZE, SIZE));
    }
  };
  const up = () => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (d.moved) setBubble((b) => (write(BUBBLE_KEY, b), b));
    else if (d.kind === "bubble") toggle();
  };

  // Resizing by an edge or a corner; the size is kept when the pointer lets go.
  const resizeDown = (edges: Edges) => (e: React.PointerEvent) => {
    if (e.button !== 0 || !panel) return;
    e.stopPropagation();
    capture(e);
    resizing.current = { edges, start: { x: e.clientX, y: e.clientY }, rect: { ...panel, ...size } };
  };
  const resizeMove = (e: React.PointerEvent) => {
    const r = resizing.current;
    if (!r) return;
    const next = resized(r.rect, r.edges, e.clientX - r.start.x, e.clientY - r.start.y, viewSize());
    setPanel({ x: next.x, y: next.y });
    setWanted({ w: next.w, h: next.h });
  };
  const resizeUp = () => {
    if (!resizing.current) return;
    resizing.current = null;
    setWanted((s) => (write(PANEL_SIZE_KEY, s), s));
  };

  return (
    <>
      {open && panel && (
        <div
          className="fixed z-[60] flex flex-col rounded-2xl border border-[#c8963c55] bg-[#121212] shadow-[0_12px_40px_rgba(0,0,0,0.6)] overflow-hidden"
          style={{ left: panel.x, top: panel.y, width: size.w, height: size.h }}
          role="dialog"
          aria-label="Asisten Astro"
          data-no-screen
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
          {HANDLES.map(([edges, cls, label]) => (
            <div
              key={label}
              className={`absolute z-30 touch-none ${cls}`}
              onPointerDown={resizeDown(edges)}
              onPointerMove={resizeMove}
              onPointerUp={resizeUp}
              onPointerCancel={resizeUp}
              title="Seret untuk mengubah ukuran (ukurannya diingat)"
              aria-label={`Ubah ukuran dari ${label}`}
            />
          ))}
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
        data-no-screen
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
