// What the app shows, for the Astro chat to look at when asked about the screen: a picture of the
// app's own window (the browser window the launcher opens, titled "… — OpenTerminal"), never the
// rest of the desktop. Taken on Windows with PrintWindow, which draws the window's content even
// when another window covers it (not while it's minimized). Scaled to at most 1600 px wide, the
// size Claude reads an image at, and kept only as the last few in data/astro-chat/screens.

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { dataDir } from "../db.js";

export const screensDir = join(dataDir, "astro-chat", "screens");
const KEEP = 5;
const MAX_WIDTH = 1600;

export const screenSupported = () => process.platform === "win32";

/**
 * The PowerShell: the top-most visible window whose title ends with "OpenTerminal" (the one titled
 * exactly as asked, when there is one), drawn into a PNG. Prints "width height" when done ("none",
 * "minimized" when there's no window to draw). With -Serve it stays on, ready: it prints "ready",
 * then takes one picture per line it reads (the title and the file, each base64 of UTF-8, a tab
 * between), answering each with its line. Starting PowerShell and compiling the helper takes about
 * a second; a picture, a tenth of that.
 */
export const CAPTURE_PS1 = String.raw`param([string]$Title = '', [string]$Out = '', [int]$MaxWidth = 1600, [switch]$Serve)
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
function Take([string]$Title, [string]$Out) {
  $h = [OtCapture]::Find($Title)
  if ($h -eq [IntPtr]::Zero) { return 'none' }
  if ($h -eq [IntPtr](-1)) { return 'minimized' }
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
  $size = "$($bmp.Width) $($bmp.Height)"
  $bmp.Dispose()
  return $size
}
if (-not $Serve) { Write-Output (Take $Title $Out); exit 0 }
$utf8 = [System.Text.Encoding]::UTF8
[Console]::Out.WriteLine('ready'); [Console]::Out.Flush()
while ($null -ne ($line = [Console]::In.ReadLine())) {
  $said = 'failed'
  try {
    $parts = $line.Split([char]9)
    $said = Take $utf8.GetString([Convert]::FromBase64String($parts[0])) $utf8.GetString([Convert]::FromBase64String($parts[1]))
  } catch {}
  [Console]::Out.WriteLine($said); [Console]::Out.Flush()
}
`;

/**
 * The capturer kept on (CAPTURE_PS1 -Serve), so a picture is taken in a moment: the chat's panel is
 * hidden for it, and a second of it gone is a glitch. Started when asked to be ready, ended after a
 * while unused.
 */
type Capturer = { ps: ChildProcessWithoutNullStreams; ready: Promise<boolean>; waiting: ((line: string | null) => void)[] };
let capturer: Capturer | null = null;
let idle: ReturnType<typeof setTimeout> | undefined;
const IDLE_MS = 10 * 60_000;

function startCapturer(): Capturer {
  const script = writeScript();
  const ps = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", script, "-MaxWidth", String(MAX_WIDTH), "-Serve"], { windowsHide: true });
  const c: Capturer = { ps, ready: Promise.resolve(false), waiting: [] };
  let buf = "";
  let onReady: (ok: boolean) => void = () => undefined;
  c.ready = new Promise((r) => (onReady = r));
  const readyTimer = setTimeout(() => onReady(false), 20_000);
  ps.stdout.setEncoding("utf8");
  ps.stdout.on("data", (d: string) => {
    buf += d;
    let i: number;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (line === "ready") {
        clearTimeout(readyTimer);
        onReady(true);
      } else if (line) c.waiting.shift()?.(line);
    }
  });
  ps.stderr.on("data", (d) => console.warn("screen capture:", String(d).trim().split("\n")[0]));
  // Written to after it ended: told by "close", not a crash.
  ps.stdin.on("error", () => undefined);
  const gone = () => {
    clearTimeout(readyTimer);
    onReady(false);
    if (capturer === c) capturer = null;
    for (const w of c.waiting.splice(0)) w(null);
  };
  ps.on("error", gone);
  ps.on("close", gone);
  return c;
}

/** Gets the capturer started and ready (true), so the next picture is quick; false when it can't be. */
export function readyCapture(): Promise<boolean> {
  if (!screenSupported()) return Promise.resolve(false);
  capturer ??= startCapturer();
  clearTimeout(idle);
  const c = capturer;
  idle = setTimeout(() => c.ps.kill(), IDLE_MS);
  return c.ready;
}

/** One picture by the capturer kept on; null when it isn't there or fails (then the one-off way). */
async function captureQuick(title: string, file: string): Promise<string | null> {
  if (!(await readyCapture()) || !capturer) return null;
  const c = capturer;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      // Stuck: ended, and the picture taken the one-off way.
      c.ps.kill();
      resolve(null);
    }, 10_000);
    c.waiting.push((line) => {
      clearTimeout(timer);
      resolve(line);
    });
    const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64");
    c.ps.stdin.write(`${b64(title)}\t${b64(file)}\n`);
  });
}

function writeScript(): string {
  if (!existsSync(screensDir)) mkdirSync(screensDir, { recursive: true });
  const script = join(dataDir, "astro-chat", "capture.ps1");
  writeFileSync(script, CAPTURE_PS1);
  return script;
}

const result = (said: string, file: string): ScreenResult => {
  if (said === "none" || said === "minimized") return { screen: null, reason: said };
  const m = /^(\d+) (\d+)$/.exec(said);
  if (!m || !existsSync(file)) return { screen: null, reason: "failed" };
  return { screen: { file, width: Number(m[1]), height: Number(m[2]) }, reason: "ok" };
};

export type Screen = { file: string; width: number; height: number };
export type ScreenResult = { screen: Screen | null; reason: "ok" | "none" | "minimized" | "unsupported" | "failed" };

/** A picture of the app's window (`title`: the one the question came from, when several are open). */
export async function captureScreen(title = ""): Promise<ScreenResult> {
  if (!screenSupported()) return { screen: null, reason: "unsupported" };
  const file = join(screensDir, `screen-${Date.now()}.png`);
  const quick = await captureQuick(title, file);
  if (quick !== null && quick !== "failed") {
    prune();
    return result(quick, file);
  }
  const script = writeScript();
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
      const r = result(out.trim().split(/\r?\n/).pop() ?? "", file);
      if (r.reason === "failed" && err) console.warn("screen capture:", err.trim().split("\n")[0]);
      resolve(r);
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
