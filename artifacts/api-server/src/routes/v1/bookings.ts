import { Router } from "express";
import {
  listBookingsHandler,
  updateBookingHandler,
} from "../../controllers/bookingController";
import { requireAuth } from "../../middlewares/authGuard";
import { writeRateLimiter, publicRateLimiter } from "../../middlewares/rateLimiter";

const router = Router();

// Both sides of a person's booking inbox, and the lifecycle transitions.
router.get("/", publicRateLimiter, requireAuth, listBookingsHandler);
router.patch("/:id", writeRateLimiter, requireAuth, updateBookingHandler);

export default router;
