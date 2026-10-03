"use client";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import type { ChartScaleMode } from "../../store/terminal";

type Props = {
  at: { x: number; y: number };
  autoScale: boolean;
  mode: ChartScaleMode;
  invert: boolean;
  onAuto: () => void;
  onInvert: () => void;
  onMode: (mode: ChartScaleMode) => void;
  onClose: () => void;
};

const MODES: Array<[ChartScaleMode, string, string?]> = [
  ["normal", "Regular"],
  ["percent", "Percent", "Alt + P"],
  ["indexed", "Indexed to 100"],
  ["log", "Logarithmic", "Alt + L"],
];

/** TradingView's price scale context menu (right-click on the price axis). */
export function PriceScaleMenu({ at, autoScale, mode, invert, onAuto, onInvert, onMode, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("mousedown", onDown, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const W = 240;
  const H = 230;
  const left = Math.max(8, Math.min(at.x, window.innerWidth - W - 8));
  const top = Math.max(8, Math.min(at.y, window.innerHeight - H - 8));

  const item = (checked: boolean, label: string, hotkey: string | undefined, act: () => void) => (
    <button
      key={label}
      className="flex items-center gap-2 w-full px-2 h-7 text-left hover:bg-[#262626]"
      onClick={() => {
        act();
        onClose();
      }}
    >
      <span className="w-3 amber">{checked ? "✓" : ""}</span>
      <span className="flex-1">{label}</span>
      {hotkey && <span className="dim text-fs-10">{hotkey}</span>}
    </button>
  );

  return createPortal(
    <div
      ref={ref}
      style={{ position: "fixed", left, top, width: W }}
      className="z-[60] bg-[#1a1a1a] border border-[var(--border)] py-1 text-fs-12 shadow-lg"
      onContextMenu={(e) => e.preventDefault()}
    >
      {item(autoScale, "Auto (fits data to screen)", undefined, onAuto)}
      {item(invert, "Invert scale", "Alt + I", onInvert)}
      <div className="border-t border-[var(--border)] my-1" />
      {MODES.map(([m, label, hotkey]) => item(mode === m, label, hotkey, () => onMode(m)))}
      <div className="border-t border-[var(--border)] my-1" />
      {item(false, "Reset price scale", undefined, onAuto)}
    </div>,
    document.body
  );
}
