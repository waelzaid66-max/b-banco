import type { Request, Response } from "express";
import { ZodError } from "zod";
import { listBookings, updateBookingStatus } from "../services/BookingService";
import {
  BookingListItemSchema,
  BookingSchema,
  ListBookingsQuerySchema,
  UpdateBookingSchema,
  successResponse,
  errorResponse,
  validateResponse,
} from "../validators/schemas";

// GET /v1/bookings?role=guest|host — the signed-in user's bookings from one side.
export async function listBookingsHandler(req: Request, res: Response) {
  try {
    const { role } = ListBookingsQuerySchema.parse(req.query);
    const items = await listBookings(req.userId!, role);
    const validated = validateResponse(BookingListItemSchema.array(), items);
    return res.json(successResponse(validated, { total: validated.length }));
  } catch (err) {
    if (err instanceof ZodError) {
      return res.status(400).json(errorResponse("INVALID_DATA", "Invalid query"));
    }
    const code = (err as { code?: string })?.code;
    if (code === "UNAUTHORIZED") {
      return res.status(401).json(errorResponse("UNAUTHORIZED", "Unauthorized"));
    }
    console.error("[Bookings list]", err);
    return res.status(500).json(errorResponse("INTERNAL_ERROR", "Failed to load bookings"));
  }
}

// PATCH /v1/bookings/:id — confirm/reject (host) or cancel (guest).
export async function updateBookingHandler(req: Request, res: Response) {
  try {
    const id = req.params.id as string;
    const { action } = UpdateBookingSchema.parse(req.body);
    const booking = await updateBookingStatus(req.userId!, id, action);
    const validated = validateResponse(BookingSchema, booking);
    return res.json(successResponse(validated));
  } catch (err) {
    if (err instanceof ZodError) {
      return res.status(422).json(errorResponse("INVALID_DATA", "Invalid action"));
    }
    const code = (err as { code?: string })?.code;
    const msg = (err as Error)?.message ?? "Update failed";
    if (code === "NOT_FOUND") return res.status(404).json(errorResponse("NOT_FOUND", msg));
    if (code === "FORBIDDEN") return res.status(403).json(errorResponse("FORBIDDEN", msg));
    if (code === "INVALID_DATA") return res.status(422).json(errorResponse("INVALID_DATA", msg));
    if (code === "UNAUTHORIZED") return res.status(401).json(errorResponse("UNAUTHORIZED", msg));
    console.error("[Booking update]", err);
    return res.status(500).json(errorResponse("INTERNAL_ERROR", "Failed to update booking"));
  }
}
