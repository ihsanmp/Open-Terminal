import { describe, expect, it } from "vitest";
import { youtubeId } from "./youtube";

describe("a YouTube link's video id", () => {
  it("reads the usual link shapes and the bare id", () => {
    expect(
      [
        "https://www.youtube.com/watch?v=QB5BNdBFujE&t=30s",
        "youtube.com/live/QB5BNdBFujE?si=abc",
        "https://youtu.be/QB5BNdBFujE",
        "https://m.youtube.com/watch?v=QB5BNdBFujE",
        "https://www.youtube-nocookie.com/embed/QB5BNdBFujE",
        " QB5BNdBFujE ",
      ].map(youtubeId),
    ).toEqual(Array(6).fill("QB5BNdBFujE"));
  });

  it("refuses other sites and links without a video", () => {
    expect(["https://vimeo.com/watch?v=QB5BNdBFujE", "https://www.youtube.com/@markets", "hello"].map(youtubeId)).toEqual([null, null, null]);
  });
});
