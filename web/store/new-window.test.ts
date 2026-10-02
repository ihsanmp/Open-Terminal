import "./test-local-storage";
import { describe, expect, it, vi } from "vitest";

// The taskbar's "New window" opens the app with ?new: that window starts on a copy of the tab
// used last, and the address then names the copy so a reload doesn't copy again.
describe("new window", () => {
  it("starts on a copy of the tab used last", async () => {
    const g = globalThis as unknown as Record<string, unknown>;
    let address = "http://127.0.0.1:3000/";
    g.location = { get href() { return address; }, get search() { return new URL(address).search; } };
    g.history = { replaceState: (_: unknown, __: string, url: URL) => void (address = String(url)) };
    g.sessionStorage = { getItem: () => null, setItem: () => {} };

    // One window: two tabs, the second used last.
    const first = await import("./terminal");
    const st = () => first.useTerminal.getState();
    st().setActiveSymbol("AAPL");
    const other = st().duplicateTab();
    st().setActiveSymbol("BTC-USD");
    expect(st().activeTab).toBe(other);

    // "New window".
    vi.resetModules();
    address = "http://127.0.0.1:3000/?new=1";
    const second = await import("./terminal");
    const s = second.useTerminal.getState();
    expect(s.tabs).toHaveLength(3);
    expect(s.activeTab).not.toBe(other);
    expect(s.tabs.findIndex((t) => t.id === s.activeTab)).toBe(s.tabs.findIndex((t) => t.id === other) + 1);
    expect(s.activeSymbol).toBe("BTC-USD");
    expect(new URL(address).searchParams.get("tab")).toBe(s.activeTab);
    expect(new URL(address).searchParams.has("new")).toBe(false);
  });
});
