import { PDFDocument, StandardFonts, rgb } from "npm:pdf-lib@1.17.1";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { RECEIPT_HEADER_BASE64 } from "./embedded-receipt-header.ts";

export type ReceiptDispatchStatus = "pending" | "processing" | "sent" | "failed";

export interface ReceiptDispatchRow {
  id: string;
  entry_id: string;
  receipt_no: string;
  payer_email: string | null;
  status: ReceiptDispatchStatus;
  attempt_count: number;
  last_error: string | null;
  provider_message_id: string | null;
}

interface ReceiptMember {
  full_name: string | null;
  age: number | null;
  gender: string | null;
  gotra: string | null;
  other_gotra?: string | null;
  amount: number | null;
  is_primary_payer: boolean | null;
}

interface ReceiptPayload {
  entryId: string;
  receiptNo: string;
  fy: string;
  entryType: string;
  paidBy: string;
  referenceNo: string | null;
  submittedAt: string | null;
  acknowledgedAt: string | null;
  submittedBy: string | null;
  acknowledgedBy: string | null;
  payerEmail: string;
  payerMobile: string | null;
  payerName: string;
  address: string | null;
  sabhaName: string;
  sabhaCode: string | null;
  optShowAmountInDirectory: "Yes" | "No";
  optShowMobileInDirectory: "Yes" | "No";
  optShowEmailInDirectory: "Yes" | "No";
  pratinidhiName: string;
  treasurerName: string;
  totalAmount: number;
  members: ReceiptMember[];
}

function getEmailBodyCopy(entryType: string): string {
  const receiptLabel = "Digital Vantiga receipt";

  return `
Jai Shankar,

Thank you for your contribution. Please find your ${receiptLabel} attached as a PDF.
Keep this receipt for your records and future reference.

If you have any questions, please contact your Sabha representative.
`;
}

let cachedReceiptHeaderBytes: Uint8Array | null = null;

