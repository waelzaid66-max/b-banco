import {
  cacheDirectory,
  EncodingType,
  writeAsStringAsync,
} from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { getBillingReportCsv, getInvoicePdf } from "@workspace/api-client-react";
import { Platform, Share } from "react-native";

function currentMonthUtc(): string {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

async function blobToBase64(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  let binary = "";
  const bytes = new Uint8Array(buffer);
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function downloadOnWeb(blob: Blob, filename: string, mime: string) {
  const url = URL.createObjectURL(new Blob([blob], { type: mime }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

async function shareFileNative(path: string, mimeType: string) {
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(path, { mimeType });
    return;
  }
  await Share.share({ url: path });
}

export async function downloadInvoicePdf(invoiceId: string, invoiceNumber: string) {
  const blob = await getInvoicePdf(invoiceId);
  const filename = `invoice-${invoiceNumber.replace(/[^\w.-]+/g, "_")}.pdf`;

  if (Platform.OS === "web") {
    downloadOnWeb(blob, filename, "application/pdf");
    return;
  }

  const base64 = await blobToBase64(blob);
  const path = `${cacheDirectory ?? ""}${filename}`;
  await writeAsStringAsync(path, base64, {
    encoding: EncodingType.Base64,
  });
  await shareFileNative(path, "application/pdf");
}

export async function exportBillingReportCsv(month?: string) {
  const query = month ?? currentMonthUtc();
  const csv = await getBillingReportCsv({ month: query });
  const filename = `banco-billing-${query}.csv`;

  if (Platform.OS === "web") {
    downloadOnWeb(new Blob([csv], { type: "text/csv" }), filename, "text/csv");
    return;
  }

  const path = `${cacheDirectory ?? ""}${filename}`;
  await writeAsStringAsync(path, csv, {
    encoding: EncodingType.UTF8,
  });
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(path, { mimeType: "text/csv" });
  } else {
    await Share.share({ message: csv });
  }
}
