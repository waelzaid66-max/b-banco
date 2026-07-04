import { Router } from "express";
import {
  createListingHandler,
  getListingsHandler,
  getListingHandler,
  updateListingHandler,
  deleteListingHandler,
  getSimilarHandler,
  getListingInsightsHandler,
  createListingLinkHandler,
  bumpListingHandler,
} from "../../controllers/listingController";
import {
  getCommentsHandler,
  createCommentHandler,
  deleteCommentHandler,
} from "../../controllers/commentController";
import { requireAuth, optionalAuth } from "../../middlewares/authGuard";
import { writeRateLimiter, publicRateLimiter } from "../../middlewares/rateLimiter";

const router = Router();

router.get("/", publicRateLimiter, getListingsHandler);
router.post("/", writeRateLimiter, requireAuth, createListingHandler);
router.get("/:id", publicRateLimiter, optionalAuth, getListingHandler);
router.patch("/:id", writeRateLimiter, requireAuth, updateListingHandler);
router.delete("/:id", writeRateLimiter, requireAuth, deleteListingHandler);
router.get("/:id/similar", publicRateLimiter, getSimilarHandler);
router.get("/:id/insights", publicRateLimiter, getListingInsightsHandler);
router.post("/:id/links", writeRateLimiter, requireAuth, createListingLinkHandler);
router.post("/:id/bump", writeRateLimiter, requireAuth, bumpListingHandler);
router.get("/:id/comments", publicRateLimiter, getCommentsHandler);
router.post("/:id/comments", writeRateLimiter, requireAuth, createCommentHandler);
router.delete(
  "/:id/comments/:commentId",
  writeRateLimiter,
  requireAuth,
  deleteCommentHandler
);

export default router;
