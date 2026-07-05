import type { Request, Response } from "express";
import { Readable } from "stream";
import { and, eq, like, or } from "drizzle-orm";
import { db } from "@workspace/db";
import { listingMedia, listings, users } from "@workspace/db/schema";
import { ObjectNotFoundError } from "../lib/objectStorage";
import { getObjectStorageService } from "../lib/objectStorageProvider";
import { publicVisibilityConditions } from "../lib/feedVisibility";
import {
  successResponse,
  errorResponse,
  validateResponse,
  UploadUrlResultSchema,
  PromoteUploadBodySchema,
  PromoteUploadResultSchema,
  VerifyUploadBodySchema,
  VerifyUploadResultSchema,
} from "../validators/schemas";
import { MAX_IMAGE_BYTES, MAX_VIDEO_BYTES } from "../services/ListingService";
import { MEDIA_VERIFY_RETRYABLE } from "../lib/mediaVerify";

/**
 * MIME types that may be served inline from the BANCO origin.
 * Excludes anything a browser can execute or render as markup:
 * text/html, text/javascript, application/javascript, image/svg+xml, etc.
 */
const ALLOWED_CONTENT_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/avif",
  "image/heic",
  "image/heif",
  "video/mp4",
  "video/webm",
  "video/ogg",
  "video/quicktime",
  "audio/mpeg",
  "audio/ogg",
  "audio/wav",
  "audio/webm",
  "application/pdf",
]);

const UPLOADS_PATH_PREFIX = "/api/v1/uploads/objects/";

const objectStorageService = getObjectStorageService();

/**
 * Returns true if the given wildcardPath (the path segment after
 * /api/v1/uploads/objects/) is referenced by a media row on a live, publicly
 * visible listing.  Used as a backward-compatibility fallback for objects that
 * pre-date the ACL-metadata scheme so existing listing photos keep working.
 *
 * The URL match is suffix-based (%/api/v1/uploads/objects/<wildcardPath>) so
 * it works regardless of what host/protocol prefix was stored at listing-
 * creation time.
 */
async function isLegacyListingMedia(wildcardPath: string): Promise<boolean> {
  const urlSuffix = `%${UPLOADS_PATH_PREFIX}${wildcardPath}`;
  const [row] = await db
    .select({ id: listingMedia.id })
    .from(listingMedia)
    .innerJoin(listings, eq(listingMedia.listingId, listings.id))
    .innerJoin(users, eq(listings.userId, users.id))
    .where(
      and(
        eq(listings.status, "active"),
        or(
          like(listingMedia.url, urlSuffix),
          like(listingMedia.thumbnailUrl, urlSuffix)
        ),
        ...publicVisibilityConditions()
      )
    )
    .limit(1);
  return row !== undefined;
}

/**
 * POST /v1/uploads/request-url
 *
 * Returns a presigned PUT URL for the client to upload a file directly to
 * object storage, plus the persistent public serving URL to store on the
 * listing media record. The client sends JSON metadata only — never the file.
 */
export async function requestUploadUrlHandler(req: Request, res: Response): Promise<Response> {
  try {
    const uploadURL = await objectStorageService.getObjectEntityUploadURL();
    const objectPath = objectStorageService.normalizeObjectEntityPath(uploadURL);

    const servingPath = `${UPLOADS_PATH_PREFIX}${objectPath.replace(/^\/objects\//, "")}`;
    const proto =
      (req.headers["x-forwarded-proto"] as string | undefined)?.split(",")[0]?.trim() ||
      req.protocol;
    const host = (req.headers["x-forwarded-host"] as string | undefined) || req.get("host");
    const url = `${proto}://${host}${servingPath}`;

    const result = validateResponse(UploadUrlResultSchema, {
      upload_url: uploadURL,
      object_path: objectPath,
      url,
    });

    return res.status(200).json(successResponse(result));
  } catch (error) {
    req.log.error({ err: error }, "Error generating upload URL");
    return res
      .status(500)
      .json(errorResponse("INTERNAL_ERROR", "Failed to generate upload URL"));
  }
}

