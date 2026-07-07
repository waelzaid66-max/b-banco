import type { Request, Response } from "express";
import { z, ZodError } from "zod";
import {
  successResponse,
  errorResponse,
  validateResponse,
  InvoiceSchema,
  BillingInvoicesQuerySchema,
  BillingReportQuerySchema,
  BillingReportSchema,
} from "../validators/schemas";
import {
  listInvoices,
  getInvoice,
  getBillingReport,
} from "../services/BillingService";
import { buildInvoicePdf } from "../lib/invoicePdf";
import { billingReportToCsv } from "../lib/billingCsv";

function handleError(res: Response, err: unknown, fallback: string, tag: string) {
  if (err instanceof ZodError) {
    return res
      .status(400)
      .json(errorResponse("INVALID_DATA", err.errors[0]?.message ?? "Invalid data"));
  }
  const e = err as { code?: string; message?: string };
  if (e.code === "INVALID_DATA")
    return res.status(400).json(errorResponse("INVALID_DATA", e.message ?? "Invalid data"));
  if (e.code === "NOT_FOUND")
    return res.status(404).json(errorResponse("NOT_FOUND", e.message ?? "Not found"));
  if (e.code === "UNAUTHORIZED")
    return res.status(401).json(errorResponse("UNAUTHORIZED", e.message ?? "Unauthorized"));
  console.error(tag, err);
  return res.status(500).json(errorResponse("INTERNAL_ERROR", fallback));
}

export async function listInvoicesHandler(req: Request, res: Response) {
  try {
    const query = BillingInvoicesQuerySchema.parse(req.query);
    const page = await listInvoices(req.dbUserId!, {
      limit: query.limit,
      cursor: query.cursor,
    });
    const validated = validateResponse(InvoiceSchema.array(), page.items);
    return res.json(
      successResponse(validated, { cursor: page.cursor, has_next: page.hasNext })
    );
  } catch (err) {
    return handleError(res, err, "Failed to load invoices", "[Billing invoices]");
  }
}

export async function getInvoiceHandler(req: Request, res: Response) {
  try {
    const invoiceId = z.string().uuid().parse(req.params.id);
    const invoice = await getInvoice(req.dbUserId!, invoiceId);
    const validated = validateResponse(InvoiceSchema, invoice);
    return res.json(successResponse(validated));
  } catch (err) {
    return handleError(res, err, "Failed to load invoice", "[Billing invoice]");
  }
}

export async function getBillingReportHandler(req: Request, res: Response) {
  try {
    const query = BillingReportQuerySchema.parse(req.query);
    const report = await getBillingReport(req.dbUserId!, { month: query.month });
    const validated = validateResponse(BillingReportSchema, report);
    return res.json(successResponse(validated));
  } catch (err) {
    return handleError(res, err, "Failed to load billing report", "[Billing report]");
  }
}

export async function getInvoicePdfHandler(req: Request, res: Response) {
  try {
    const invoiceId = z.string().uuid().parse(req.params.id);
    const invoice = await getInvoice(req.dbUserId!, invoiceId);
    const pdf = buildInvoicePdf(invoice);
    const safeName = invoice.invoice_number.replace(/[^\w.-]+/g, "_");
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="invoice-${safeName}.pdf"`,
    );
    return res.send(pdf);
  } catch (err) {
    return handleError(res, err, "Failed to export invoice PDF", "[Billing invoice PDF]");
  }
}

export async function getBillingReportCsvHandler(req: Request, res: Response) {
  try {
    const query = BillingReportQuerySchema.parse(req.query);
    const report = await getBillingReport(req.dbUserId!, { month: query.month });
    const csv = billingReportToCsv(report);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="banco-billing-${report.month}.csv"`,
    );
    return res.send(csv);
  } catch (err) {
    return handleError(res, err, "Failed to export billing CSV", "[Billing report CSV]");
  }
}
