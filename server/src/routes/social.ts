import { Router } from "express";
import * as social from "../providers/socialfeed.js";

// The insiders' posts (providers/socialfeed.ts): the feed, X posts pasted in, accounts followed.
export const socialRouter = Router();

const TIERS = new Set<social.Tier>(["A1", "Tokoh", "KOL"]);

socialRouter.get("/", async (_req, res) => {
  try {
    res.json(await social.feed());
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});

/** Pastes X posts: `{ input }` holds one or more links to them. */
socialRouter.post("/x", async (req, res) => {
  const input = typeof req.body?.input === "string" ? req.body.input.slice(0, 4000) : "";
  try {
    res.json(await social.addX(input));
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

socialRouter.delete("/posts/:id", (req, res) => {
  res.json({ removed: social.removePost(String(req.params.id)) });
});

/** Follows an account: `{ input, tier }` (a t.me link, a Bluesky handle, truth:<id>). */
socialRouter.post("/sources", async (req, res) => {
  const input = typeof req.body?.input === "string" ? req.body.input.slice(0, 200) : "";
  const tier: social.Tier = TIERS.has(req.body?.tier) ? req.body.tier : "KOL";
  try {
    res.json(await social.follow(input, tier));
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

socialRouter.delete("/sources/:id", (req, res) => {
  res.json({ removed: social.unfollow(String(req.params.id)) });
});