/**
 * GET /v1/uploads/objects/*path
 *
 * Serves uploaded listing media.  Access is permitted only when:
 *   (a) the object carries a public ACL policy (set at listing-creation time
 *       via promoteServingUrlToPublic), OR
 *   (b) the object is referenced by an active, publicly-visible listing
 *       (backward-compatibility fallback for objects that pre-date ACL
 *       metadata — these are already owned listing assets, not free uploads).
 *
 * The content-type of the stored object is validated against an explicit
 * allowlist before streaming so that attacker-uploaded HTML or JavaScript
 * cannot be executed from this origin even if the object somehow became
 * accessible.  X-Content-Type-Options: nosniff is also set.
 */
export async function serveObjectHandler(req: Request, res: Response): Promise<void> {
  try {
    const raw = (req.params as Record<string, unknown>).path;
    const wildcardPath = Array.isArray(raw) ? raw.join("/") : String(raw ?? "");
    const objectPath = `/objects/${wildcardPath}`;
    const objectFile = await objectStorageService.getObjectEntityFile(objectPath);

    const canAccess = await objectStorageService.canAccessObjectEntity({
      userId: req.userId,
      objectFile,
    });

    if (!canAccess) {
      const legacy = await isLegacyListingMedia(wildcardPath);
      if (!legacy) {
        res.status(403).json(errorResponse("FORBIDDEN", "Access denied"));
        return;
      }
    }

    const response = await objectStorageService.downloadObject(objectFile);

    const rawContentType = response.headers.get("Content-Type") ?? "application/octet-stream";
    const contentType = rawContentType.split(";")[0].trim().toLowerCase();

    if (!ALLOWED_CONTENT_TYPES.has(contentType)) {
      req.log.warn({ contentType, path: wildcardPath }, "Blocked object serve: disallowed content type");
      res.status(403).json(errorResponse("FORBIDDEN", "File type not permitted"));
      return;
    }

    res.status(response.status);
    response.headers.forEach((value, key) => {
      if (key.toLowerCase() === "content-type") return;
      res.setHeader(key, value);
    });
    res.setHeader("Content-Type", contentType);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "public, max-age=86400");

    if (response.body) {
      const nodeStream = Readable.fromWeb(response.body as ReadableStream<Uint8Array>);
      nodeStream.pipe(res);
    } else {
      res.end();
    }
  } catch (error) {
    if (error instanceof ObjectNotFoundError) {
      res.status(404).json(errorResponse("NOT_FOUND", "Object not found"));
      return;
    }
    req.log.error({ err: error }, "Error serving object");
    res.status(500).json(errorResponse("INTERNAL_ERROR", "Failed to serve object"));
  }
}

/**
 * POST /v1/uploads/promote
 *
 * Promotes a previously-uploaded, first-party image object to a public ACL so it
 * can be served by serveObjectHandler without auth. Used for media that is
 * attached outside listing creation (profile covers, company logos, chat images)
 * where there is no other server hook to promote on attach.
 *
 * Hardening: requires auth (route), accepts ONLY our own /api/v1/uploads/objects/
 * serving URLs, only image content types, enforces MAX_IMAGE_BYTES from the
 * AUTHORITATIVE stored metadata, and promoteServingUrlToPublic refuses objects
 * already owned by a different user. Fresh uploads carry no ACL, so the uploader
 * (this caller) becomes the owner.
 */
