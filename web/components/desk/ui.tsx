"use client";

import { Area, AreaChart, ResponsiveContainer, Tooltip, YAxis } from "recharts";
import { fontPx } from "../../lib/font-scale";

// Pieces the desk's pages share: a titled section, a figure with its label, a signed percent, a
// small area chart, and WIB times.

export function Section({ title, note, right, children, className = "" }: { title: string; note?: string; right?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={`border border-[var(--border)] rounded-sm bg-[var(--panel)] min-w-0 ${className}`}>
      <header className="flex items-baseline gap-2 px-3 py-1.5 border-b border-[var(--border)] bg-[var(--panel-2)]">
        <h3 className="text-fs-11 font-bold uppercase tracking-wide text-[#a9b8d6]">{title}</h3>
        {note && <span className="text-fs-9 dim truncate">{note}</span>}
        {right && <span className="ml-auto shrink-0">{right}</span>}
      </header>
      <div className="p-3">{children}</div>
    </section>
  );
}

export function Stat({ label, value, sub, tone }: { label: string; value: React.ReactNode; sub?: React.ReactNode; tone?: "up" | "down" | "amber" | "dim" }) {
  return (
    <div className="min-w-0">
      <div className="text-fs-9 dim uppercase tracking-wide">{label}</div>
      <div className={`text-fs-15 font-bold tabular-nums ${tone ?? ""}`}>{value}</div>
      {sub && <div className="text-fs-9 dim">{sub}</div>}
    </div>
  );
}

export const signed = (v: number | null | undefined, digits = 2, unit = "%") => (v == null || !Number.isFinite(v) ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(digits)}${unit}`);
export const toneOf = (v: number | null | undefined): "up" | "down" | "dim" => (v == null || v === 0 ? "dim" : v > 0 ? "up" : "down");

export function Pct({ v, digits = 2, unit = "%" }: { v: number | null | undefined; digits?: number; unit?: string }) {
  return <span className={`tabular-nums ${toneOf(v)}`}>{signed(v, digits, unit)}</span>;
}

/** Dollars in trillions / billions / millions. */
export function usd(v: number | null | undefined, digits = 2): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const a = Math.abs(v);
  const s = v < 0 ? "−" : "";
  if (a >= 1e12) return `${s}$${(a / 1e12).toFixed(digits)} T`;
  if (a >= 1e9) return `${s}$${(a / 1e9).toFixed(digits === 2 ? 1 : digits)} M`;
  if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(1)} jt`;
  return `${s}$${a.toFixed(0)}`;
}

export const wib = (ms: number, withDate = true) =>
  new Date(ms).toLocaleString("id-ID", { timeZone: "Asia/Jakarta", ...(withDate ? { day: "numeric", month: "short" } : {}), hour: "2-digit", minute: "2-digit" }) + " WIB";

export function ago(ms: number, now = Date.now()): string {
  const m = Math.round((now - ms) / 60_000);
  if (m < 1) return "baru saja";
  if (m < 60) return `${m} mnt lalu`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} jam lalu`;
  return `${Math.round(h / 24)} hari lalu`;
}

export function Spark({ data, color = "#f0a030", height = 60, format }: { data: Array<{ x: string; y: number }>; color?: string; height?: number; format?: (v: number) => string }) {
  if (data.length < 2) return <div className="dim text-fs-10" style={{ height }}>Belum ada data.</div>;
  const id = `g${color.replace("#", "")}`;
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 2, right: 2, bottom: 0, left: 2 }}>
          <defs>
            <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.35} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <YAxis hide domain={["auto", "auto"]} />
          <Tooltip
            contentStyle={{ background: "#111", border: "1px solid #333", fontSize: fontPx(10) }}
            labelFormatter={(_, p) => (p?.[0]?.payload as { x?: string } | undefined)?.x ?? ""}
            formatter={(v: number) => [format ? format(v) : v.toLocaleString("en-US"), ""]}
          />
          <Area type="monotone" dataKey="y" stroke={color} strokeWidth={1.5} fill={`url(#${id})`} isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

/** A bar from −1 … 1 around a middle line, for a score. */
export function ScoreBar({ value, label }: { value: number; label: string }) {
  const v = Math.max(-1, Math.min(1, value));
  return (
    <div>
      <div className="flex justify-between text-fs-9 dim">
        <span>{label}</span>
        <span className={toneOf(v)}>{v > 0 ? "▲ naik" : v < 0 ? "▼ turun" : "datar"} ({v.toFixed(2)})</span>
      </div>
      <div className="relative h-2 bg-[#1a1a1a] rounded-sm mt-0.5">
        <div className="absolute top-0 bottom-0 left-1/2 w-px bg-[#444]" />
        <div className={`absolute top-0 bottom-0 rounded-sm ${v >= 0 ? "bg-[var(--up)]" : "bg-[var(--down)]"}`} style={v >= 0 ? { left: "50%", width: `${v * 50}%` } : { right: "50%", width: `${-v * 50}%` }} />
      </div>
    </div>
  );
}

export function Loading({ what }: { what: string }) {
  return <div className="p-3 dim">Memuat {what}…</div>;
}

export function Failed({ error }: { error: unknown }) {
  return <div className="p-3 down">Gagal memuat: {error instanceof Error ? error.message : String(error)}</div>;
}
