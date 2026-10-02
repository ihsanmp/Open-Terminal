"use client";

import { createContext, useCallback, useContext } from "react";
import { create } from "zustand";
import { persist, type PersistStorage } from "zustand/middleware";
import { createWorkspaceStorage, WORKSPACE_KEY } from "./workspace-storage";
import type { IndicatorInstance } from "../lib/ta/types";
import type { ChartStyle } from "../lib/chart-style";

export type WidgetType =
  | "quote"
  | "chart"
  | "watchlist"
  | "news"
  | "heatmap"
  | "screener"
  | "crypto"
  | "macro"
  | "options"
  | "portfolio"
  | "ai"
  | "calendar"
  | "insider"
  | "tv"
  | "recap"
  | "indices"
  | "research";

export type ChartScaleMode = "normal" | "log" | "percent" | "indexed";

export type WidgetInstance = {
  id: string;
  type: WidgetType;
  symbol?: string;
  linked: boolean; // follows the globally active symbol
  indicators?: IndicatorInstance[]; // chart widgets only; undefined = defaults
  chartInterval?: string; // chart widgets: candle interval (default 1D)
  chartScale?: ChartScaleMode; // chart widgets: price scale mode (TradingView's Regular / Percent / Indexed to 100 / Logarithmic)
  chartInvert?: boolean; // chart widgets: inverted price scale
  chartStyle?: Partial<ChartStyle>; // chart widgets: the Settings dialog (candles, precision, timezone, canvas)
  /** A widget's own choices (filters, tabs, chart type, channel …), saved with it; see useWidgetSetting. */
  settings?: Record<string, unknown>;
};

export const DEFAULT_CHART_INDICATORS: IndicatorInstance[] = [
  { uid: "volume-default", id: "volume", params: {} },
  { uid: "sma-default", id: "sma", params: { length: 20 } },
];

export type LayoutItem = { i: string; x: number; y: number; w: number; h: number };

/** What the main area shows: one feature full-page, or the free-form widget workspace. */
export type View = WidgetType | "workspace";

/**
 * One tab of the app, like a browser tab: its own symbol, page and workspace. The watchlist
 * and the starred intervals are shared by all tabs.
 */
export type TabData = {
  id: string;
  /** A name the user gave it; otherwise the tab shows its symbol and page. */
  title?: string;
  activeSymbol: string;
  view: View;
  pages: WidgetInstance[];
  widgets: WidgetInstance[];
  layout: LayoutItem[];
};

type TerminalState = {
  /** Every open tab, in tab-bar order (saved; the fields below mirror the active one). */
  tabs: TabData[];
  /** The tab this window shows. Each window has its own, so tabs can be watched side by side. */
  activeTab: string;
  activeSymbol: string;
  view: View;
  /** The widget behind each full-page view (its own settings, apart from the workspace's). */
  pages: WidgetInstance[];
  widgets: WidgetInstance[];
  layout: LayoutItem[];
  watchlist: string[];
  /** Starred chart intervals, shown on every chart's toolbar (TradingView's favorites). */
  favoriteIntervals: string[];
  commandOpen: boolean;
  setActiveSymbol: (s: string) => void;
  setCommandOpen: (open: boolean) => void;
  setView: (view: View) => void;
  ensurePage: (type: WidgetType) => void;
  addWidget: (type: WidgetType, symbol?: string) => void;
  removeWidget: (id: string) => void;
  setWidgetSymbol: (id: string, symbol: string) => void;
  toggleLinked: (id: string) => void;
  setWidgetIndicators: (id: string, indicators: IndicatorInstance[]) => void;
  setWidgetChart: (id: string, patch: { chartInterval?: string; chartScale?: ChartScaleMode; chartInvert?: boolean; chartStyle?: Partial<ChartStyle> }) => void;
  toggleFavoriteInterval: (interval: string) => void;
  setWidgetSetting: (id: string, key: string, value: unknown) => void;
  setLayout: (layout: LayoutItem[]) => void;
  addToWatchlist: (s: string) => void;
  removeFromWatchlist: (s: string) => void;
  resetWorkspace: () => void;
  /** Opens a copy of the current tab next to it (switching to it unless `stay`); returns its id. */
  duplicateTab: (stay?: boolean) => string;
  switchTab: (id: string) => void;
  closeTab: (id: string) => void;
  renameTab: (id: string, title: string) => void;
  moveTab: (id: string, toIndex: number) => void;
};