async function loadReceiptHeaderBytes(): Promise<Uint8Array | null> {
  if (cachedReceiptHeaderBytes) return cachedReceiptHeaderBytes;
  try {
    const binary = atob(RECEIPT_HEADER_BASE64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    cachedReceiptHeaderBytes = bytes;
    return bytes;
  } catch {
    return null;
  }
}

function requiredEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optionalTrimmed(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatDate(value: string | null): string {
  if (!value) return "-";
  try {
    return new Date(value).toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return value;
  }
}

function formatAmountIndian(value: number): string {
  try {
    return value.toLocaleString("en-IN", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  } catch {
    return value.toFixed(2);
  }
}

function integerToWordsIndian(num: number): string {
  if (!num || num === 0) return "Zero";

  const ones = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine"];
  const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
  const teens = ["Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];

  const ltThousand = (n: number): string => {
    if (n === 0) return "";
    if (n < 10) return ones[n];
    if (n < 20) return teens[n - 10];
    if (n < 100) {
      const t = Math.floor(n / 10);
      const o = n % 10;
      return tens[t] + (o ? ` ${ones[o]}` : "");
    }
    const h = Math.floor(n / 100);
    const r = n % 100;
    return `${ones[h]} Hundred${r ? ` ${ltThousand(r)}` : ""}`;
  };

  if (num < 1000) return ltThousand(num);
  if (num < 100000) {
    const th = Math.floor(num / 1000);
    const r = num % 1000;
    return `${ltThousand(th)} Thousand${r ? ` ${ltThousand(r)}` : ""}`;
  }
  if (num < 10000000) {
    const l = Math.floor(num / 100000);
    const r = num % 100000;
    return `${ltThousand(l)} Lakh${r ? ` ${integerToWordsIndian(r)}` : ""}`;
  }
  const c = Math.floor(num / 10000000);
  const r = num % 10000000;
  return `${ltThousand(c)} Crore${r ? ` ${integerToWordsIndian(r)}` : ""}`;
}

function amountToWordsIndian(value: number): string {
  const totalPaise = Math.abs(Math.round((Number.isFinite(value) ? value : 0) * 100));
  const rupees = Math.floor(totalPaise / 100);
  const paise = totalPaise % 100;

  if (rupees === 0 && paise === 0) return "Zero";
  if (paise === 0) return integerToWordsIndian(rupees);
  if (rupees === 0) return `${integerToWordsIndian(paise)} Paise`;
  return `${integerToWordsIndian(rupees)} and ${integerToWordsIndian(paise)} Paise`;
}

function yesNo(value: boolean | null | undefined): "Yes" | "No" {
  return value ? "Yes" : "No";
}

export function createServiceClient() {
  const supabaseUrl = requiredEnv("SUPABASE_URL");
  const serviceRoleKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
  return createClient(supabaseUrl, serviceRoleKey);
}

export function isReceiptGeneratedFromPayload(record: Record<string, unknown> | null | undefined, oldRecord?: Record<string, unknown> | null): {
  shouldSend: boolean;
  entryId: string | null;
  receiptNo: string | null;
} {
  const entryId = optionalTrimmed(record?.id);
  const receiptNo = optionalTrimmed(record?.receipt_no);
  const oldReceiptNo = optionalTrimmed(oldRecord?.receipt_no);

  if (!entryId || !receiptNo) {
    return { shouldSend: false, entryId, receiptNo };
  }

  const shouldSend = oldReceiptNo !== receiptNo;
  return { shouldSend, entryId, receiptNo };
}

export async function loadDispatchRow(
  supabase: ReturnType<typeof createServiceClient>,
  entryId: string,
  receiptNo: string,
): Promise<ReceiptDispatchRow | null> {
  const { data, error } = await supabase
    .from("receipt_email_dispatch")
    .select("*")
    .eq("entry_id", entryId)
    .eq("receipt_no", receiptNo)
    .maybeSingle();

  if (error) throw error;
  return (data as ReceiptDispatchRow | null) ?? null;
}

export async function upsertDispatch(
  supabase: ReturnType<typeof createServiceClient>,
  input: {
    entryId: string;
    receiptNo: string;
    payerEmail: string | null;
    status: ReceiptDispatchStatus;
    attemptCount: number;
    lastError?: string | null;
    providerMessageId?: string | null;
  },
): Promise<void> {
  const { error } = await supabase.from("receipt_email_dispatch").upsert(
    {
      entry_id: input.entryId,
      receipt_no: input.receiptNo,
      payer_email: input.payerEmail,
      status: input.status,
      attempt_count: input.attemptCount,
      last_error: input.lastError ?? null,
      provider_message_id: input.providerMessageId ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "entry_id,receipt_no" },
  );

  if (error) throw error;
}

async function ensureDispatchRow(
  supabase: ReturnType<typeof createServiceClient>,
  entryId: string,
  receiptNo: string,
): Promise<ReceiptDispatchRow> {
  let existing = await loadDispatchRow(supabase, entryId, receiptNo);

  if (!existing) {
    await upsertDispatch(supabase, {
      entryId,
      receiptNo,
      payerEmail: null,
      status: "pending",
      attemptCount: 0,
      lastError: null,
      providerMessageId: null,
    });

    existing = await loadDispatchRow(supabase, entryId, receiptNo);
  }

  if (!existing) {
    throw new Error("Unable to create receipt email dispatch row.");
  }

  return existing;
}

async function claimDispatchForSending(
  supabase: ReturnType<typeof createServiceClient>,
  dispatch: ReceiptDispatchRow,
): Promise<{ claimed: boolean; attemptCount: number }> {
  const nextAttemptCount = (dispatch.attempt_count ?? 0) + 1;

  const { data, error } = await supabase
    .from("receipt_email_dispatch")
    .update({
      status: "processing",
      attempt_count: nextAttemptCount,
      last_error: null,
      provider_message_id: null,
      updated_at: new Date().toISOString(),
    })
    .eq("entry_id", dispatch.entry_id)
    .eq("receipt_no", dispatch.receipt_no)
    .eq("attempt_count", dispatch.attempt_count)
    .in("status", ["pending", "failed"])
    .select("entry_id");

  if (error) throw error;

  return {
    claimed: Array.isArray(data) && data.length > 0,
    attemptCount: nextAttemptCount,
  };
}

export async function fetchReceiptPayload(
  supabase: ReturnType<typeof createServiceClient>,
  entryId: string,
  expectedReceiptNo: string,
): Promise<ReceiptPayload> {
  const { data, error } = await supabase
    .from("vantiga_entries")
    .select(`
      id,
      fy,
      entry_type,
      paid_by,
      reference_no,
      submitted_at,
      acknowledged_at,
      submitted_by,
      acknowledged_by,
      receipt_no,
      sabhas:sabha_id (
        name,
        code
      ),
      families:family_id (
        payer_email,
        payer_mobile,
        address_multiline,
        opt_show_amount_in_directory,
        opt_show_mobile_in_directory,
        opt_show_email_in_directory,
        sabhas:sabha_id (
          name
        ),
        family_members (
          full_name,
          age,
          gender,
          gotra,
          other_gotra,
          amount,
          is_primary_payer
        )
      )
    `)
    .eq("id", entryId)
    .single();

  if (error) throw error;

  const receiptNo = optionalTrimmed(data?.receipt_no);
  if (!receiptNo || receiptNo !== expectedReceiptNo) {
    throw new Error("Entry receipt number is missing or does not match expected receipt number.");
  }

  const family = Array.isArray(data?.families) ? data.families[0] : data?.families;
  const sabha = Array.isArray(data?.sabhas) ? data.sabhas[0] : data?.sabhas;
  const familySabha = Array.isArray(family?.sabhas) ? family.sabhas[0] : family?.sabhas;
  const members = Array.isArray(family?.family_members) ? family.family_members : [];
  const normalizedMembers = members.map((member: ReceiptMember) => ({
    ...member,
    gotra: member?.gotra === "Others" ? optionalTrimmed(member?.other_gotra) || "Others" : member?.gotra,
  }));

  const payerEmail = optionalTrimmed(family?.payer_email);
  if (!payerEmail) {
    throw new Error("Payer email is missing for this entry.");
  }

  const payerName =
    normalizedMembers.find((member: ReceiptMember) => member?.is_primary_payer)?.full_name?.trim() ||
    normalizedMembers[0]?.full_name?.trim() ||
    "Vantiga Member";

  const totalAmount = normalizedMembers.reduce((sum: number, member: ReceiptMember) => {
    const amount = Number(member?.amount || 0);
    return sum + (Number.isFinite(amount) ? amount : 0);
  }, 0);

  const submittedBy = optionalTrimmed(data?.submitted_by);
  const acknowledgedBy = optionalTrimmed(data?.acknowledged_by);

  let pratinidhiName = "-";
  let treasurerName = "-";

  if (submittedBy) {
    const { data: submittedByProfile } = await supabase
      .from("profiles")
      .select("full_name")
      .eq("user_id", submittedBy)
      .maybeSingle();
    pratinidhiName = optionalTrimmed(submittedByProfile?.full_name) || "-";
  }

  if (acknowledgedBy) {
    const { data: acknowledgedByProfile } = await supabase
      .from("profiles")
      .select("full_name")
      .eq("user_id", acknowledgedBy)
      .maybeSingle();
    treasurerName = optionalTrimmed(acknowledgedByProfile?.full_name) || "-";
  }

  return {
    entryId: data.id,
    receiptNo,
    fy: data?.fy || "-",
    entryType: data?.entry_type || "Vantiga",
    paidBy: data?.paid_by || "-",
    referenceNo: optionalTrimmed(data?.reference_no),
    submittedAt: optionalTrimmed(data?.submitted_at),
    acknowledgedAt: optionalTrimmed(data?.acknowledged_at),
    submittedBy,
    acknowledgedBy,
    payerEmail,
    payerMobile: optionalTrimmed(family?.payer_mobile),
    payerName,
    address: optionalTrimmed(family?.address_multiline),
    // Keep this in sync with receipt preview, which prefers family->sabha.
    sabhaName: optionalTrimmed(familySabha?.name) || optionalTrimmed(sabha?.name) || "-",
    sabhaCode: optionalTrimmed(sabha?.code),
    optShowAmountInDirectory: yesNo(family?.opt_show_amount_in_directory),
    optShowMobileInDirectory: yesNo(family?.opt_show_mobile_in_directory),
    optShowEmailInDirectory: yesNo(family?.opt_show_email_in_directory),
    pratinidhiName,
    treasurerName,
    totalAmount,
    members: normalizedMembers,
  };
}

export async function buildReceiptPdf(payload: ReceiptPayload): Promise<string> {
  if (payload.entryType === "Math Maryada") {
    throw new Error("Math Maryada receipts are no longer supported in the application UI.");
  }

  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([595.28, 841.89]); // A4
  const titleFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const bodyFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const monoFont = await pdfDoc.embedFont(StandardFonts.Courier);
  const monoBoldFont = await pdfDoc.embedFont(StandardFonts.CourierBold);
  const pageWidth = page.getWidth();
  const pageHeight = page.getHeight();

  const left = 34;
  const right = pageWidth - 34;
  const contentWidth = right - left;
  const horizontalPad = 12;
  const borderColor = rgb(0.78, 0.82, 0.86);
  const sectionBg = rgb(0.95, 0.96, 0.98);
  let y = pageHeight - 36;

  const paidBy = payload.paidBy || "-";
  const referenceNo = payload.referenceNo || (paidBy === "Cash" ? "Not Applicable" : "-");
  const receiptDate = formatDate(payload.acknowledgedAt || payload.submittedAt);
  const amountInWords = amountToWordsIndian(payload.totalAmount);
  const payerMobile = payload.payerMobile ? `+91 ${payload.payerMobile}` : "-";
  const address = payload.address || "-";
  const isMathMaryada = payload.entryType === "Math Maryada";
  const tableRows = [...payload.members, ...Array(Math.max(0, 5 - payload.members.length)).fill(null)];

  const row = (height: number) => {
    const top = y;
    const bottom = y - height;
    y = bottom;
    return { top, bottom, height };
  };

  const drawSectionBox = (topY: number, height: number, fill = false) => {
    page.drawRectangle({
      x: left,
      y: topY - height,
      width: contentWidth,
      height,
      borderColor,
      borderWidth: 1,
      color: fill ? sectionBg : undefined,
    });
  };

  const drawRightText = (text: string, x: number, yText: number, fontSize: number, bold = false) => {
    const font = bold ? titleFont : bodyFont;
    const textWidth = font.widthOfTextAtSize(text, fontSize);
    page.drawText(text, { x: x - textWidth, y: yText, size: fontSize, font });
  };

  const drawCenteredText = (
    text: string,
    centerX: number,
    yText: number,
    fontSize: number,
    bold = false,
  ) => {
    const font = bold ? titleFont : bodyFont;
    const textWidth = font.widthOfTextAtSize(text, fontSize);
    page.drawText(text, {
      x: centerX - (textWidth / 2),
      y: yText,
      size: fontSize,
      font,
    });
  };

  const drawWrapped = (
    text: string,
    x: number,
    yTop: number,
    maxWidth: number,
    fontSize: number,
    lineHeight: number,
    bold = false,
  ) => {
    const font = bold ? titleFont : bodyFont;
    const words = String(text || "-").split(/\s+/).filter(Boolean);
    const lines: string[] = [];
    let current = "";
    for (const word of words) {
      const next = current ? `${current} ${word}` : word;
      if (font.widthOfTextAtSize(next, fontSize) <= maxWidth) {
        current = next;
      } else {
        if (current) lines.push(current);
        current = word;
      }
    }
    if (current) lines.push(current);
    lines.forEach((line, idx) => {
      page.drawText(line, { x, y: yTop - idx * lineHeight, size: fontSize, font });
    });
    return lines.length;
  };

  const drawWrappedRight = (
    text: string,
    rightX: number,
    yTop: number,
    maxWidth: number,
    fontSize: number,
    lineHeight: number,
    bold = false,
  ) => {
    const font = bold ? titleFont : bodyFont;
    const words = String(text || "-").split(/\s+/).filter(Boolean);
    const lines: string[] = [];
    let current = "";
    for (const word of words) {
      const next = current ? `${current} ${word}` : word;
      if (font.widthOfTextAtSize(next, fontSize) <= maxWidth) {
        current = next;
      } else {
        if (current) lines.push(current);
        current = word;
      }
    }
    if (current) lines.push(current);
    lines.forEach((line, idx) => {
      const textWidth = font.widthOfTextAtSize(line, fontSize);
      page.drawText(line, {
        x: rightX - textWidth,
        y: yTop - idx * lineHeight,
        size: fontSize,
        font,
      });
    });
    return lines.length;
  };

  const drawMathMaryadaPreviewStyleLayout = () => {
    const summary = row(68);
    drawSectionBox(summary.top, summary.height);
    page.drawText("Math Maryada Receipt", {
      x: left + horizontalPad,
      y: summary.top - 24,
      size: 18,
      font: titleFont,
    });
    page.drawText(`Local Sabha: ${payload.sabhaName}`, {
      x: left + horizontalPad,
      y: summary.top - 48,
      size: 10.5,
      font: titleFont,
    });
    const receiptNoLine = `Receipt number: ${payload.receiptNo}`;
    drawRightText(receiptNoLine, right - horizontalPad, summary.top - 18, 10.5, true);
    drawRightText(`Date: ${receiptDate}`, right - horizontalPad, summary.top - 40, 10.5, true);

    const received = row(44);
    drawSectionBox(received.top, received.height);
    page.drawText("Received From :", {
      x: left + horizontalPad,
      y: received.top - 26,
      size: 11,
      font: titleFont,
    });
    const receivedPrefix = `${payload.payerName}, being voluntary contribution towards Math Maryada for Year:`;
    page.drawText(receivedPrefix, {
      x: left + 118,
      y: received.top - 26,
      size: 10.5,
      font: bodyFont,
    });
    const receivedPrefixWidth = bodyFont.widthOfTextAtSize(receivedPrefix, 10.5);
    page.drawText(payload.fy, {
      x: left + 118 + receivedPrefixWidth + 4,
      y: received.top - 26,
      size: 10.5,
      font: monoFont,
    });

    const contact = row(72);
    drawSectionBox(contact.top, contact.height);
    page.drawText("Address:", { x: left + horizontalPad, y: contact.top - 22, size: 11, font: titleFont });
    drawWrapped(address.replaceAll("\n", " "), left + 78, contact.top - 22, contentWidth - 96, 10.5, 12);
    page.drawText("Mobile Number:", {
      x: left + horizontalPad,
      y: contact.top - 54,
      size: 11,
      font: titleFont,
    });
    page.drawText(payerMobile, {
      x: left + 128,
      y: contact.top - 54,
      size: 10.5,
      font: monoFont,
    });
    const emailLabel = "Email ID:";
    const emailLabelWidth = titleFont.widthOfTextAtSize(emailLabel, 10.5);
    const emailValueWidth = monoFont.widthOfTextAtSize(payload.payerEmail, 10.5);
    const emailBaseX = right - horizontalPad - emailLabelWidth - 4 - emailValueWidth;
    page.drawText(emailLabel, { x: emailBaseX, y: contact.top - 54, size: 10.5, font: titleFont });
    page.drawText(payload.payerEmail, {
      x: emailBaseX + emailLabelWidth + 4,
      y: contact.top - 54,
      size: 10.5,
      font: monoFont,
    });

    const details = row(102);
    drawSectionBox(details.top, details.height);
    page.drawText("Math Maryada Payer Details:", {
      x: left + horizontalPad,
      y: details.top - 20,
      size: 11,
      font: titleFont,
    });

    const cardX = left + horizontalPad;
    const cardY = details.top - 92;
    const cardWidth = contentWidth - 2 * horizontalPad;
    const cardHeight = 58;
    page.drawRectangle({
      x: cardX,
      y: cardY,
      width: cardWidth,
      height: cardHeight,
      borderColor,
      borderWidth: 1,
    });
    page.drawText("Name:", {
      x: cardX + 14,
      y: cardY + 36,
      size: 10.5,
      font: titleFont,
    });
    page.drawText(payload.payerName, {
      x: cardX + 54,
      y: cardY + 36,
      size: 10.5,
      font: bodyFont,
    });
    page.drawText("Amount:", {
      x: cardX + 14,
      y: cardY + 14,
      size: 10.5,
      font: titleFont,
    });
    page.drawText(formatAmountIndian(payload.totalAmount), {
      x: cardX + 64,
      y: cardY + 14,
      size: 10.5,
      font: bodyFont,
    });

    page.drawText("AMOUNT IN WORDS:", {
      x: left + horizontalPad,
      y: details.top - 100,
      size: 11,
      font: titleFont,
    });
    page.drawText("Rupees", {
      x: left + 168,
      y: details.top - 100,
      size: 10.5,
      font: bodyFont,
    });
    page.drawText(`${amountInWords} Only`, {
      x: left + 208,
      y: details.top - 100,
      size: 10.5,
      font: bodyFont,
    });

    const payment = row(48);
    drawSectionBox(payment.top, payment.height);
    page.drawText("Payment Mode:", {
      x: left + horizontalPad,
      y: payment.top - 18,
      size: 10.5,
      font: titleFont,
    });
    page.drawText(paidBy, {
      x: left + 116,
      y: payment.top - 18,
      size: 10.5,
      font: monoFont,
    });
    page.drawText("Reference Number:", {
      x: left + horizontalPad,
      y: payment.top - 36,
      size: 10.5,
      font: titleFont,
    });
    page.drawText(referenceNo, {
      x: left + 144,
      y: payment.top - 36,
      size: 10.5,
      font: monoFont,
    });
  };

  page.drawRectangle({
    x: left,
    y: 36,
    width: contentWidth,
    height: pageHeight - 72,
    borderColor,
    borderWidth: 1,
  });

  const headerBytes = await loadReceiptHeaderBytes();
  const headerImage = headerBytes ? await pdfDoc.embedPng(headerBytes) : null;
  const headerInsetX = 8;
  const headerInsetTop = 6;
  const headerInsetBottom = 6;
  const headerImageWidth = contentWidth - headerInsetX * 2;
  const headerImageHeight = headerImage
    ? (headerImage.height * headerImageWidth) / headerImage.width
    : 0;
  const headerHeight = headerImage
    ? headerImageHeight + headerInsetTop + headerInsetBottom
    : 84;

  const header = row(headerHeight);
  drawSectionBox(header.top, header.height);
  if (headerImage) {
    page.drawImage(headerImage, {
      x: left + headerInsetX,
      y: header.top - headerInsetTop - headerImageHeight,
      width: headerImageWidth,
      height: headerImageHeight,
    });
  } else {
    page.drawText("SHRI CHITRAPUR MATH - Shirali", {
      x: left + (contentWidth / 2) - 110,
      y: header.top - 24,
      size: 18,
      font: titleFont,
      color: rgb(0.05, 0.05, 0.05),
    });
    page.drawText("Shrimat Swami Pandurangashram Marg,", {
      x: left + (contentWidth / 2) - 110,
      y: header.top - 42,
      size: 10,
      font: bodyFont,
    });
    page.drawText("Chitrapur, Shirali, Uttara Kannada Dist., Karnataka - 581 354", {
      x: left + (contentWidth / 2) - 150,
      y: header.top - 58,
      size: 9.5,
      font: bodyFont,
    });
    page.drawText("Phone: (08385)258368/258756 | E-mail: accts.shirali@chitrapurmath.in | GST: 29AAATS5030Q1Z0", {
      x: left + 18,
      y: header.top - 74,
      size: 8.5,
      font: bodyFont,
    });
  }

  if (isMathMaryada) {
    drawMathMaryadaPreviewStyleLayout();

    const signers = row(60);
    drawSectionBox(signers.top, signers.height);
    const leftSignerX = left + horizontalPad;
    const leftSignerWidth = 180;
    const rightLabel = "Treasurer:";
    const rightSignerWidth = 130;
    const rightSignerRightX = right - horizontalPad;
    page.drawText("Pratinidhi:", { x: leftSignerX, y: signers.top - 18, size: 9.5, font: titleFont });
    drawWrapped(payload.pratinidhiName, leftSignerX, signers.top - 34, leftSignerWidth, 9.5, 11);
    drawRightText(rightLabel, rightSignerRightX, signers.top - 18, 9.5, true);
    drawWrappedRight(payload.treasurerName, rightSignerRightX, signers.top - 34, rightSignerWidth, 9.5, 11);

    const footer = row(22);
    drawSectionBox(footer.top, footer.height);
    const footerText = "No Signature required as this is a computer generated receipt";
    const footerTextWidth = bodyFont.widthOfTextAtSize(footerText, 8.5);
    page.drawText(footerText, {
      x: left + (contentWidth - footerTextWidth) / 2,
      y: footer.top - 15,
      size: 8.5,
      font: bodyFont,
    });

    const pdfBytes = await pdfDoc.save();
    let binary = "";
    for (const byte of pdfBytes) {
      binary += String.fromCharCode(byte);
    }
    return btoa(binary);
  }

  const summary = row(56);
  drawSectionBox(summary.top, summary.height);
  page.drawText(isMathMaryada ? "Math Maryada Receipt" : "Vantiga Receipt", {
    x: left + horizontalPad,
    y: summary.top - 20,
    size: 15,
    font: titleFont,
  });
  page.drawText(`Local Sabha: ${payload.sabhaName}`, {
    x: left + horizontalPad,
    y: summary.top - 36,
    size: 10,
    font: titleFont,
  });
  const receiptNoLabel = "Receipt number:";
  const receiptNoLabelWidth = titleFont.widthOfTextAtSize(receiptNoLabel, 10);
  const receiptNoValueWidth = monoBoldFont.widthOfTextAtSize(payload.receiptNo, 10);
  const receiptNoBaseX = right - horizontalPad - receiptNoLabelWidth - 4 - receiptNoValueWidth;
  page.drawText(receiptNoLabel, { x: receiptNoBaseX, y: summary.top - 20, size: 10, font: titleFont });
  page.drawText(payload.receiptNo, {
    x: receiptNoBaseX + receiptNoLabelWidth + 4,
    y: summary.top - 20,
    size: 10,
    font: monoBoldFont,
  });
  drawRightText(`Date: ${receiptDate}`, right - horizontalPad, summary.top - 36, 10, true);

  if (!isMathMaryada) {
    const topCallout = row(30);
    drawSectionBox(topCallout.top, topCallout.height);
    drawCenteredText(
      "Vantiga is a voluntary contribution towards the activities of Shri Chitrapur Math.",
      left + contentWidth / 2,
      topCallout.top - 19,
      8.8,
      true,
    );
  }

  const received = row(30);
  drawSectionBox(received.top, received.height);
  page.drawText("Received From:", {
    x: left + horizontalPad,
    y: received.top - 18,
    size: 10.5,
    font: titleFont,
  });
  if (isMathMaryada) {
    const receivedPrefix = `${payload.payerName}, being voluntary contribution towards Math Maryada for Year: `;
    page.drawText(receivedPrefix, {
      x: left + 92,
      y: received.top - 18,
      size: 10,
      font: bodyFont,
    });
    const receivedPrefixWidth = bodyFont.widthOfTextAtSize(receivedPrefix, 10);
    page.drawText(payload.fy, {
      x: left + 92 + receivedPrefixWidth + 4,
      y: received.top - 18,
      size: 10,
      font: monoFont,
    });
  } else {
    page.drawText(payload.payerName, {
      x: left + 92,
      y: received.top - 18,
      size: 10,
      font: bodyFont,
    });

    const fyValueWidth = monoFont.widthOfTextAtSize(payload.fy, 10);
    const fyLabel = "Vantiga for the year:";
    const fyLabelWidth = titleFont.widthOfTextAtSize(fyLabel, 10);
    const fyBaseX = right - horizontalPad - fyLabelWidth - 4 - fyValueWidth;
    page.drawText(fyLabel, {
      x: fyBaseX,
      y: received.top - 18,
      size: 10,
      font: titleFont,
    });
    page.drawText(payload.fy, {
      x: fyBaseX + fyLabelWidth + 4,
      y: received.top - 18,
      size: 10,
      font: monoFont,
    });
  }

  const contact = row(56);
  drawSectionBox(contact.top, contact.height);
  page.drawText("Address:", { x: left + horizontalPad, y: contact.top - 18, size: 10, font: titleFont });
  drawWrapped(address.replaceAll("\n", " "), left + 62, contact.top - 18, contentWidth - 80, 9.5, 11);
  page.drawText("Mobile Number:", {
    x: left + horizontalPad,
    y: contact.top - 40,
    size: 10,
    font: titleFont,
  });
  page.drawText(payerMobile, {
    x: left + 92,
    y: contact.top - 40,
    size: 9.5,
    font: monoFont,
  });
  const emailLabel = "Email ID:";
  const emailLabelWidth = titleFont.widthOfTextAtSize(emailLabel, 9.5);
  const emailValueWidth = monoFont.widthOfTextAtSize(payload.payerEmail, 9.5);
  const emailBaseX = right - horizontalPad - emailLabelWidth - 4 - emailValueWidth;
  page.drawText(emailLabel, { x: emailBaseX, y: contact.top - 40, size: 9.5, font: titleFont });
  page.drawText(payload.payerEmail, {
    x: emailBaseX + emailLabelWidth + 4,
    y: contact.top - 40,
    size: 9.5,
    font: monoFont,
  });

  const detailsLabel = row(22);
  drawSectionBox(detailsLabel.top, detailsLabel.height);
  page.drawText(isMathMaryada ? "Math Maryada Payer Details:" : "Vantiga Payer Details:", {
    x: left + horizontalPad,
    y: detailsLabel.top - 15,
    size: 10.5,
    font: titleFont,
  });

  if (isMathMaryada) {
    const singlePayer = row(48);
    drawSectionBox(singlePayer.top, singlePayer.height);
    page.drawText(`Name: ${payload.payerName}`, {
      x: left + horizontalPad,
      y: singlePayer.top - 18,
      size: 10,
      font: bodyFont,
    });
    page.drawText(`Amount: ${formatAmountIndian(payload.totalAmount)}`, {
      x: left + horizontalPad,
      y: singlePayer.top - 34,
      size: 10,
      font: bodyFont,
    });
  } else {
    const tableTop = y;
    const tableHeight = 148;
    drawSectionBox(tableTop, tableHeight);
    const col1 = left + 10;
    const col2 = left + contentWidth * 0.52;
    const col3 = left + contentWidth * 0.62;
    const col4 = left + contentWidth * 0.74;
    const tableRight = right - 10;
    const headerY = tableTop - 16;
    const rowHeight = 20;

    page.drawText("Name", { x: col1, y: headerY, size: 9.5, font: titleFont });
    page.drawText("Age", { x: col2, y: headerY, size: 9.5, font: titleFont });
    page.drawText("Gender", { x: col3, y: headerY, size: 9.5, font: titleFont });
    page.drawText("Gotra", { x: col4, y: headerY, size: 9.5, font: titleFont });
    drawRightText("Amount", tableRight, headerY, 9.5, true);

    page.drawLine({
      start: { x: left + 2, y: tableTop - 22 },
      end: { x: right - 2, y: tableTop - 22 },
      thickness: 1,
      color: borderColor,
    });

    tableRows.forEach((member, idx) => {
      const rowY = tableTop - 22 - (idx + 1) * rowHeight + 6;
      page.drawText(member?.full_name || "", { x: col1, y: rowY, size: 9, font: bodyFont });
      page.drawText(member?.age != null ? String(member.age) : "", { x: col2, y: rowY, size: 9, font: bodyFont });
      page.drawText(member?.gender || "", { x: col3, y: rowY, size: 9, font: bodyFont });
      page.drawText(member?.gotra || "", { x: col4, y: rowY, size: 9, font: bodyFont });
      drawRightText(member ? formatAmountIndian(Number(member.amount || 0)) : "", tableRight, rowY, 9, false);

      const dividerY = tableTop - 22 - (idx + 1) * rowHeight;
      page.drawLine({
        start: { x: left + 2, y: dividerY },
        end: { x: right - 2, y: dividerY },
        thickness: 0.7,
        color: rgb(0.88, 0.9, 0.92),
      });
    });

    const totalY = tableTop - 22 - tableRows.length * rowHeight - 16;
    page.drawText("TOTAL", { x: col4, y: totalY, size: 9.5, font: titleFont });
    drawRightText(formatAmountIndian(payload.totalAmount), tableRight, totalY, 9.5, true);
    y = tableTop - tableHeight;
  }

  const words = row(24);
  drawSectionBox(words.top, words.height);
  page.drawText(`AMOUNT IN WORDS: Rupees ${amountInWords} Only`, {
    x: left + horizontalPad,
    y: words.top - 16,
    size: 10,
    font: titleFont,
  });

  const payment = row(42);
  drawSectionBox(payment.top, payment.height);
  page.drawText(`Payment Mode: ${paidBy}`, {
    x: left + horizontalPad,
    y: payment.top - 16,
    size: 10,
    font: monoBoldFont,
  });
  page.drawText(`Reference Number: ${referenceNo}`, {
    x: left + horizontalPad,
    y: payment.top - 32,
    size: 10,
    font: monoBoldFont,
  });

  if (!isMathMaryada) {
    const directory = row(66);
    drawSectionBox(directory.top, directory.height, true);
    drawCenteredText(
      "Vantiga Payer has confirmed below preferences for display in the SCM Vantiga Directory:",
      left + contentWidth / 2,
      directory.top - 20,
      8.6,
      true,
    );
    page.drawText(`Vantiga Amount: ${payload.optShowAmountInDirectory}`, {
      x: left + horizontalPad,
      y: directory.top - 48,
      size: 9.5,
      font: bodyFont,
    });
    page.drawText(`Mobile Number: ${payload.optShowMobileInDirectory}`, {
      x: left + 190,
      y: directory.top - 48,
      size: 9.5,
      font: bodyFont,
    });
    page.drawText(`Email ID: ${payload.optShowEmailInDirectory}`, {
      x: left + 355,
      y: directory.top - 48,
      size: 8.5,
      font: bodyFont,
    });
  }

  const signers = row(60);
  drawSectionBox(signers.top, signers.height);
  const leftSignerX = left + horizontalPad;
  const leftSignerWidth = 180;
  const rightLabel = "Treasurer:";
  const rightSignerWidth = 145;
  const rightSignerRightX = right - horizontalPad;
  page.drawText("Pratinidhi:", { x: leftSignerX, y: signers.top - 18, size: 9.5, font: titleFont });
  drawWrapped(payload.pratinidhiName, leftSignerX, signers.top - 34, leftSignerWidth, 9.5, 11);
  drawRightText(rightLabel, rightSignerRightX, signers.top - 18, 9.5, true);
  drawWrappedRight(payload.treasurerName, rightSignerRightX, signers.top - 34, rightSignerWidth, 9.5, 11);

  const footer = row(22);
  drawSectionBox(footer.top, footer.height);
  const footerText = "No Signature required as this is a computer generated receipt";
  const footerTextWidth = bodyFont.widthOfTextAtSize(footerText, 8.5);
  page.drawText(footerText, {
    x: left + (contentWidth - footerTextWidth) / 2,
    y: footer.top - 15,
    size: 8.5,
    font: bodyFont,
  });

  const pdfBytes = await pdfDoc.save();
  let binary = "";
  for (const byte of pdfBytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

export async function generateReceiptPdfForEntry(
  supabase: ReturnType<typeof createServiceClient>,
  entryId: string,
  receiptNo: string,
): Promise<{ payload: ReceiptPayload; pdfBase64: string }> {
  const payload = await fetchReceiptPayload(supabase, entryId, receiptNo);
  const pdfBase64 = await buildReceiptPdf(payload);
  return { payload, pdfBase64 };
}

export async function sendViaResend(
  payload: ReceiptPayload,
  pdfBase64: string,
): Promise<string> {
  const resendApiKey = requiredEnv("RESEND_API_KEY");
  const fromAddress = requiredEnv("RECEIPT_EMAIL_FROM");
  const subject = `Receipt ${payload.receiptNo}`;
  const safePayerName = escapeHtml(payload.payerName);
  const safeSabhaName = escapeHtml(payload.sabhaName);
  const emailBodyCopy = getEmailBodyCopy(payload.entryType);

  const html = `
    <div style="font-family: Arial, sans-serif; font-size: 14px; line-height: 1.6; color: #111827;">
      <p>${emailBodyCopy.trim().replaceAll("\n", "<br/>")}</p>
      <p><strong>Receipt Number:</strong> ${escapeHtml(payload.receiptNo)}<br/>
      <strong>Payer Name:</strong> ${safePayerName}<br/>
      <strong>Sabha:</strong> ${safeSabhaName}<br/>
      <strong>Total Amount:</strong> INR ${formatAmountIndian(payload.totalAmount)}</p>
      <p>Regards,<br/>Shri Chitrapur Math</p>
    </div>
  `;

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: fromAddress,
      to: [payload.payerEmail],
      subject,
      html,
      attachments: [
        {
          filename: `receipt-${payload.receiptNo}.pdf`,
          content: pdfBase64,
        },
      ],
    }),
  });

  const responseBody = await response.text();
  if (!response.ok) {
    throw new Error(`Resend API failed (${response.status}): ${responseBody}`);
  }

  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(responseBody);
  } catch {
    // Keep parsed empty; response body already validated by status code.
  }

  const messageId = optionalTrimmed(parsed.id) || "unknown";
  return messageId;
}

export async function processReceiptEmail(
  supabase: ReturnType<typeof createServiceClient>,
  entryId: string,
  receiptNo: string,
): Promise<{ status: "sent" | "skipped"; message: string }> {
  const existing = await ensureDispatchRow(supabase, entryId, receiptNo);
  if (existing.status === "sent") {
    return { status: "skipped", message: "Email already sent for this receipt number." };
  }
  if (existing.status === "processing") {
    return { status: "skipped", message: "Email dispatch is already in progress for this receipt number." };
  }

  const claim = await claimDispatchForSending(supabase, existing);
  if (!claim.claimed) {
    const latest = await loadDispatchRow(supabase, entryId, receiptNo);
    if (latest?.status === "sent") {
      return { status: "skipped", message: "Email already sent for this receipt number." };
    }
    if (latest?.status === "processing") {
      return { status: "skipped", message: "Email dispatch is already in progress for this receipt number." };
    }
    return { status: "skipped", message: "Another worker already claimed this receipt email dispatch." };
  }

  let receiptPayload: ReceiptPayload | null = null;
  try {
    const generated = await generateReceiptPdfForEntry(supabase, entryId, receiptNo);
    receiptPayload = generated.payload;

    const providerMessageId = await sendViaResend(receiptPayload, generated.pdfBase64);

    await upsertDispatch(supabase, {
      entryId,
      receiptNo,
      payerEmail: receiptPayload.payerEmail,
      status: "sent",
      attemptCount: claim.attemptCount,
      lastError: null,
      providerMessageId,
    });

    return { status: "sent", message: `Email sent to ${receiptPayload.payerEmail}` };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    await upsertDispatch(supabase, {
      entryId,
      receiptNo,
      payerEmail: receiptPayload?.payerEmail ?? existing.payer_email ?? null,
      status: "failed",
      attemptCount: claim.attemptCount,
      lastError: errorMessage,
      providerMessageId: null,
    });

    throw error;
  }
}
