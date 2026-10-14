/** A YouTube video's id from a link (watch?v=, youtu.be/, /live/, /embed/, /shorts/) or the bare id. */
export function youtubeId(input: string): string | null {
  const s = input.trim();
  if (/^[\w-]{11}$/.test(s)) return s;
  try {
    const u = new URL(/^https?:\/\//.test(s) ? s : `https://${s}`);
    if (!/(^|\.)(youtube\.com|youtube-nocookie\.com|youtu\.be)$/.test(u.hostname)) return null;
    const id = u.hostname.endsWith("youtu.be") ? u.pathname.slice(1) : (u.searchParams.get("v") ?? /\/(?:live|embed|shorts|v)\/([\w-]{11})/.exec(u.pathname)?.[1] ?? "");
    return /^[\w-]{11}/.test(id) ? id.slice(0, 11) : null;
  } catch {
    return null;
  }
}