const DEFAULT_WIDGETS: WidgetInstance[] = [
  { id: "w-chart", type: "chart", linked: true },
  { id: "w-quote", type: "quote", linked: true },
  { id: "w-watchlist", type: "watchlist", linked: false },
  { id: "w-news", type: "news", linked: true },
  { id: "w-macro", type: "macro", linked: false },
];

const DEFAULT_LAYOUT: LayoutItem[] = [
  { i: "w-chart", x: 0, y: 0, w: 7, h: 12 },
  { i: "w-quote", x: 7, y: 0, w: 5, h: 6 },
  { i: "w-watchlist", x: 7, y: 6, w: 5, h: 6 },
  { i: "w-news", x: 0, y: 12, w: 7, h: 7 },
  { i: "w-macro", x: 7, y: 12, w: 5, h: 7 },
];

const SIZE_BY_TYPE: Record<WidgetType, { w: number; h: number }> = {
  quote: { w: 5, h: 6 },
  chart: { w: 7, h: 12 },
  watchlist: { w: 4, h: 7 },
  news: { w: 5, h: 8 },
  heatmap: { w: 7, h: 10 },
  screener: { w: 12, h: 9 },
  crypto: { w: 6, h: 9 },
  macro: { w: 5, h: 7 },
  options: { w: 12, h: 9 },
  portfolio: { w: 7, h: 8 },
  ai: { w: 5, h: 10 },
  calendar: { w: 12, h: 11 },
  insider: { w: 7, h: 9 },
  tv: { w: 6, h: 11 },
  recap: { w: 5, h: 12 },
  indices: { w: 5, h: 14 },
  research: { w: 7, h: 16 },
};

/** Apply a change to the widget with this id, whether it's in the workspace or a page. */
const patchWidget = (st: TerminalState, id: string, f: (w: WidgetInstance) => WidgetInstance) => ({
  widgets: st.widgets.map((w) => (w.id === id ? f(w) : w)),
  pages: st.pages.map((w) => (w.id === id ? f(w) : w)),
});

/** A new page starts from the settings of the workspace's first widget of its kind. */
function newPage(st: TerminalState, type: WidgetType): WidgetInstance {
  const like = st.widgets.find((w) => w.type === type);
  return { ...like, id: `page-${type}`, type, symbol: undefined, linked: true };
}

const TAB_KEYS = ["activeSymbol", "view", "pages", "widgets", "layout"] as const;
const pickTab = (st: Pick<TabData, (typeof TAB_KEYS)[number]>) => ({
  activeSymbol: st.activeSymbol,
  view: st.view,
  pages: st.pages,
  widgets: st.widgets,
  layout: st.layout,
});

const DEFAULT_TAB: TabData = { id: "t1", activeSymbol: "AAPL", view: "chart", pages: [], widgets: DEFAULT_WIDGETS, layout: DEFAULT_LAYOUT };

// The tab a window opens on: the one named in its address (?tab=…, a window opened from a tab),
// or the one it showed before a reload.
const TAB_SESSION_KEY = "openterminal-tab";
const windowTab = (() => {
  if (typeof window === "undefined") return null;
  try {
    return new URLSearchParams(window.location.search).get("tab") ?? window.sessionStorage.getItem(TAB_SESSION_KEY);
  } catch {
    return null;
  }
})();

function rememberWindowTab(id: string) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(TAB_SESSION_KEY, id);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", id);
    window.history.replaceState(null, "", url);
  } catch {
    // the tab is still switched; only a reload forgets it
  }
}

