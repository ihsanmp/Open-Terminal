// Windows toast notifications, as the app's own: the Start Menu shortcut the desktop installer makes
// carries the app's AppUserModelID (desktop/Taskbar.cs), so a toast raised under that id shows as
// OpenTerminal, with its icon, in the Action Center. Raised through Windows PowerShell's WinRT
// projection (PowerShell 7 has none), one at a time. Without the shortcut (a dev checkout) the
// toast goes out as Windows PowerShell's, which Windows always accepts. Elsewhere it does nothing.

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

export const APP_ID = "IhsanMP.OpenTerminal";
/** Windows PowerShell's own id: a toast under it always shows. */
const POWERSHELL_ID = "{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe";

export const toastsSupported = () => process.platform === "win32";

/** The id toasts go out under: the app's once the installer's Start Menu shortcut exists. */
export function appId(): string {
  const programs = process.env.APPDATA ? join(process.env.APPDATA, "Microsoft", "Windows", "Start Menu", "Programs", "OpenTerminal.lnk") : "";
  return programs && existsSync(programs) ? APP_ID : POWERSHELL_ID;
}

const xmlEscape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The toast's XML: a title and up to two lines. */
export function toastXml(title: string, lines: string[]): string {
  const texts = [title, ...lines.slice(0, 2)].map((t) => `<text>${xmlEscape(t)}</text>`).join("");
  return `<toast><visual><binding template="ToastGeneric">${texts}</binding></visual><audio src="ms-winsoundevent:Notification.Default"/></toast>`;
}

/** The PowerShell that shows it (the XML passed in base64, so nothing in it needs quoting). */
export function toastScript(xml: string, id: string): string {
  const b64 = Buffer.from(xml, "utf8").toString("base64");
  return [
    "$ErrorActionPreference = 'Stop'",
    "[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null",
    "[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] > $null",
    `$xml = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${b64}'))`,
    "$doc = New-Object Windows.Data.Xml.Dom.XmlDocument",
    "$doc.LoadXml($xml)",
    `[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('${id.replace(/'/g, "''")}').Show([Windows.UI.Notifications.ToastNotification]::new($doc))`,
  ].join("; ");
}

let chain: Promise<void> = Promise.resolve();

/** Shows a toast (queued behind any still being raised); resolves false when it couldn't be shown. */
export function showToast(title: string, lines: string[]): Promise<boolean> {
  if (!toastsSupported()) return Promise.resolve(false);
  const run = () =>
    new Promise<boolean>((resolve) => {
      const script = toastScript(toastXml(title, lines), appId());
      const ps = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")], {
        windowsHide: true,
        stdio: ["ignore", "ignore", "pipe"],
      });
      let err = "";
      ps.stderr.on("data", (d) => (err += d));
      const timer = setTimeout(() => ps.kill(), 20_000);
      ps.on("error", () => {
        clearTimeout(timer);
        resolve(false);
      });
      ps.on("close", (code) => {
        clearTimeout(timer);
        if (code !== 0) console.warn("toast:", err.trim().split("\n")[0] || `exit ${code}`);
        resolve(code === 0);
      });
    });
  const p = chain.then(run, run);
  chain = p.then(
    () => undefined,
    () => undefined,
  );
  return p;
}
