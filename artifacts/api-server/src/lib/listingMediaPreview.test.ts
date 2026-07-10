import { describe, expect, it } from "vitest";

import { pickListingThumbnailUrl, sortListingMedia } from "./listingMediaPreview";

describe("listingMediaPreview", () => {
  it("sorts cover flag before sort_order", () => {
    const sorted = sortListingMedia([
      { type: "image", url: "b.jpg", sortOrder: 0 },
      { type: "image", url: "a.jpg", isThumbnail: true, sortOrder: 5 },
    ]);
    expect(sorted.map((m) => m.url)).toEqual(["a.jpg", "b.jpg"]);
  });

  it("never uses a leading video URL as thumbnail", () => {
    const url = pickListingThumbnailUrl([
      { type: "video", url: "clip.mp4", isThumbnail: true },
      { type: "image", url: "cover.jpg", sortOrder: 1 },
    ]);
    expect(url).toBe("cover.jpg");
  });

  it("falls back to video poster when no images exist", () => {
    const url = pickListingThumbnailUrl([
      { type: "video", url: "clip.mp4", thumbnail_url: "poster.jpg" },
    ]);
    expect(url).toBe("poster.jpg");
  });

  it("prefers flagged cover image", () => {
    const url = pickListingThumbnailUrl([
      { type: "image", url: "other.jpg", sortOrder: 0 },
      { type: "image", url: "hero.jpg", is_thumbnail: true, sortOrder: 2 },
    ]);
    expect(url).toBe("hero.jpg");
  });
});
