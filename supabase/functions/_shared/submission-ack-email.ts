import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export type SubmissionAckDispatchStatus = "pending" | "processing" | "sent" | "failed";

export interface SubmissionAckDispatchRow {
  id: string;
  entry_id: string;
  submitted_at: string;
  payer_email: string | null;
  paid_by: string;
  status: SubmissionAckDispatchStatus;
  attempt_count: number;
  last_error: string | null;
  provider_message_id: string | null;
}

interface SubmissionAckPayload {
  entryId: string;
  submittedAt: string;
  payerEmail: string;
  payerName: string;
  sabhaName: string;
  paidBy: string;
  fy: string;
  totalAmount: number;
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

export function createServiceClient() {
  const supabaseUrl = requiredEnv("SUPABASE_URL");
  const serviceRoleKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
  return createClient(supabaseUrl, serviceRoleKey);
}

export function isSubmissionAckGeneratedFromPayload(
  record: Record<string, unknown> | null | undefined,
  oldRecord?: Record<string, unknown> | null,
): { shouldSend: boolean; entryId: string | null; submittedAt: string | null } {
  const entryId = optionalTrimmed(record?.id);
  const submittedAt = optionalTrimmed(record?.submitted_at);
  const status = optionalTrimmed(record?.status);
  const oldSubmittedAt = optionalTrimmed(oldRecord?.submitted_at);

  if (!entryId || !submittedAt || status !== "SUBMITTED") {
    return { shouldSend: false, entryId, submittedAt };
  }

  return {
    shouldSend: oldSubmittedAt !== submittedAt,
    entryId,
    submittedAt,
  };
}

export async function loadDispatchRow(
  supabase: ReturnType<typeof createServiceClient>,
  entryId: string,
  submittedAt: string,
): Promise<SubmissionAckDispatchRow | null> {
  const { data, error } = await supabase
    .from("submission_ack_email_dispatch")
    .select("*")
    .eq("entry_id", entryId)
    .eq("submitted_at", submittedAt)
    .maybeSingle();

  if (error) throw error;
  return (data as SubmissionAckDispatchRow | null) ?? null;
}

export async function loadLatestDispatchRow(
  supabase: ReturnType<typeof createServiceClient>,
  entryId: string,
): Promise<SubmissionAckDispatchRow | null> {
  const { data, error } = await supabase
    .from("submission_ack_email_dispatch")
    .select("*")
    .eq("entry_id", entryId)
    .order("submitted_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return (data as SubmissionAckDispatchRow | null) ?? null;
}

export async function upsertDispatch(
  supabase: ReturnType<typeof createServiceClient>,
  input: {
    entryId: string;
    submittedAt: string;
    payerEmail: string | null;
    paidBy: string;
    status: SubmissionAckDispatchStatus;
    attemptCount: number;
    lastError?: string | null;
    providerMessageId?: string | null;
  },
): Promise<void> {
  const { error } = await supabase.from("submission_ack_email_dispatch").upsert(
    {
      entry_id: input.entryId,
      submitted_at: input.submittedAt,
      payer_email: input.payerEmail,
      paid_by: input.paidBy,
      status: input.status,
      attempt_count: input.attemptCount,
      last_error: input.lastError ?? null,
      provider_message_id: input.providerMessageId ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "entry_id,submitted_at" },
  );

  if (error) throw error;
}

async function ensureDispatchRow(
  supabase: ReturnType<typeof createServiceClient>,
  entryId: string,
  submittedAt: string,
): Promise<SubmissionAckDispatchRow> {
  const existing = await loadDispatchRow(supabase, entryId, submittedAt);
  if (!existing) {
    throw new Error("Unable to locate submission acknowledgement dispatch row.");
  }
  return existing;
}

async function claimDispatchForSending(
  supabase: ReturnType<typeof createServiceClient>,
  dispatch: SubmissionAckDispatchRow,
): Promise<{ claimed: boolean; attemptCount: number }> {
  const nextAttemptCount = (dispatch.attempt_count ?? 0) + 1;

  const { data, error } = await supabase
    .from("submission_ack_email_dispatch")
    .update({
      status: "processing",
      attempt_count: nextAttemptCount,
      last_error: null,
      provider_message_id: null,
      updated_at: new Date().toISOString(),
    })
    .eq("entry_id", dispatch.entry_id)
    .eq("submitted_at", dispatch.submitted_at)
    .eq("attempt_count", dispatch.attempt_count)
    .in("status", ["pending", "failed"])
    .select("entry_id");

  if (error) throw error;

  return {
    claimed: Array.isArray(data) && data.length > 0,
    attemptCount: nextAttemptCount,
  };
}

export async function fetchSubmissionAckPayload(
  supabase: ReturnType<typeof createServiceClient>,
  entryId: string,
  expectedSubmittedAt: string,
): Promise<SubmissionAckPayload> {
  const dispatch = await ensureDispatchRow(supabase, entryId, expectedSubmittedAt);

  const { data, error } = await supabase
    .from("vantiga_entries")
    .select(`
      id,
      fy,
      paid_by,
      submitted_at,
      families:family_id (
        payer_email,
        family_members (
          full_name,
          is_primary_payer,
          amount
        ),
        sabhas:sabha_id (
          name
        )
      )
    `)
    .eq("id", entryId)
    .single();

  if (error) throw error;

  const submittedAt = optionalTrimmed(data?.submitted_at);
  if (!submittedAt || submittedAt !== expectedSubmittedAt) {
    throw new Error("Entry submitted_at is missing or does not match expected submission event.");
  }

  const family = Array.isArray(data?.families) ? data.families[0] : data?.families;
  const members = Array.isArray(family?.family_members) ? family.family_members : [];
  const familySabha = Array.isArray(family?.sabhas) ? family.sabhas[0] : family?.sabhas;

  const payerEmail = optionalTrimmed(dispatch.payer_email) || optionalTrimmed(family?.payer_email);
  if (!payerEmail) {
    throw new Error("Payer email is missing for this entry submission acknowledgement.");
  }

  const payerName =
    members.find((member: { full_name?: string | null; is_primary_payer?: boolean | null }) => member?.is_primary_payer)?.full_name?.trim() ||
    members[0]?.full_name?.trim() ||
    "Vantiga Member";
  const totalAmount = members.reduce((sum, member: { amount?: number | string | null }) => {
    const amount = Number(member?.amount || 0);
    return sum + (Number.isFinite(amount) ? amount : 0);
  }, 0);

  return {
    entryId,
    submittedAt,
    payerEmail,
    payerName,
    sabhaName: optionalTrimmed(familySabha?.name) || "-",
    paidBy: optionalTrimmed(data?.paid_by) || dispatch.paid_by || "-",
    fy: optionalTrimmed(data?.fy) || "-",
    totalAmount,
  };
}

export async function sendViaResend(
  payload: SubmissionAckPayload,
): Promise<string> {
  const resendApiKey = requiredEnv("RESEND_API_KEY");
  const fromAddress = requiredEnv("RECEIPT_EMAIL_FROM");
  const subject = "Your Vantiga Entry Has Been Submitted";

  const html = `
    <div style="font-family: Arial, sans-serif; font-size: 14px; line-height: 1.6; color: #111827;">
      <p>Jai Shankar,</p>
      <p>Your Vantiga entry has been submitted successfully.</p>
      <p>
        <strong>Payer Name:</strong> ${escapeHtml(payload.payerName)}<br/>
        <strong>Local Sabha:</strong> ${escapeHtml(payload.sabhaName)}<br/>
        <strong>Financial Year:</strong> ${escapeHtml(payload.fy)}<br/>
        <strong>Payment Mode:</strong> ${escapeHtml(payload.paidBy)}<br/>
        <strong>Amount:</strong> INR ${escapeHtml(formatAmountIndian(payload.totalAmount))}
      </p>
      <p>We have received your submission and you will receive your receipt soon after verification by the Local Sabha Treasurer.</p>
      <p>If you have any questions, please contact your Sabha Pratinidhi.</p>
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
    // Ignore parse failure; successful status already confirms the send.
  }

  return optionalTrimmed(parsed.id) || "unknown";
}

export async function processSubmissionAckEmail(
  supabase: ReturnType<typeof createServiceClient>,
  entryId: string,
  submittedAt: string,
): Promise<{ status: "sent" | "skipped"; message: string }> {
  const existing = await ensureDispatchRow(supabase, entryId, submittedAt);
  if (existing.status === "sent") {
    return { status: "skipped", message: "Acknowledgement email already sent for this submission event." };
  }
  if (existing.status === "processing") {
    return { status: "skipped", message: "Acknowledgement dispatch is already in progress for this submission event." };
  }

  const claim = await claimDispatchForSending(supabase, existing);
  if (!claim.claimed) {
    const latest = await loadDispatchRow(supabase, entryId, submittedAt);
    if (latest?.status === "sent") {
      return { status: "skipped", message: "Acknowledgement email already sent for this submission event." };
    }
    if (latest?.status === "processing") {
      return { status: "skipped", message: "Acknowledgement dispatch is already in progress for this submission event." };
    }
    return { status: "skipped", message: "Another worker already claimed this submission acknowledgement dispatch." };
  }

  let submissionPayload: SubmissionAckPayload | null = null;
  try {
    submissionPayload = await fetchSubmissionAckPayload(supabase, entryId, submittedAt);
    const providerMessageId = await sendViaResend(submissionPayload);

    await upsertDispatch(supabase, {
      entryId,
      submittedAt,
      payerEmail: submissionPayload.payerEmail,
      paidBy: submissionPayload.paidBy,
      status: "sent",
      attemptCount: claim.attemptCount,
      lastError: null,
      providerMessageId,
    });

    return { status: "sent", message: `Acknowledgement email sent to ${submissionPayload.payerEmail}` };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    await upsertDispatch(supabase, {
      entryId,
      submittedAt,
      payerEmail: submissionPayload?.payerEmail ?? existing.payer_email ?? null,
      paidBy: submissionPayload?.paidBy ?? existing.paid_by,
      status: "failed",
      attemptCount: claim.attemptCount,
      lastError: errorMessage,
      providerMessageId: null,
    });

    throw error;
  }
}
