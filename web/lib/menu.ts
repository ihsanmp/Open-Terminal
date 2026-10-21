import type { HubId, View, WidgetType } from "../store/terminal";

// The menu, in the desk's six groups (as a top-down workflow: read the big picture, the policy
// and what's priced, who is moving money, what news changes risk, then plan the trade and keep a
// record), with the pages that don't belong to one under LAINNYA. Some items are hubs: a few
// related pages behind tabs (Market: Watchlist, Screener, Heatmap), each still its own page with
// its own settings.

export type MenuItem = { view: View; label: string; hint?: string };
export type MenuGroup = { id: string; label: string; tagline: string; items: MenuItem[] };

export const GROUPS: MenuGroup[] = [
  {
    id: "macro",
    label: "Macro Command Center",
    tagline: "Regime, bias aset & shortlist pasar",
    items: [
      { view: "dashboard", label: "Dashboard" },
      { view: "regime", label: "Macro Regime" },
      { view: "market", label: "Market" },
    ],
  },
  {
    id: "policy",
    label: "Policy & Expectations",
    tagline: "Ekspektasi suku bunga, tekanan fiskal, harga forward",
    items: [
      { view: "monetary", label: "Monetary Policy" },
      { view: "fiscal", label: "Fiscal Policy" },
      { view: "futures", label: "Futures" },
    ],
  },
  {
    id: "flow",
    label: "Flow & Participants",
    tagline: "Crowding, rotasi sektor, konfirmasi breadth",
    items: [
      { view: "etf", label: "ETF" },
      { view: "participants", label: "Market Participant" },
    ],
  },
  {
    id: "intel",
    label: "Intelligence & Risk",
    tagline: "Prioritas katalis, peta risiko peristiwa",
    items: [
      { view: "intel", label: "Market Intelligence" },
      { view: "geo", label: "Geopolitics" },
    ],
  },
  {
    id: "analysis",
    label: "Analysis & Execution",
    tagline: "Validasi teknikal, timing, rencana eksekusi",
    items: [
      { view: "quant", label: "Quantitative" },
      { view: "chart", label: "Charting" },
      { view: "nodes", label: "Nodes Plan" },
    ],
  },
  {
    id: "research",
    label: "Fundamental Research & Learning",
    tagline: "Konteks fundamental, jejak keputusan, belajar",
    items: [
      { view: "research", label: "Financials" },
      { view: "notepad", label: "Notepad" },
      { view: "academy", label: "Academy" },
    ],
  },
  {
    id: "more",
    label: "Lainnya",
    tagline: "",
    items: [
      { view: "portfolio", label: "Portfolio" },
      { view: "astrocal", label: "Astro Calendar" },
      { view: "ai", label: "AI Assist" },
    ],
  },
];

export const HUBS: Record<HubId, { label: string; tabs: Array<{ type: WidgetType; label: string; note?: string }> }> = {
  market: {
    label: "Market",
    tabs: [
      { type: "watchlist", label: "Watchlist" },
      { type: "screener", label: "Screener" },
      { type: "heatmap", label: "Heatmap" },
    ],
  },
  monetary: {
    label: "Monetary Policy",
    tabs: [
      { type: "calendar", label: "Fed, FedWatch & data ekonomi" },
      { type: "bonds", label: "US Bonds" },
    ],
  },
  participants: {
    label: "Market Participant",
    tabs: [
      { type: "cot", label: "Positioning (COT)" },
      { type: "moneyflow", label: "Money Flow" },
      { type: "insider", label: "Insider" },
    ],
  },
  intel: {
    label: "Market Intelligence",
    tabs: [
      { type: "news", label: "News" },
      { type: "watcher", label: "Watcher Guru" },
      { type: "tv", label: "Live TV & Fed" },
    ],
  },
};

export const isHub = (v: string): v is HubId => v in HUBS;

/** The hub a page is a tab of, if any. */
export function hubOf(view: View): HubId | null {
  if (isHub(view)) return view;
  for (const [id, hub] of Object.entries(HUBS) as Array<[HubId, (typeof HUBS)[HubId]]>) if (hub.tabs.some((t) => t.type === view)) return id;
  return null;
}

const HUB_KEY = (hub: HubId) => `ot-hub-${hub}`;

/** The tab a hub opens on: the one used last (kept in this browser), else its first. */
export function hubTab(hub: HubId): WidgetType {
  const tabs = HUBS[hub].tabs;
  try {
    const saved = window.localStorage.getItem(HUB_KEY(hub));
    if (saved && tabs.some((t) => t.type === saved)) return saved as WidgetType;
  } catch {
    // no storage: the first tab
  }
  return tabs[0].type;
}

export function rememberHubTab(hub: HubId, type: WidgetType): void {
  try {
    window.localStorage.setItem(HUB_KEY(hub), type);
  } catch {
    // not kept
  }
}

/** The page a menu item opens: a hub's remembered tab, else the item's own page. */
export const pageFor = (view: View): View => (isHub(view) ? hubTab(view) : view);

/** Every item in menu order (⌥1 … ⌥9 open the first nine). */
export function flatMenu(aiAvailable: boolean): MenuItem[] {
  return GROUPS.flatMap((g) => g.items).filter((i) => i.view !== "ai" || aiAvailable);
}
