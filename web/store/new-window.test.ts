import "./test-local-storage";
import { describe, expect, it, vi } from "vitest";

// Several app windows, simulated by loading the store again with a fresh session (as a new window
// has) over the same localStorage. Each window has its own tabs: no tab shows in two windows.
const g = globalThis as unknown as Record<string, unknown>;
let address = "http://127.0.0.1:3000/";
g.location = {
  get href() {
    return address;
  },
  get search() {
    return new URL(address).search;
  },
};
g.history = { replaceState: (_: unknown, __: string, url: URL) => void (address = String(url)) };

/** A new window: its own (empty) session, opened at `url`. */
async function openWindow(url: string) {
  const session = new Map<string, string>();
  g.sessionStorage = { getItem: (k: string) => session.get(k) ?? null, setItem: (k: string, v: string) => void session.set(k, v) };
  address = url;
  vi.resetModules();
  const mod = await import("./terminal");
  return { st: () => mod.useTerminal.getState(), session };
}

describe("windows", () => {
  it("each has its own tabs, and a new one never mirrors another", async () => {
    localStorage.clear();
    // The app starts: one window with every tab. It makes a second tab and works in it.
    const a = await openWindow("http://127.0.0.1:3000/");
    const first = a.st().activeTab;
    a.st().setActiveSymbol("AAPL");
    const second = a.st().duplicateTab();
    a.st().setActiveSymbol("BTC-USD");
    expect(a.st().windowTabs).toEqual([first, second]);

    // "New window" (the taskbar): a copy of the tab used last, as its only tab.
    const b = await openWindow("http://127.0.0.1:3000/?new=1");
    const copy = b.st().activeTab;
    expect(b.st().windowTabs).toEqual([copy]);
    expect([first, second]).not.toContain(copy);
    expect(b.st().activeSymbol).toBe("BTC-USD");
    expect(new URL(address).searchParams.get("tab")).toBe(copy);
    expect(new URL(address).searchParams.has("new")).toBe(false);
    b.st().setActiveSymbol("ETH-USD");

    // The app started again while both are open: all tabs are taken, so it gets a copy too.
    const c = await openWindow("http://127.0.0.1:3000/");
    expect(c.st().windowTabs).toHaveLength(1);
    expect([first, second, copy]).not.toContain(c.st().activeTab);
    expect(c.st().tabs).toHaveLength(4);
  });

  it("keeps its tabs over a reload, and a moved tab leaves its window", async () => {
    localStorage.clear();
    const a = await openWindow("http://127.0.0.1:3000/");
    const first = a.st().activeTab;
    const second = a.st().duplicateTab();
    const third = a.st().duplicateTab();

    // ⧉ on the second tab: it leaves this window …
    a.st().releaseTab(second);
    expect(a.st().windowTabs).toEqual([first, third]);
    // … and the window opened for it shows only it.
    const b = await openWindow(`http://127.0.0.1:3000/?tab=${second}`);
    expect(b.st().windowTabs).toEqual([second]);

    // A reload of that window: same session, same tabs.
    const session = b.session;
    g.sessionStorage = { getItem: (k: string) => session.get(k) ?? null, setItem: (k: string, v: string) => void session.set(k, v) };
    vi.resetModules();
    const again = (await import("./terminal")).useTerminal.getState();
    expect(again.windowTabs).toEqual([second]);
  });

  it("can't close or move away a window's last tab", async () => {
    localStorage.clear();
    const a = await openWindow("http://127.0.0.1:3000/");
    const only = a.st().activeTab;
    a.st().closeTab(only);
    a.st().releaseTab(only);
    expect(a.st().windowTabs).toEqual([only]);
  });
});
