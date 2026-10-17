import { Router } from "express";
import * as notify from "../notify/notifier.js";

// The Windows notifications (notify/notifier.ts): which kinds are on, the last ones sent, a test.
export const notifyRouter = Router();

notifyRouter.get("/", (_req, res) => {
  res.json({ supported: notify.platformSupported(), settings: notify.settings(), recent: notify.recent() });
});

/** Turns kinds on or off: `{ fed?, h30?, result?, reaction? }` as booleans. */
notifyRouter.post("/settings", (req, res) => {
  res.json({ settings: notify.updateSettings(req.body ?? {}) });
});

notifyRouter.post("/test", async (_req, res) => {
  res.json(await notify.sendTest());
});