export async function promoteUploadHandler(req: Request, res: Response): Promise<Response> {
  const parsed = PromoteUploadBodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res
      .status(400)
      .json(errorResponse("INVALID_DATA", "A valid upload url is required"));
  }
  const ownerId = req.userId;
  if (!ownerId) {
    return res.status(401).json(errorResponse("UNAUTHORIZED", "Authentication required"));
  }

  const { url } = parsed.data;
  try {
    const meta = await objectStorageService.getServingObjectMetadata(url);
    if (!meta) {
      return res
        .status(400)
        .json(errorResponse("INVALID_DATA", "Not a first-party upload URL"));
    }
    const contentType = (meta.contentType ?? "").toLowerCase();
    if (!contentType.startsWith("image/")) {
      return res
        .status(400)
        .json(errorResponse("INVALID_DATA", "Only image uploads can be promoted"));
    }
    if (meta.size == null || meta.size > MAX_IMAGE_BYTES) {
      const maxMb = Math.round(MAX_IMAGE_BYTES / (1024 * 1024));
      return res
        .status(400)
        .json(
          errorResponse("INVALID_DATA", `Image exceeds the maximum allowed size of ${maxMb} MB`)
        );
    }

    await objectStorageService.promoteServingUrlToPublic(url, ownerId);

    const result = validateResponse(PromoteUploadResultSchema, { url, promoted: true });
    return res.status(200).json(successResponse(result));
  } catch (error) {
    if (error instanceof ObjectNotFoundError) {
      return res.status(404).json(errorResponse("NOT_FOUND", "Upload not found"));
    }
    req.log.error({ err: error }, "Error promoting upload");
    return res
      .status(500)
      .json(errorResponse("INTERNAL_ERROR", "Failed to promote upload"));
  }
}

/**
 * POST /v1/uploads/verify
 *
 * READ-ONLY pre-publish confirmation that a previously-uploaded first-party
 * object actually landed in storage with an allowed kind (image|video) and
 * within the size cap, using the AUTHORITATIVE stored metadata (never the
 * client-declared type). Mirrors the validation in promote/createListing but
 * never mutates ACLs — the client calls it per asset so Publish is only enabled
 * once every asset is confirmed stored.
 *
 * A missing object is permanent (404 → re-upload); a transient storage read
 * failure returns 503 so the client retries instead of discarding a valid asset.
 */
export async function verifyUploadHandler(req: Request, res: Response): Promise<Response> {
  const parsed = VerifyUploadBodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res
      .status(400)
      .json(errorResponse("INVALID_DATA", "A valid upload url is required"));
  }
  if (!req.userId) {
    return res.status(401).json(errorResponse("UNAUTHORIZED", "Authentication required"));
  }

  const { url } = parsed.data;
  try {
    const meta = await objectStorageService.getServingObjectMetadata(url);
    if (!meta) {
      return res
        .status(400)
        .json(errorResponse("INVALID_DATA", "Not a first-party upload URL"));
    }
    const contentType = (meta.contentType ?? "").toLowerCase();
    const isImage = contentType.startsWith("image/");
    const isVideo = contentType.startsWith("video/");
    if (!isImage && !isVideo) {
      return res
        .status(400)
        .json(errorResponse("INVALID_DATA", "Unsupported media type"));
    }
    // Size is always present for a real GCS object; a missing size means we can't
    // prove it's within limit, so fail closed (consistent with the create gate).
    if (meta.size == null) {
      return res
        .status(400)
        .json(
          errorResponse(
            "INVALID_DATA",
            "Could not verify uploaded media. Please re-upload and try again."
          )
        );
    }
    const maxBytes = isImage ? MAX_IMAGE_BYTES : MAX_VIDEO_BYTES;
    if (meta.size > maxBytes) {
      const maxMb = Math.round(maxBytes / (1024 * 1024));
      const kind = isImage ? "Image" : "Video";
      return res
        .status(400)
        .json(
          errorResponse("INVALID_DATA", `${kind} exceeds the maximum allowed size of ${maxMb} MB`)
        );
    }

    const result = validateResponse(VerifyUploadResultSchema, {
      url,
      ok: true,
      type: isImage ? "image" : "video",
      content_type: contentType,
      size: meta.size,
    });
    return res.status(200).json(successResponse(result));
  } catch (error) {
    if (error instanceof ObjectNotFoundError) {
      return res.status(404).json(errorResponse("NOT_FOUND", "Upload not found"));
    }
    if ((error as { code?: string } | null)?.code === MEDIA_VERIFY_RETRYABLE) {
      return res
        .status(503)
        .json(
          errorResponse(
            "INTERNAL_ERROR",
            "Storage verification temporarily unavailable. Please try again."
          )
        );
    }
    req.log.error({ err: error }, "Error verifying upload");
    return res
      .status(500)
      .json(errorResponse("INTERNAL_ERROR", "Failed to verify upload"));
  }
}
