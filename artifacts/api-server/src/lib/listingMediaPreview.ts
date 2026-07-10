/**
 * Shared feed/card thumbnail selection. The feed renders media_preview in an
 * <Image>, so the URL must be an image (or a video poster), never a raw video
 * file. Matches ListingService.getSeoListing cover logic.
 */

export type ListingMediaThumbInput = {
  type: "image" | "video";
  url: string;
  thumbnail_url?: string | null;
  thumbnailUrl?: string | null;
  is_thumbnail?: boolean | null;
  isThumbnail?: boolean | null;
  sort_order?: number | null;
  sortOrder?: number | null;
};

function isCoverFlag(m: ListingMediaThumbInput): boolean {
  return m.is_thumbnail === true || m.isThumbnail === true;
}

function posterUrl(m: ListingMediaThumbInput): string | null {
  return m.thumbnail_url ?? m.thumbnailUrl ?? null;
}

function sortKey(m: ListingMediaThumbInput): number {
  return m.sort_order ?? m.sortOrder ?? 0;
}

/** Stable seller order: explicit cover first, then sort_order ascending. */
export function sortListingMedia<T extends ListingMediaThumbInput>(media: T[]): T[] {
  return [...media].sort((a, b) => {
    const aCover = isCoverFlag(a);
    const bCover = isCoverFlag(b);
    if (aCover !== bCover) return aCover ? -1 : 1;
    return sortKey(a) - sortKey(b);
  });
}

/** Pick a URL safe for <Image> / feed cards. */
export function pickListingThumbnailUrl(
  media: ListingMediaThumbInput[],
): string | null {
  const sorted = sortListingMedia(media);
  const cover = sorted.find((m) => isCoverFlag(m) && m.type === "image");
  const firstImage = sorted.find((m) => m.type === "image");
  const videoPoster = sorted.find((m) => m.type === "video" && posterUrl(m));
  const poster = videoPoster ? posterUrl(videoPoster) : null;
  return cover?.url ?? firstImage?.url ?? poster ?? null;
}
