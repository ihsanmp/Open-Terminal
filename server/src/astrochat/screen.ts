// What the app shows, for the Astro chat to look at when asked about the screen: a picture of the
// app's own window (the browser window the launcher opens, titled "… — OpenTerminal"), never the
// rest of the desktop. Taken on Windows with PrintWindow, which draws the window's content even
// when another window covers it (not while it's minimized). Scaled to at most 1600 px wide, the
// size Claude reads an image at, and kept only as the last few in data/astro-chat/screens.

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { dataDir } from "../db.js";

export const screensDir = join(dataDir, "astro-chat", "screens");
const KEEP = 5;
const MAX_WIDTH = 1600;

export const screenSupported = () => process.platform === "win32";

/**
 * The PowerShell: the top-most visible window whose title ends with "OpenTerminal" (the one titled
 * exactly as asked, when there is one), drawn into a PNG. Prints "width height" when done.
 */
export const CAPTURE_PS1 = String.raw`param([string]$Title = '', [string]$Out, [int]$MaxWidth = 1600)
$ErrorActionPreference = 'Stop'
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Runtime.InteropServices;
using System.Text;
public static class OtCapture {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc f, IntPtr l);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] static extern bool PrintWindow(IntPtr h, IntPtr hdc, uint flags);
  public static IntPtr Find(string title) {
    var found = new List<KeyValuePair<IntPtr, string>>();
    EnumWindows((h, l) => {
      if (!IsWindowVisible(h)) return true;
      var sb = new StringBuilder(512);
      GetWindowText(h, sb, 512);
      var t = sb.ToString();
      if (t.EndsWith("OpenTerminal")) found.Add(new KeyValuePair<IntPtr, string>(h, t));
      return true;
    }, IntPtr.Zero);
    foreach (var w in found) if (title.Length > 0 && w.Value == title && !IsIconic(w.Key)) return w.Key;
    foreach (var w in found) if (!IsIconic(w.Key)) return w.Key;
    return found.Count > 0 ? (IntPtr)(-1) : IntPtr.Zero;
  }
  public static Bitmap Shot(IntPtr h) {
    RECT r; GetWindowRect(h, out r);
    var bmp = new Bitmap(Math.Max(1, r.Right - r.Left), Math.Max(1, r.Bottom - r.Top));
    using (var g = Graphics.FromImage(bmp)) {
      var hdc = g.GetHdc();
      // 2: PW_RENDERFULLCONTENT, so a browser's GPU-drawn page comes out too.
      PrintWindow(h, hdc, 2);
      g.ReleaseHdc(hdc);
    }
    return bmp;
  }
}
'@
$h = [OtCapture]::Find($Title)
if ($h -eq [IntPtr]::Zero) { Write-Output 'none'; exit 0 }
if ($h -eq [IntPtr](-1)) { Write-Output 'minimized'; exit 0 }
$bmp = [OtCapture]::Shot($h)
if ($bmp.Width -gt $MaxWidth) {
  $hgt = [int]($bmp.Height * $MaxWidth / $bmp.Width)
  $small = New-Object System.Drawing.Bitmap $MaxWidth, $hgt
  $g = [System.Drawing.Graphics]::FromImage($small)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.DrawImage($bmp, 0, 0, $MaxWidth, $hgt)
  $g.Dispose(); $bmp.Dispose(); $bmp = $small
}
$bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
Write-Output "$($bmp.Width) $($bmp.Height)"
$bmp.Dispose()
`;

export type Screen = { file: string; width: number; height: number };
export type ScreenResult = { screen: Screen | null; reason: "ok" | "none" | "minimized" | "unsupported" | "failed" };

/** A picture of the app's window (`title`: the one the question came from, when several are open). */
export function captureScreen(title = ""): Promise<ScreenResult> {
  if (!screenSupported()) return Promise.resolve({ screen: null, reason: "unsupported" });
  if (!existsSync(screensDir)) mkdirSync(screensDir, { recursive: true });
  const script = join(dataDir, "astro-chat", "capture.ps1");
  writeFileSync(script, CAPTURE_PS1);
  const file = join(screensDir, `screen-${Date.now()}.png`);
  return new Promise((resolve) => {
    const ps = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", script, "-Title", title, "-Out", file, "-MaxWidth", String(MAX_WIDTH)], {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    ps.stdout.on("data", (d) => (out += d));
    ps.stderr.on("data", (d) => (err += d));
    const timer = setTimeout(() => ps.kill(), 20_000);
    ps.on("error", () => {
      clearTimeout(timer);
      resolve({ screen: null, reason: "failed" });
    });
    ps.on("close", () => {
      clearTimeout(timer);
      prune();
      const said = out.trim();
      if (said === "none" || said === "minimized") return resolve({ screen: null, reason: said });
      const m = /^(\d+) (\d+)$/.exec(said.split(/\r?\n/).pop() ?? "");
      if (!m || !existsSync(file)) {
        if (err) console.warn("screen capture:", err.trim().split("\n")[0]);
        return resolve({ screen: null, reason: "failed" });
      }
      resolve({ screen: { file, width: Number(m[1]), height: Number(m[2]) }, reason: "ok" });
    });
  });
}

/** Only the last few pictures are kept. */
function prune(): void {
  try {
    const shots = readdirSync(screensDir).filter((f) => /^screen-\d+\.png$/.test(f)).sort();
    for (const f of shots.slice(0, Math.max(0, shots.length - KEEP))) rmSync(join(screensDir, f), { force: true });
  } catch {
    // nothing to tidy
  }
}
