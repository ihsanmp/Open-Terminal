// The calendar's whole catalogue of sky events (1990 to ~500 days ahead), worked out once (under a
// second) and shared by every calendar and the chat.

import { buildEvents, type AstroEvent } from "./events";
import { indexByKey } from "./impact";

const DAY = 86_400;
const FIRST_DAY = Math.floor(Date.UTC(1990, 0, 1) / 1000 / DAY);

export type Catalogue = { events: AstroEvent[]; byKey: Map<string, number[]> };
let catalogue: Catalogue | null = null;

/** The catalogue if it's been worked out already, else null (without working it out). */
export const catalogueIfReady = () => catalogue;

export function getCatalogue(): Catalogue {
  if (!catalogue) {
    const today = Math.floor(Date.now() / 1000 / DAY);
    const events = buildEvents(FIRST_DAY, today + 500);
    catalogue = { events, byKey: indexByKey(events) };
  }
  return catalogue;
}
