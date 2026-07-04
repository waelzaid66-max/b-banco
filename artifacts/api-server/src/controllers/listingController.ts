import type { Request, Response } from "express";
import {
  createListing,
  getListingDetail,
  getPublicListings,
  updateListing,
  deleteListing,
  bumpListing,
} from "../services/ListingService";
import { getSimilarListings } from "../services/SearchService";
import { getListingDealInsights } from "../services/MarketInsightsService";
import { createLink } from "../services/ListingLinkService";
import { incrementView } from "../services/LeadService";
import { isSaved } from "../services/SaveService";
import {
  CreateListingSchema,
  FeedItemSchema,
  ListingDetailSchema,
  successResponse,
  errorResponse,
  validateResponse,
  CreateListingResultSchema,
  UpdateListingSchema,
  UpdateListingResultSchema,
  DeleteListingResultSchema,
  PublicListingsQuerySchema,
  CreateListingLinkSchema,
  CreateListingLinkResultSchema,
  BumpListingResultSchema,
  DealInsightsSchema,
} from "../validators/schemas";
import { MEDIA_VERIFY_RETRYABLE } from "../lib/mediaVerify";
import { ZodError } from "zod";

export async function createListingHandler(req: Request, res: Response) {
  try {
    const input = CreateListingSchema.parse(req.body);
    const result = await createListing(input, req.userId!, { ip: req.ip });
    const validated = validateResponse(CreateListingResultSchema, result);
    return res.status(201).json(successResponse(validated));
  } catch (err) {
    if (err instanceof ZodError) {
      return res.status(400).json(errorResponse("INVALID_DATA", err.errors[0]?.message ?? "Invalid data"));
    }
    const e = err as { code?: string; message?: string };
    if (e.code === "INVALID_DATA") return res.status(400).json(errorResponse("INVALID_DATA", e.message ?? "Invalid data"));
    if (e.code === "UNAUTHORIZED") return res.status(401).json(errorResponse("UNAUTHORIZED", e.message ?? "Unauthorized"));
    if (e.code === "RATE_LIMITED") return res.status(429).json(errorResponse("INVALID_DATA", e.message ?? "Too many requests"));
    // Transient storage-verification failure: the upload may well be valid, so
    // ask the client to retry (503) instead of discarding the listing as invalid.
    if (e.code === MEDIA_VERIFY_RETRYABLE) {
      return res.status(503).json(errorResponse("INTERNAL_ERROR", e.message ?? "Storage verification temporarily unavailable. Please try again."));
    }
    console.error("[Listing create]", err);
    return res.status(500).json(errorResponse("INTERNAL_ERROR", "Failed to create listing"));
  }
}

export async function getListingsHandler(req: Request, res: Response) {
  try {
    const query = PublicListingsQuerySchema.parse(req.query);
    const result = await getPublicListings(query);
    const validated = validateResponse(FeedItemSchema.array(), result.items);
    return res.json(successResponse(validated, { cursor: result.cursor, has_next: result.has_next }));
  } catch (err) {
    if (err instanceof ZodError) {
      return res.status(400).json(errorResponse("INVALID_DATA", err.errors[0]?.message ?? "Invalid query"));
    }
    console.error("[Listings list]", err);
    return res.status(500).json(errorResponse("INTERNAL_ERROR", "Failed to load listings"));
  }
}

export async function getListingHandler(req: Request, res: Response) {
  try {
    const id = req.params.id as string;
    const listing = await getListingDetail(id, req.userId);
    if (!listing) return res.status(404).json(errorResponse("NOT_FOUND", "Listing not found"));

    if (req.userId) {
      try {
        listing.is_saved = await isSaved(req.userId, id);
      } catch {}
    }

    incrementView(id, req.ip);

    const validated = validateResponse(ListingDetailSchema, listing);
    return res.json(successResponse(validated));
  } catch (err) {
    console.error("[Listing get]", err);
    return res.status(500).json(errorResponse("INTERNAL_ERROR", "Failed to load listing"));
  }
}

export async function updateListingHandler(req: Request, res: Response) {
  try {
    const id = req.params.id as string;
    const input = UpdateListingSchema.parse(req.body);
    const result = await updateListing(id, req.userId!, input);
    const validated = validateResponse(UpdateListingResultSchema, result);
    return res.json(successResponse(validated));
  } catch (err) {
    if (err instanceof ZodError) {
      return res.status(400).json(errorResponse("INVALID_DATA", err.errors[0]?.message ?? "Invalid data"));
    }
    const e = err as { code?: string; message?: string };
    if (e.code === "NOT_FOUND") return res.status(404).json(errorResponse("NOT_FOUND", e.message ?? "Not found"));
    if (e.code === "UNAUTHORIZED") return res.status(401).json(errorResponse("UNAUTHORIZED", e.message ?? "Unauthorized"));
    console.error("[Listing update]", err);
    return res.status(500).json(errorResponse("INTERNAL_ERROR", "Failed to update listing"));
  }
}

