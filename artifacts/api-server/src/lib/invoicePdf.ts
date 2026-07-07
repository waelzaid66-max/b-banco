import type { InvoiceItem } from "../services/BillingService";

function pdfEscape(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)")
    .replace(/[^\x20-\x7E]/g, "?");
}

function buildTextStream(lines: string[]): string {
  const cmds = ["BT", "/F1 11 Tf", "1 0 0 1 50 760 Tm"];
  for (let i = 0; i < lines.length; i++) {
    if (i > 0) cmds.push("0 -16 Td");
    cmds.push(`(${pdfEscape(lines[i])}) Tj`);
  }
  cmds.push("ET");
  return cmds.join("\n");
}

/** Minimal PDF 1.4 invoice (Helvetica, ASCII-safe). */
export function buildInvoicePdf(invoice: InvoiceItem): Buffer {
  const issued = (invoice.issued_at ?? invoice.created_at ?? new Date().toISOString()).slice(
    0,
    10,
  );
  const lines = [
    "Banco Store",
    `Invoice: ${invoice.invoice_number}`,
    `Date: ${issued}`,
    `Status: ${invoice.status}`,
    `Total: ${invoice.amount} EGP`,
  ];
  if (invoice.description) lines.push(`Description: ${invoice.description}`);
  if (invoice.transaction_type) lines.push(`Type: ${invoice.transaction_type}`);
  for (const li of invoice.line_items ?? []) {
    lines.push(`${li.label}: ${li.amount} EGP`);
  }

  const stream = buildTextStream(lines);
  const streamLen = Buffer.byteLength(stream, "utf8");

  const objects = [
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
    `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n`,
    `4 0 obj\n<< /Length ${streamLen} >>\nstream\n${stream}\nendstream\nendobj\n`,
    "5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n",
  ];

  let body = "";
  const offsets: number[] = [0];
  for (const obj of objects) {
    offsets.push(Buffer.byteLength(body, "utf8"));
    body += obj;
  }

  const xrefStart = Buffer.byteLength(body, "utf8");
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i < offsets.length; i++) {
    xref += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  const trailer = `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;

  return Buffer.from(`%PDF-1.4\n${body}${xref}${trailer}`, "utf8");
}
