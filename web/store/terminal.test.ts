import "./test-local-storage";
import { beforeEach, describe, expect, it } from "vitest";
import { tabLabel, useTerminal } from "./terminal";

const initial = useTerminal.getState();
beforeEach(() => useTerminal.setState(initial, true));

const st = () => useTerminal.getState();

describe("tabs", () => {
  it("copies the current tab, then each tab keeps its own symbol and page", () => {
    st().setActiveSymbol("btc-usd");
    st().setView("chart");
    const first = st().activeTab;
    const copy = st().duplicateTab();
    expect(st().activeTab).toBe(copy);
    expect(st().activeSymbol).toBe("BTC-USD");

    st().setActiveSymbol("ETH-USD");
    st().setView("news");
    st().switchTab(first);
    expect([st().activeSymbol, st().view]).toEqual(["BTC-USD", "chart"]);
    st().switchTab(copy);
    expect([st().activeSymbol, st().view]).toEqual(["ETH-USD", "news"]);
    expect(st().tabs.map(tabLabel)).toEqual(["BTC-USD · Chart", "ETH-USD · News"]);
  });

  it("opens a new tab of its own beside the current one: the chart, nothing carried over", () => {
    st().setActiveSymbol("SOL-USD");
    st().setView("news");
    st().addWidget("heatmap");
    const first = st().activeTab;
    const fresh = st().newTab();
    expect(st().activeTab).toBe(fresh);
    expect(st().windowTabs).toEqual([first, fresh]);
    expect([st().activeSymbol, st().view, st().pages]).toEqual(["SOL-USD", "chart", []]);
    expect(st().widgets.some((w) => w.type === "heatmap")).toBe(false);
    // A tab opened from the first goes right after it, before the ones already there.
    st().switchTab(first);
    const between = st().newTab();
    expect(st().windowTabs).toEqual([first, between, fresh]);
  });

  it("gives a new tab (\"+\") the chart's drawings, indicators and style, then lets each go its own way", () => {
    st().setActiveSymbol("BTC-USD");
    st().ensurePage("chart");
    const page = st().pages.find((p) => p.type === "chart")!.id;
    st().setWidgetSetting(page, "drawings", { "BTC-USD": [{ id: "d1", tool: "trendline" }] });
    st().setWidgetSetting(page, "indicators", [{ uid: "i1", id: "ema" }]);
    st().setWidgetChart(page, { chartInterval: "4h" });
    const first = st().activeTab;
    st().duplicateTab();
    const copy = st().pages.find((p) => p.id === page)!;
    expect(copy.settings?.drawings).toEqual({ "BTC-USD": [{ id: "d1", tool: "trendline" }] });
    expect(copy.settings?.indicators).toEqual([{ uid: "i1", id: "ema" }]);
    expect(copy.chartInterval).toBe("4h");
    // The copy changes symbol and drawings; the original keeps its own.
    st().setActiveSymbol("ETH-USD");
    st().setWidgetSetting(page, "drawings", {});
    st().switchTab(first);
    expect(st().activeSymbol).toBe("BTC-USD");
    expect(st().pages.find((p) => p.id === page)!.settings?.drawings).toEqual({ "BTC-USD": [{ id: "d1", tool: "trendline" }] });
  });

  it("keeps a copy's chart settings apart from the original's", () => {
    st().addWidget("chart", "AAPL");
    const id = st().widgets.at(-1)!.id;
    const first = st().activeTab;
    st().duplicateTab();
    st().setWidgetChart(id, { chartInterval: "1h" });
    st().switchTab(first);
    expect(st().widgets.find((w) => w.id === id)!.chartInterval).toBeUndefined();
  });

  it("closes a tab and moves to its neighbour; the last tab stays", () => {
    const a = st().activeTab;
    const b = st().duplicateTab();
    const c = st().duplicateTab();
    st().closeTab(c);
    expect(st().activeTab).toBe(b);
    st().closeTab(a);
    expect(st().tabs.map((t) => t.id)).toEqual([b]);
    st().closeTab(b);
    expect(st().tabs).toHaveLength(1);
  });

  it("can copy a tab for another window without leaving this one", () => {
    const here = st().activeTab;
    const other = st().duplicateTab(true);
    expect(st().activeTab).toBe(here);
    expect(st().tabs.map((t) => t.id)).toEqual([here, other]);
  });

  it("renames and reorders tabs", () => {
    const a = st().activeTab;
    const b = st().duplicateTab();
    st().renameTab(b, "  Majors  ");
    st().moveTab(b, 0);
    // The order is this window's.
    expect(st().windowTabs).toEqual([b, a]);
    const tabB = () => st().tabs.find((t) => t.id === b)!;
    expect(tabLabel(tabB())).toBe("Majors");
    st().renameTab(b, " ");
    expect(tabB().title).toBeUndefined();
  });
});

