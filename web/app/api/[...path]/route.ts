import { NextRequest, NextResponse } from "next/server";
import { getApiKey } from "@/lib/api-key";

// A route handler (rather than next.config.ts rewrites) because rewrites
// can't attach a header to the proxied request — and the shared API key
// must never reach the browser, only travel server-to-server.
const API_URL = process.env.API_URL ?? "http://localhost:4000";

async function proxy(req: NextRequest, path: string[]): Promise<NextResponse> {
  const url = `${API_URL}/api/${path.join("/")}${req.nextUrl.search}`;
  const apiKey = getApiKey();

  const headers = new Headers();
  const contentType = req.headers.get("content-type");
  if (contentType) headers.set("content-type", contentType);
  if (apiKey) headers.set("x-api-key", apiKey);
  // Relayed, not fabricated: only meaningful (and only trusted by the API)
  // when TRUST_PROXY=1 is set there — see server/src/index.ts.
  const forwardedFor = req.headers.get("x-forwarded-for");
  if (forwardedFor) headers.set("x-forwarded-for", forwardedFor);

  const hasBody = req.method !== "GET" && req.method !== "HEAD" && req.method !== "DELETE";

  // A GET that the API hasn't answered in 40 s is given up with a 504 (the page retries it),
  // rather than holding the connection; other methods (an AI answer) may take longer.
  let upstream: Response;
  try {
    upstream = await fetch(url, {
      method: req.method,
      headers,
      body: hasBody ? await req.text() : undefined,
      cache: "no-store",
      signal: req.method === "GET" ? AbortSignal.timeout(40_000) : undefined,
    });
  } catch (err) {
    const timedOut = err instanceof Error && err.name === "TimeoutError";
    return NextResponse.json({ error: timedOut ? "The API took too long to answer." : "The API is not reachable." }, { status: timedOut ? 504 : 502 });
  }

  const body = upstream.status === 204 ? null : await upstream.arrayBuffer();
  const out = new Headers({ "content-type": upstream.headers.get("content-type") ?? "application/json" });
  // A saved copy from the API's disk cache, served while it fetches a fresh one.
  const stale = upstream.headers.get("x-stale");
  if (stale) out.set("x-stale", stale);
  return new NextResponse(body, { status: upstream.status, headers: out });
}

type RouteContext = { params: Promise<{ path: string[] }> };

export async function GET(req: NextRequest, ctx: RouteContext) {
  return proxy(req, (await ctx.params).path);
}
export async function POST(req: NextRequest, ctx: RouteContext) {
  return proxy(req, (await ctx.params).path);
}
export async function DELETE(req: NextRequest, ctx: RouteContext) {
  return proxy(req, (await ctx.params).path);
}
export async function PATCH(req: NextRequest, ctx: RouteContext) {
  return proxy(req, (await ctx.params).path);
}
export async function PUT(req: NextRequest, ctx: RouteContext) {
  return proxy(req, (await ctx.params).path);
}