export async function deleteListingHandler(req: Request, res: Response) {
  try {
    const id = req.params.id as string;
    const result = await deleteListing(id, req.userId!);
    const validated = validateResponse(DeleteListingResultSchema, result);
    return res.json(successResponse(validated));
  } catch (err) {
    const e = err as { code?: string; message?: string };
    if (e.code === "NOT_FOUND") return res.status(404).json(errorResponse("NOT_FOUND", e.message ?? "Not found"));
    if (e.code === "UNAUTHORIZED") return res.status(401).json(errorResponse("UNAUTHORIZED", e.message ?? "Unauthorized"));
    console.error("[Listing delete]", err);
    return res.status(500).json(errorResponse("INTERNAL_ERROR", "Failed to delete listing"));
  }
}

export async function getSimilarHandler(req: Request, res: Response) {
  try {
    const id = req.params.id as string;
    const items = await getSimilarListings(id, 10);
    const validated = validateResponse(FeedItemSchema.array(), items);
    return res.json(successResponse(validated, { total: validated.length }));
  } catch (err) {
    console.error("[Similar]", err);
    return res.status(500).json(errorResponse("INTERNAL_ERROR", "Failed to load similar listings"));
  }
}

// GET /v1/listings/:id/insights — deal rating + market insights for a listing.
// Read-only, public: how this price compares to its market segment. Honest by
// design (insufficient_data below a real-sample threshold; never fabricated).
export async function getListingInsightsHandler(req: Request, res: Response) {
  try {
    const id = req.params.id as string;
    const insights = await getListingDealInsights(id);
    if (!insights) {
      return res.status(404).json(errorResponse("NOT_FOUND", "Listing not found"));
    }
    const validated = validateResponse(DealInsightsSchema, insights);
    return res.json(successResponse(validated));
  } catch (err) {
    console.error("[Insights]", err);
    return res.status(500).json(errorResponse("INTERNAL_ERROR", "Failed to load insights"));
  }
}

// POST /v1/listings/:id/bump — recycle/renew a listing to the top of recency
// feeds. Owner-scoped + cooldown enforced in the service. Never alters created_at.
export async function bumpListingHandler(req: Request, res: Response) {
  try {
    const id = req.params.id as string;
    const result = await bumpListing(req.userId!, id);
    const validated = validateResponse(BumpListingResultSchema, result);
    return res.json(successResponse(validated));
  } catch (err) {
    const e = err as { code?: string; message?: string };
    if (e.code === "UNAUTHORIZED") return res.status(401).json(errorResponse("UNAUTHORIZED", e.message ?? "Unauthorized"));
    if (e.code === "FORBIDDEN") return res.status(403).json(errorResponse("FORBIDDEN", e.message ?? "Forbidden"));
    if (e.code === "NOT_FOUND") return res.status(404).json(errorResponse("NOT_FOUND", e.message ?? "Not found"));
    if (e.code === "RATE_LIMITED") return res.status(429).json(errorResponse("INVALID_DATA", e.message ?? "Recycled too recently"));
    console.error("[Listing bump]", err);
    return res.status(500).json(errorResponse("INTERNAL_ERROR", "Failed to recycle listing"));
  }
}

// POST /v1/listings/:id/links — connect this listing (the edge source) to
// another in the supply-chain graph. Owner-guarded inside the service.
export async function createListingLinkHandler(req: Request, res: Response) {
  try {
    const id = req.params.id as string;
    const input = CreateListingLinkSchema.parse(req.body);
    const result = await createLink(id, input.relation, input.to_listing_id, req.userId!);
    const validated = validateResponse(CreateListingLinkResultSchema, result);
    return res.status(201).json(successResponse(validated));
  } catch (err) {
    if (err instanceof ZodError) {
      return res.status(400).json(errorResponse("INVALID_DATA", err.errors[0]?.message ?? "Invalid data"));
    }
    const e = err as { code?: string; message?: string };
    if (e.code === "INVALID_DATA") return res.status(400).json(errorResponse("INVALID_DATA", e.message ?? "Invalid data"));
    if (e.code === "UNAUTHORIZED") return res.status(401).json(errorResponse("UNAUTHORIZED", e.message ?? "Unauthorized"));
    if (e.code === "FORBIDDEN") return res.status(403).json(errorResponse("UNAUTHORIZED", e.message ?? "Forbidden"));
    if (e.code === "NOT_FOUND") return res.status(404).json(errorResponse("NOT_FOUND", e.message ?? "Not found"));
    console.error("[Listing link]", err);
    return res.status(500).json(errorResponse("INTERNAL_ERROR", "Failed to link listing"));
  }
}