describe("saved workspace", () => {
  const options = useTerminal.persist.getOptions();

  it("turns the one-workspace format (v0) into a first tab", () => {
    const old = { activeSymbol: "NVDA", view: "news", pages: [], widgets: initial.widgets, layout: initial.layout, watchlist: ["NVDA"], favoriteIntervals: ["1h"] };
    const migrated = options.migrate!(old, 0) as unknown as { tabs: Array<{ activeSymbol: string; view: string }>; watchlist: string[] };
    expect(migrated.tabs).toHaveLength(1);
    expect([migrated.tabs[0].activeSymbol, migrated.tabs[0].view]).toEqual(["NVDA", "news"]);
    expect(migrated.watchlist).toEqual(["NVDA"]);
  });

  it("moves News Recap into News (v5): its page, its widgets, and what each showed", () => {
    type Saved = { tabs: Array<{ view: string; pages: Array<{ id: string; type: string; settings?: Record<string, unknown> }>; widgets: Array<{ type: string; settings?: Record<string, unknown> }> }> };
    const saved = {
      tabs: [
        // A tab on the recap page, with a News page too: one News page, opened on the recap.
        {
          id: "a",
          activeSymbol: "AAPL",
          view: "recap",
          pages: [
            { id: "n", type: "news", linked: true, settings: { category: "ENERGY" } },
            { id: "r", type: "recap", linked: true, settings: { tab: "news", newsRecapKind: "week" } },
          ],
          widgets: [{ id: "w", type: "recap", linked: true, settings: { tab: "market" } }],
          layout: [],
        },
        // A tab with only the recap page: it becomes the News page.
        { id: "b", activeSymbol: "AAPL", view: "chart", pages: [{ id: "r2", type: "recap", linked: true }], widgets: [], layout: [] },
      ],
    };
    const out = options.migrate!(saved, 4) as unknown as Saved;
    const [a, b] = out.tabs;
    expect(a.view).toBe("news");
    expect(a.pages.map((p) => [p.id, p.type])).toEqual([["n", "news"]]);
    expect(a.pages[0].settings).toEqual({ category: "ENERGY", newsRecapKind: "week", mode: "recap" });
    expect(a.widgets[0]).toMatchObject({ type: "news", settings: { mode: "market" } });
    expect(b.pages[0]).toMatchObject({ id: "r2", type: "news", settings: { mode: "recap" } });
  });

  it("moves Crypto into the Watchlist (v6), opened on its Crypto category", () => {
    type Saved = { tabs: Array<{ view: string; pages: Array<{ id: string; type: string; settings?: Record<string, unknown> }>; widgets: Array<{ type: string; settings?: Record<string, unknown> }> }> };
    const saved = {
      tabs: [
        {
          id: "a",
          activeSymbol: "AAPL",
          view: "crypto",
          pages: [
            { id: "w", type: "watchlist", linked: true },
            { id: "c", type: "crypto", linked: true },
          ],
          widgets: [{ id: "x", type: "crypto", linked: true }],
          layout: [],
        },
        { id: "b", activeSymbol: "AAPL", view: "chart", pages: [{ id: "c2", type: "crypto", linked: true }], widgets: [], layout: [] },
      ],
    };
    const [a, b] = (options.migrate!(saved, 5) as unknown as Saved).tabs;
    expect(a.view).toBe("watchlist");
    expect(a.pages.map((p) => [p.id, p.type, p.settings?.category])).toEqual([["w", "watchlist", "crypto"]]);
    expect(a.widgets[0]).toMatchObject({ type: "watchlist", settings: { category: "crypto" } });
    expect(b.pages[0]).toMatchObject({ id: "c2", type: "watchlist", settings: { category: "crypto" } });
  });

  it("moves World Indices into the Watchlist (v7), and Crypto and World Indices into one Watchlist page", () => {
    type Saved = { tabs: Array<{ view: string; pages: Array<{ id: string; type: string; settings?: Record<string, unknown> }>; widgets: Array<{ type: string; settings?: Record<string, unknown> }> }> };
    const saved = {
      tabs: [
        { id: "a", activeSymbol: "AAPL", view: "indices", pages: [{ id: "i", type: "indices", linked: true }], widgets: [{ id: "x", type: "indices", linked: true }], layout: [] },
        // From before v6: a Crypto page and a World Indices page, no Watchlist page; World Indices in view.
        {
          id: "b",
          activeSymbol: "AAPL",
          view: "indices",
          pages: [
            { id: "c", type: "crypto", linked: true },
            { id: "i2", type: "indices", linked: true },
          ],
          widgets: [],
          layout: [],
        },
      ],
    };
    const [a] = (options.migrate!(saved, 6) as unknown as Saved).tabs;
    expect(a.view).toBe("watchlist");
    expect(a.pages[0]).toMatchObject({ id: "i", type: "watchlist", settings: { category: "idx-all" } });
    expect(a.widgets[0]).toMatchObject({ type: "watchlist", settings: { category: "idx-all" } });
    const [, b] = (options.migrate!(saved, 5) as unknown as Saved).tabs;
    expect(b.view).toBe("watchlist");
    expect(b.pages.map((p) => [p.id, p.type, p.settings?.category])).toEqual([["c", "watchlist", "idx-all"]]);
  });

  it("saves the tabs but not which one this window shows, and stays on it when reloaded", () => {
    const b = st().duplicateTab();
    st().setActiveSymbol("SOL-USD");
    const saved = options.partialize!(st()) as Record<string, unknown>;
    expect(Object.keys(saved).sort()).toEqual(["favoriteIntervals", "recentSymbols", "tabs", "watchlist"]);
    // The symbol search's history is saved with them, newest first.
    expect((saved.recentSymbols as Array<{ symbol: string }>)[0].symbol).toBe("SOL-USD");
    // Another window changed this tab's symbol; this window stays on it and shows the change.
    const tabs = (saved.tabs as Array<{ id: string; activeSymbol: string }>).map((t) => (t.id === b ? { ...t, activeSymbol: "XRP-USD" } : t));
    const merged = options.merge!({ ...saved, tabs }, st());
    expect([merged.activeTab, merged.activeSymbol]).toEqual([b, "XRP-USD"]);
    // …or falls back to the first tab when it was closed there.
    const without = options.merge!({ ...saved, tabs: tabs.filter((t) => t.id !== b) }, st());
    expect(without.activeTab).toBe(tabs[0].id);
  });
});
