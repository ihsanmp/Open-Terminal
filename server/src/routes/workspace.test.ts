import { existsSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { dataDir } from "../db.js";
import { isWorkspace, readSaved, writeSaved } from "./workspace.js";

// The real files are set aside while the test runs.
const files = ["workspace.json", "workspace.prev.json"].map((f) => join(dataDir, f));
beforeAll(() => files.forEach((f) => existsSync(f) && renameSync(f, `${f}.testbak`)));
afterAll(() =>
  files.forEach((f) => {
    if (existsSync(f)) unlinkSync(f);
    if (existsSync(`${f}.testbak`)) renameSync(`${f}.testbak`, f);
  })
);

const ws = (sym: string) => ({ state: { tabs: [{ id: "t1", activeSymbol: sym }], watchlist: ["AAPL"] }, version: 1 });

describe("workspace backup", () => {
  it("accepts only a workspace with tabs", () => {
    expect(isWorkspace(ws("AAPL"))).toBe(true);
    expect(isWorkspace({ state: { tabs: [] }, version: 1 })).toBe(false);
    expect(isWorkspace({ hello: 1 })).toBe(false);
  });

  it("keeps the latest copy and the one before it", () => {
    expect(readSaved()).toBeNull();
    writeSaved(ws("AAPL"), 1);
    writeSaved(ws("BTC-USD"), 2);
    expect(readSaved()).toEqual({ savedAt: 2, workspace: ws("BTC-USD") });
    // A damaged latest file falls back to the previous one.
    writeFileSync(files[0], "{ broken");
    expect(readSaved()?.workspace.state.tabs[0]).toEqual({ id: "t1", activeSymbol: "AAPL" });
  });
});
