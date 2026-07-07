import { Router } from "express";
import {
  listInvoicesHandler,
  getInvoiceHandler,
  getInvoicePdfHandler,
  getBillingReportHandler,
  getBillingReportCsvHandler,
} from "../../controllers/billingController";
import { requireAuth, requireDbUser } from "../../middlewares/authGuard";
import { publicRateLimiter } from "../../middlewares/rateLimiter";

const router = Router();

router.get(
  "/invoices",
  publicRateLimiter,
  requireAuth,
  requireDbUser,
  listInvoicesHandler
);
router.get(
  "/invoices/:id/pdf",
  publicRateLimiter,
  requireAuth,
  requireDbUser,
  getInvoicePdfHandler
);
router.get(
  "/invoices/:id",
  publicRateLimiter,
  requireAuth,
  requireDbUser,
  getInvoiceHandler
);
router.get(
  "/report",
  publicRateLimiter,
  requireAuth,
  requireDbUser,
  getBillingReportHandler
);
router.get(
  "/report.csv",
  publicRateLimiter,
  requireAuth,
  requireDbUser,
  getBillingReportCsvHandler
);

export default router;