export const useTerminal = create<TerminalState>()(
  persist(
    (set, get) => ({
      tabs: [DEFAULT_TAB],
      activeTab: windowTab ?? DEFAULT_TAB.id,
      ...pickTab(DEFAULT_TAB),
      watchlist: ["AAPL", "MSFT", "NVDA", "TSLA", "AMZN", "GOOGL", "META", "SPY"],
      favoriteIntervals: [],
      commandOpen: false,
      setActiveSymbol: (s) => set({ activeSymbol: s.toUpperCase() }),
      setCommandOpen: (open) => set({ commandOpen: open }),
      setView: (view) => set({ view }),
      ensurePage: (type) => set((st) => (st.pages.some((p) => p.type === type) ? {} : { pages: [...st.pages, newPage(st, type)] })),
      addWidget: (type, symbol) =>
        set((st) => {
          const id = `w-${type}-${Date.now()}`;
          const size = SIZE_BY_TYPE[type];
          const maxY = st.layout.reduce((m, l) => Math.max(m, l.y + l.h), 0);
          return {
            widgets: [...st.widgets, { id, type, symbol, linked: !symbol }],
            layout: [...st.layout, { i: id, x: 0, y: maxY, ...size }],
          };
        }),
      removeWidget: (id) =>
        set((st) => ({
          widgets: st.widgets.filter((w) => w.id !== id),
          layout: st.layout.filter((l) => l.i !== id),
        })),
      setWidgetSymbol: (id, symbol) => set((st) => patchWidget(st, id, (w) => ({ ...w, symbol: symbol.toUpperCase(), linked: false }))),
      toggleLinked: (id) => set((st) => patchWidget(st, id, (w) => ({ ...w, linked: !w.linked }))),
      setWidgetIndicators: (id, indicators) => set((st) => patchWidget(st, id, (w) => ({ ...w, indicators }))),
      setWidgetChart: (id, patch) => set((st) => patchWidget(st, id, (w) => ({ ...w, ...patch }))),
      setWidgetSetting: (id, key, value) => set((st) => patchWidget(st, id, (w) => ({ ...w, settings: { ...w.settings, [key]: value } }))),
      setLayout: (layout) => set({ layout }),
      addToWatchlist: (s) =>
        set((st) => ({
          watchlist: st.watchlist.includes(s.toUpperCase()) ? st.watchlist : [...st.watchlist, s.toUpperCase()],
        })),
      removeFromWatchlist: (s) => set((st) => ({ watchlist: st.watchlist.filter((x) => x !== s) })),
      toggleFavoriteInterval: (interval) =>
        set((st) => ({
          favoriteIntervals: st.favoriteIntervals.includes(interval)
            ? st.favoriteIntervals.filter((i) => i !== interval)
            : [...st.favoriteIntervals, interval],
        })),
      resetWorkspace: () => set({ widgets: DEFAULT_WIDGETS, layout: DEFAULT_LAYOUT }),
      duplicateTab: (stay = false) => {
        const st = get();
        const id = `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
        const current = st.tabs.find((tab) => tab.id === st.activeTab);
        const copy: TabData = { ...structuredClone(pickTab(st)), id, title: current?.title ? `${current.title} (2)` : undefined };
        const at = st.tabs.findIndex((tab) => tab.id === st.activeTab);
        const tabs = [...st.tabs];
        tabs.splice(at + 1, 0, copy);
        if (stay) {
          set({ tabs });
          return id;
        }
        set({ tabs, activeTab: id });
        rememberWindowTab(id);
        return id;
      },
      switchTab: (id) => {
        const tab = get().tabs.find((t) => t.id === id);
        if (!tab) return;
        set({ activeTab: id, ...pickTab(tab) });
        rememberWindowTab(id);
      },
      closeTab: (id) => {
        const st = get();
        if (st.tabs.length <= 1) return;
        const at = st.tabs.findIndex((t) => t.id === id);
        const tabs = st.tabs.filter((t) => t.id !== id);
        if (st.activeTab !== id) return set({ tabs });
        const next = tabs[Math.min(at, tabs.length - 1)];
        set({ tabs, activeTab: next.id, ...pickTab(next) });
        rememberWindowTab(next.id);
      },
      renameTab: (id, title) => set((st) => ({ tabs: st.tabs.map((t) => (t.id === id ? { ...t, title: title.trim() || undefined } : t)) })),
      moveTab: (id, toIndex) =>
        set((st) => {
          const from = st.tabs.findIndex((t) => t.id === id);
          if (from < 0) return {};
          const tabs = [...st.tabs];
          const [tab] = tabs.splice(from, 1);
          tabs.splice(Math.max(0, Math.min(toIndex, tabs.length)), 0, tab);
          return { tabs };
        }),
    }),
    {
      name: WORKSPACE_KEY,
      // Saved per tab, so windows editing different tabs can't overwrite each other.
      storage: createWorkspaceStorage() as PersistStorage<unknown> | undefined,
      // v1: tabs. The window's own tab and the transient UI aren't saved.
      version: 1,
      partialize: (st) => ({ tabs: st.tabs, watchlist: st.watchlist, favoriteIntervals: st.favoriteIntervals }),
      migrate: (saved, version) => {
        if (version >= 1) return saved as TerminalState;
        // v0 kept one workspace at the top level: it becomes the first tab.
        const old = (saved ?? {}) as Partial<TabData> & { watchlist?: string[]; favoriteIntervals?: string[] };
        const tab: TabData = {
          id: DEFAULT_TAB.id,
          activeSymbol: old.activeSymbol ?? DEFAULT_TAB.activeSymbol,
          view: old.view ?? DEFAULT_TAB.view,
          pages: old.pages ?? [],
          widgets: old.widgets ?? DEFAULT_WIDGETS,
          layout: old.layout ?? DEFAULT_LAYOUT,
        };
        return { tabs: [tab], watchlist: old.watchlist, favoriteIntervals: old.favoriteIntervals ?? [] } as unknown as TerminalState;
      },
      // Saved tabs, with this window staying on its own tab (the first if that one was closed).
      merge: (saved, current) => {
        const s = (saved ?? {}) as Partial<TerminalState>;
        const tabs = s.tabs?.length ? s.tabs : current.tabs;
        const tab = tabs.find((t) => t.id === current.activeTab) ?? tabs[0];
        return { ...current, ...s, tabs, activeTab: tab.id, ...pickTab(tab) };
      },
    }
  )
);

// The live fields above are the active tab's; every change to them is saved into its entry.
useTerminal.subscribe((st, prev) => {
  if (st.activeTab !== prev.activeTab) return; // switching loads a tab, nothing to save
  if (TAB_KEYS.every((k) => st[k] === prev[k])) return;
  useTerminal.setState({ tabs: st.tabs.map((t) => (t.id === st.activeTab ? { ...t, ...pickTab(st) } : t)) });
});

/** Other windows' changes (another tab, or this one shown twice) arrive through localStorage. */
export function followOtherWindows(): () => void {
  // One save can touch several entries (a tab and the tab list): read them all once it's done.
  let pending: ReturnType<typeof setTimeout> | undefined;
  const onStorage = (e: StorageEvent) => {
    if (!e.key?.startsWith(WORKSPACE_KEY)) return;
    clearTimeout(pending);
    pending = setTimeout(() => void useTerminal.persist.rehydrate(), 30);
  };
  window.addEventListener("storage", onStorage);
  return () => {
    clearTimeout(pending);
    window.removeEventListener("storage", onStorage);
  };
}

/** What a tab is called on the tab bar: its name, or its symbol and page. */
export function tabLabel(tab: TabData): string {
  if (tab.title) return tab.title;
  const page = tab.view === "workspace" ? "Workspace" : tab.view.charAt(0).toUpperCase() + tab.view.slice(1);
  return `${tab.activeSymbol} · ${page}`;
}

/** Symbol a widget should display: its own, or the active one when linked. */
export function useWidgetSymbol(widget: WidgetInstance): string {
  const active = useTerminal((s) => s.activeSymbol);
  return widget.linked ? active : widget.symbol ?? active;
}

/** The widget being rendered, for useWidgetSetting (set by WidgetBody). */
export const WidgetIdContext = createContext<string | null>(null);

/**
 * Like useState, but saved with the widget (and its tab), so a choice made in it — a filter, a
 * tab, the chart type — is still there after switching tabs or restarting the app.
 */
export function useWidgetSetting<T>(key: string, fallback: T): [T, (value: T | ((current: T) => T)) => void] {
  const id = useContext(WidgetIdContext);
  const read = useCallback(
    (s: TerminalState): T | undefined => {
      if (!id) return undefined;
      const w = s.widgets.find((x) => x.id === id) ?? s.pages.find((x) => x.id === id);
      return w?.settings?.[key] as T | undefined;
    },
    [id, key]
  );
  const stored = useTerminal(read);
  const set = useCallback(
    (value: T | ((current: T) => T)) => {
      if (!id) return;
      const st = useTerminal.getState();
      const current = read(st) ?? fallback;
      st.setWidgetSetting(id, key, typeof value === "function" ? (value as (c: T) => T)(current) : value);
    },
    // fallback is a constant at each call site
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [id, key, read]
  );
  return [stored === undefined ? fallback : stored, set];
}
