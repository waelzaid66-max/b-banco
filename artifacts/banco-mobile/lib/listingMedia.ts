import type * as ImagePicker from "expo-image-picker";

import { isVideoAsset } from "./upload";

/**
 * Pure create-listing MEDIA policy layer — no React/RN runtime, no I/O. The
 * create screen owns the picker call, the upload (lib/upload.ts) and the React
 * state; this module owns the *rules* about that media list so they live in one
 * testable place and new surfaces (edit-listing, drafts) can reuse them without
 * duplicating limits or reorder math.
 */

export const MAX_PHOTOS = 15;
// Backend hard-requires >=1 image (awards a trust bonus at >=3). Keep the
// publish gate low (2) so posting stays Instagram-easy; the boost hint still
// nudges sellers toward more photos for reach.
export const MIN_PHOTOS = 2;
// Videos are additive and optional. The card thumbnail (media_preview) is always
// the first IMAGE, so a listing can carry video while staying renderable in the
// feed's <Image>. Caps are UX guards only — never server-enforced.
export const MAX_VIDEOS = 2;
export const MAX_MEDIA = MAX_PHOTOS + MAX_VIDEOS;
export const MAX_VIDEO_SECONDS = 20;
export const MAX_VIDEO_MB = 50;
export const MAX_VIDEO_BYTES = MAX_VIDEO_MB * 1024 * 1024;

/**
 * Keep seller order, but cap images and videos independently and drop any
 * duplicate uris. Used after every pick so per-type limits hold.
 */
export function capMedia(
  list: ImagePicker.ImagePickerAsset[],
): ImagePicker.ImagePickerAsset[] {
  const seen = new Set<string>();
  const out: ImagePicker.ImagePickerAsset[] = [];
  let images = 0;
  let videos = 0;
  for (const a of list) {
    if (seen.has(a.uri)) continue;
    if (isVideoAsset(a)) {
      if (videos >= MAX_VIDEOS) continue;
      videos += 1;
    } else {
      if (images >= MAX_PHOTOS) continue;
      images += 1;
    }
    seen.add(a.uri);
    out.push(a);
  }
  return out;
}

/**
 * Move one media item by a single position (-1 = toward the front/cover, +1 =
 * toward the end), returning a NEW array. Out-of-range moves are no-ops so the
 * caller can wire boundary-clamped buttons without extra guards. Captions are
 * keyed by the stable asset uri, so reordering never disturbs them, and because
 * the card cover is "first image", moving an image to the front re-selects the
 * cover for free.
 */
export function moveMediaItem<T>(list: T[], index: number, dir: -1 | 1): T[] {
  const target = index + dir;
  if (index < 0 || index >= list.length) return list;
  if (target < 0 || target >= list.length) return list;
  const next = list.slice();
  const [item] = next.splice(index, 1);
  next.splice(target, 0, item);
  return next;
}

export type PickPartition = {
  accepted: ImagePicker.ImagePickerAsset[];
  rejectedLong: boolean;
  rejectedBig: boolean;
};

/**
 * Split freshly-picked assets into the ones we accept vs. the videos rejected
 * for being too long or too large. `videoMaxDuration` only caps in-app capture,
 * and a presigned PUT can't enforce size server-side, so library picks must be
 * validated here. Images always pass — only their COUNT is capped (by capMedia).
 * `duration` is milliseconds.
 */
export function partitionPickedAssets(
  assets: ImagePicker.ImagePickerAsset[],
): PickPartition {
  const accepted: ImagePicker.ImagePickerAsset[] = [];
  let rejectedLong = false;
  let rejectedBig = false;
  for (const a of assets) {
    if (isVideoAsset(a)) {
      if ((a.duration ?? 0) > MAX_VIDEO_SECONDS * 1000) {
        rejectedLong = true;
        continue;
      }
      if ((a.fileSize ?? 0) > MAX_VIDEO_BYTES) {
        rejectedBig = true;
        continue;
      }
    }
    accepted.push(a);
  }
  return { accepted, rejectedLong, rejectedBig };
}

export type ListingPreviewMedia = {
  type: "image" | "video";
  url: string;
  thumbnail_url?: string | null;
  is_thumbnail?: boolean;
};

/** Client-side feed/card preview URL — never a raw video file. */
export function pickListingPreviewUrl(
  media: ListingPreviewMedia[] | null | undefined,
): string {
  if (!media?.length) return "";
  const sorted = [...media].sort((a, b) => {
    const aCover = a.is_thumbnail === true;
    const bCover = b.is_thumbnail === true;
    if (aCover !== bCover) return aCover ? -1 : 1;
    return 0;
  });
  const cover = sorted.find((m) => m.is_thumbnail && m.type === "image");
  const firstImage = sorted.find((m) => m.type === "image");
  const videoPoster = sorted.find(
    (m) => m.type === "video" && m.thumbnail_url,
  );
  return (
    cover?.url ??
    firstImage?.url ??
    videoPoster?.thumbnail_url ??
    ""
  );
}
