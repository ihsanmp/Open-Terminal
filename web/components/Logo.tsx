// Parallax's mark: three ridge lines, the far ones fainter (the depth parallax reads), the nearest in
// the accent. The app icon (desktop/make-icon.ps1) draws the same lines on a dark tile.

const RIDGES: Array<{ points: string; opacity: number; accent?: boolean; width: number }> = [
  { points: "40,166 100,96 140,136 216,60", opacity: 0.35, width: 14 },
  { points: "40,184 96,128 136,162 216,86", opacity: 0.65, width: 14 },
  { points: "40,202 92,160 132,186 216,112", opacity: 1, accent: true, width: 16 },
];

export function Logo({ size = 16, tile = false }: { size?: number; tile?: boolean }) {
  return (
    <svg width={size} height={size} viewBox={tile ? "0 0 256 256" : "30 50 196 162"} aria-hidden="true" className="shrink-0">
      {tile && <rect x="10" y="10" width="236" height="236" rx="46" fill="#0a0a0a" stroke="#e5e7eb" strokeWidth="10" />}
      {RIDGES.map((r) => (
        <polyline
          key={r.points}
          points={r.points}
          fill="none"
          stroke={r.accent ? "var(--amber)" : "#e5e7eb"}
          strokeOpacity={r.opacity}
          strokeWidth={r.width}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
    </svg>
  );
}
