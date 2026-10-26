"use client";

import {
  Activity,
  Bell,
  BellOff,
  Briefcase,
  Building,
  ChartColumn,
  Circle,
  ClipboardList,
  Compass,
  Eye,
  FaceSlightlySmiling,
  Fish,
  Flame,
  Heart,
  Landmark,
  Link,
  Mic,
  MicVocal,
  Moon,
  Newspaper,
  Pencil,
  Play,
  Scale,
  Send,
  Settings,
  Snowflake,
  Sparkles,
  Speech,
  Square,
  Star,
  SunMoon,
  Target,
  TrendingUp,
  TriangleAlert,
  User,
  Volume2,
  Zap,
  type LucideIcon,
} from "lucide-react";

// The app's icons: thin line icons (Lucide) in place of emoji, the size of the text they sit in and
// its colour. By name, so a label kept as data can carry its icon.

const ICONS = {
  alert: TriangleAlert,
  assistant: Sparkles,
  bank: Landmark,
  bell: Bell,
  bellOff: BellOff,
  building: Building,
  chart: ChartColumn,
  compass: Compass,
  /** Dovish: cooler than expected. */
  cool: Snowflake,
  eye: Eye,
  face: FaceSlightlySmiling,
  heart: Heart,
  /** Hawkish: hotter than expected. */
  hot: Flame,
  impact: Activity,
  insider: Briefcase,
  link: Link,
  list: ClipboardList,
  lunarEclipse: Moon,
  mic: Mic,
  moonFull: Circle,
  moonNew: Circle,
  neutral: Scale,
  pencil: Pencil,
  person: User,
  play: Play,
  podcast: MicVocal,
  news: Newspaper,
  send: Send,
  settings: Settings,
  solarEclipse: SunMoon,
  speaker: Volume2,
  speech: Speech,
  star: Star,
  stop: Square,
  target: Target,
  trend: TrendingUp,
  whale: Fish,
  zap: Zap,
} satisfies Record<string, LucideIcon>;

export type IconName = keyof typeof ICONS;

/** Filled rather than drawn (a starred star; the new moon's dark disc). */
const FILLED = new Set<IconName>(["moonNew"]);

export function Icon({ name, filled, className = "", title }: { name: IconName; filled?: boolean; className?: string; title?: string }) {
  const Svg = ICONS[name];
  const fill = filled || FILLED.has(name);
  return (
    <Svg
      aria-hidden={title ? undefined : true}
      aria-label={title}
      strokeWidth={1.5}
      fill={fill ? "currentColor" : "none"}
      className={`inline-block shrink-0 align-[-0.15em] ${className}`}
      style={{ width: "1.1em", height: "1.1em" }}
    />
  );
}

/** An astronomical event's mark: a line icon for the eclipses and moon phases, else its glyph as text (☿, ♈ …). */
export function Glyph({ glyph }: { glyph: string }) {
  const name: IconName | null =
    glyph === "🌑" ? "moonNew" : glyph === "🌕" ? "moonFull" : glyph === "🌘" ? "solarEclipse" : glyph === "🌒" ? "lunarEclipse" : null;
  return name ? <Icon name={name} /> : <>{glyph}</>;
}
