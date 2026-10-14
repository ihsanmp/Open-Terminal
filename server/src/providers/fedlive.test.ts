import { describe, expect, it } from "vitest";
import { newYorkTime, parseChannelFeed, parseFedCalendar, plainText, streamState, videoIdOf } from "./fedlive.js";

describe("the Fed on air", () => {
  it("reads New York times as instants, summer and winter", () => {
    expect(newYorkTime("2026-10-28", "2:00 p.m.")?.toISOString()).toBe("2026-10-28T18:00:00.000Z"); // EDT
    expect(newYorkTime("2026-12-09", "2:30 p.m.")?.toISOString()).toBe("2026-12-09T19:30:00.000Z"); // EST
    expect(newYorkTime("2026-10-15", "11:30 p.m.")?.toISOString()).toBe("2026-10-16T03:30:00.000Z");
    expect(newYorkTime("2026-10-15", "12:00 a.m.")?.toISOString()).toBe("2026-10-15T04:00:00.000Z");
    expect(newYorkTime("2026-10-15", "")).toBeNull();
  });

  it("reads the Board's calendar, its stream links and its escaped descriptions", () => {
    const events = parseFedCalendar({
      events: [
        { title: "Discussion - Chairman Kevin Warsh", description: "Conversation with the IMF", live: "https://www.youtube.com/watch?v=T20jWBJ66X0&list=x", time: "11:30 p.m.", month: "2026-10", days: "15", type: "Speeches" },
        { title: "FOMC Meeting", description: "&lt;p&gt;Two-day meeting, October 27 - 28&lt;/p&gt;&#10;&#10;&lt;p&gt;Press Conference&lt;/p&gt;", time: "2:00 p.m.", month: "2026-10", days: "28", type: "FOMC" },
        { title: "G.20 - Finance Companies", month: "2026-10", days: "29", type: "Stat" },
      ],
    });
    expect(events[0]).toMatchObject({ title: "Discussion - Chairman Kevin Warsh", start: "2026-10-16T03:30:00.000Z", videoId: "T20jWBJ66X0", allDay: false });
    expect(events[1]).toMatchObject({ description: "Two-day meeting, October 27 - 28 Press Conference", start: "2026-10-28T18:00:00.000Z" });
    expect(events[2]).toMatchObject({ allDay: true, videoId: null });
    expect(plainText("a &amp; b")).toBe("a & b");
  });

  it("finds video ids and a channel feed's videos", () => {
    expect(["https://www.youtube.com/live/V7H5F2C5PNc", "https://youtu.be/T20jWBJ66X0", "https://www.federalreserve.gov/live-broadcast.htm"].map(videoIdOf)).toEqual(["V7H5F2C5PNc", "T20jWBJ66X0", null]);
    const xml = `<feed><entry><yt:videoId>RUcSaJvY4qk</yt:videoId><title>Opening remarks by Vice Chair Bowman &amp; more</title><published>2026-09-29T15:00:37+00:00</published></entry></feed>`;
    expect(parseChannelFeed(xml)).toEqual([{ videoId: "RUcSaJvY4qk", title: "Opening remarks by Vice Chair Bowman & more", published: "2026-09-29T15:00:37+00:00" }]);
  });

  it("tells live from upcoming from over", () => {
    const live = { videoDetails: { title: "FOMC Press Conference", author: "Federal Reserve", isLive: true }, microformat: { playerMicroformatRenderer: { liveBroadcastDetails: { isLiveNow: true, startTimestamp: "2026-10-28T18:30:00+00:00" } } } };
    expect(streamState("x", live, "Fed")).toMatchObject({ status: "live", channel: "Federal Reserve", start: "2026-10-28T18:30:00+00:00" });
    const soon = { videoDetails: { title: "Chat", isUpcoming: true }, microformat: { playerMicroformatRenderer: { liveBroadcastDetails: { isLiveNow: false, startTimestamp: "2026-10-16T03:30:00+00:00" } } } };
    expect(streamState("y", soon, "IMF")?.status).toBe("upcoming");
    const over = { microformat: { playerMicroformatRenderer: { liveBroadcastDetails: { isLiveNow: false, startTimestamp: "a", endTimestamp: "b" } } } };
    expect(streamState("z", over, "Fed")?.status).toBe("ended");
    expect(streamState("v", { videoDetails: { title: "a recording" } }, "Fed")).toBeNull();
  });
});
