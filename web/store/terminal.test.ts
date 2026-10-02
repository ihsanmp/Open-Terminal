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

  it("saves the tabs but not which one this window shows, and stays on it when reloaded", () => {
    const b = st().duplicateTab();
    st().setActiveSymbol("SOL-USD");
    const saved = options.partialize!(st()) as Record<string, unknown>;
    expect(Object.keys(saved).sort()).toEqual(["favoriteIntervals", "tabs", "watchlist"]);
    // Another window changed this tab's symbol; this window stays on it and shows the change.
    const tabs = (saved.tabs as Array<{ id: string; activeSymbol: string }>).map((t) => (t.id === b ? { ...t, activeSymbol: "XRP-USD" } : t));
    const merged = options.merge!({ ...saved, tabs }, st());
    expect([merged.activeTab, merged.activeSymbol]).toEqual([b, "XRP-USD"]);
    // …or falls back to the first tab when it was closed there.
    const without = options.merge!({ ...saved, tabs: tabs.filter((t) => t.id !== b) }, st());
    expect(without.activeTab).toBe(tabs[0].id);
  });
});
