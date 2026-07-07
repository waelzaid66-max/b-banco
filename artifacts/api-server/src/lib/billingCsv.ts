import type { BillingReport } from "../services/BillingService";

function csvCell(value: string | number): string {
  const s = String(value);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function billingReportToCsv(report: BillingReport): string {
  const lines = [
    `month,${csvCell(report.month)}`,
    `currency,${csvCell(report.currency)}`,
    `total_charged,${csvCell(report.total_charged)}`,
    `total_topped_up,${csvCell(report.total_topped_up)}`,
    `transaction_count,${csvCell(report.transaction_count)}`,
    "",
    "type,total,count",
    ...report.by_type.map(
      (row) => `${csvCell(row.type)},${csvCell(row.total)},${csvCell(row.count)}`,
    ),
  ];
  return `${lines.join("\n")}\n`;
}
