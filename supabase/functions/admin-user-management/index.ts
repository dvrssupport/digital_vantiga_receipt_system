import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const jsonHeaders = { "Content-Type": "application/json", ...corsHeaders };
const SABHA_BOUND_ROLES = new Set(["pratinidhi", "treasurer", "auditor"]);
const VALID_ROLES = new Set(["admin", "scm_office", "general_manager", "pratinidhi", "treasurer", "auditor"]);
const USER_BAN_DURATION = "876000h";
const VALIDATION_ERROR_MESSAGES = [
  "Action is required.",
  "At least one role assignment is required.",
  "Password is required.",
  "Password must be at least 8 characters.",
  "Full name is required.",
  "Email is required.",
  "Username is required.",
  "user_id is required.",
  "Username already exists.",
];

type AssignmentInput = {
  role?: string | null;
  sabha_id?: string | null;
  is_active?: boolean | null;
};

type ProfileRow = {
  user_id: string;
  full_name: string | null;
  username: string | null;
  is_active: boolean | null;
};

type RoleRow = {
  id: string;
  user_id: string;
  sabha_id: string | null;
  role: string;
  is_active: boolean;
  sabhas?: {
    id: string;
    name: string;
    code: string;
  } | null;
};

function requiredEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function createServiceClient() {
  return createClient(
    requiredEnv("SUPABASE_URL"),
    requiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
  );
}

function errorResponse(message: string, status = 400) {
  return new Response(
    JSON.stringify({ ok: false, error: message }),
    { status, headers: jsonHeaders },
  );
}

function classifyErrorStatus(message: string): number {
  if (
    message === "Missing authorization token." ||
    message === "Invalid session."
  ) {
    return 401;
  }

  if (
    message === "Your admin account is inactive." ||
    message === "Admin access is required."
  ) {
    return 403;
  }

  if (
    message.startsWith("Unsupported action:") ||
    message.startsWith("Unsupported role for assignment ") ||
    message.startsWith("Role is required for assignment ") ||
    message.endsWith(" role requires a sabha assignment.") ||
    message.endsWith(" role cannot be linked to a sabha.") ||
    message.startsWith("Duplicate role assignment found for ") ||
    VALIDATION_ERROR_MESSAGES.includes(message)
  ) {
    return 400;
  }

  return 500;
}

function normalizeText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeUsername(value: unknown): string | null {
  const text = normalizeText(value);
  return text ? text.toLowerCase() : null;
}

function normalizeEmail(value: unknown): string | null {
  const text = normalizeText(value);
  return text ? text.toLowerCase() : null;
}

function normalizeAssignments(input: unknown): Array<{ role: string; sabha_id: string | null; is_active: boolean }> {
  if (!Array.isArray(input) || input.length === 0) {
    throw new Error("At least one role assignment is required.");
  }

  const seen = new Set<string>();

  return input.map((item, index) => {
    const row = (item ?? {}) as AssignmentInput;
    const role = normalizeText(row.role);
    const sabhaId = normalizeText(row.sabha_id);
    const isActive = row.is_active !== false;

    if (!role) {
      throw new Error(`Role is required for assignment ${index + 1}.`);
    }

    if (!VALID_ROLES.has(role)) {
      throw new Error(`Unsupported role for assignment ${index + 1}.`);
    }

    if (SABHA_BOUND_ROLES.has(role) && !sabhaId) {
      throw new Error(`${role} role requires a sabha assignment.`);
    }

    if (!SABHA_BOUND_ROLES.has(role) && sabhaId) {
      throw new Error(`${role} role cannot be linked to a sabha.`);
    }

    const dedupeKey = `${role}::${sabhaId ?? "none"}`;
    if (seen.has(dedupeKey)) {
      throw new Error(`Duplicate role assignment found for ${role}.`);
    }
    seen.add(dedupeKey);

    return {
      role,
      sabha_id: sabhaId,
      is_active: isActive,
    };
  });
}

function validatePassword(password: string | null, isRequired: boolean) {
  if (!password) {
    if (isRequired) throw new Error("Password is required.");
    return;
  }

  if (password.length < 8) {
    throw new Error("Password must be at least 8 characters.");
  }
}

async function requireAdminUser(supabase: ReturnType<typeof createServiceClient>, jwt: string | null): Promise<string> {
  if (!jwt) {
    throw new Error("Missing authorization token.");
  }

  const { data: authData, error: authError } = await supabase.auth.getUser(jwt);
  if (authError) throw authError;

  const userId = authData?.user?.id ?? null;
  if (!userId) {
    throw new Error("Invalid session.");
  }

  const [{ data: profile, error: profileError }, { data: roleRows, error: roleError }] = await Promise.all([
    supabase
      .from("profiles")
      .select("is_active")
      .eq("user_id", userId)
      .maybeSingle(),
    supabase
      .from("user_sabha_roles")
      .select("id")
      .eq("user_id", userId)
      .eq("role", "admin")
      .eq("is_active", true)
      .limit(1),
  ]);

  if (profileError) throw profileError;
  if (roleError) throw roleError;

  if (profile?.is_active === false) {
    throw new Error("Your admin account is inactive.");
  }

  if (!roleRows || roleRows.length === 0) {
    throw new Error("Admin access is required.");
  }

  return userId;
}

async function loadBootstrapData(supabase: ReturnType<typeof createServiceClient>) {
  const [
    authUsersResult,
    profilesResult,
    rolesResult,
    sabhasResult,
  ] = await Promise.all([
    supabase.auth.admin.listUsers({ page: 1, perPage: 1000 }),
    supabase
      .from("profiles")
      .select("user_id, full_name, username, is_active"),
    supabase
      .from("user_sabha_roles")
      .select(`
        id,
        user_id,
        sabha_id,
        role,
        is_active,
        sabhas:sabha_id ( id, name, code )
      `)
      .order("created_at", { ascending: true }),
    supabase
      .from("sabhas")
      .select("id, name, code, is_active")
      .order("name", { ascending: true }),
  ]);

  if (authUsersResult.error) throw authUsersResult.error;
  if (profilesResult.error) throw profilesResult.error;
  if (rolesResult.error) throw rolesResult.error;
  if (sabhasResult.error) throw sabhasResult.error;

  const authUsers = authUsersResult.data?.users ?? [];
  const profiles = (profilesResult.data ?? []) as ProfileRow[];
  const roles = (rolesResult.data ?? []) as RoleRow[];
  const sabhas = sabhasResult.data ?? [];

  const profileByUserId = new Map(profiles.map((row) => [row.user_id, row]));
  const rolesByUserId = new Map<string, RoleRow[]>();

  for (const roleRow of roles) {
    const list = rolesByUserId.get(roleRow.user_id) ?? [];
    list.push(roleRow);
    rolesByUserId.set(roleRow.user_id, list);
  }

  const users = authUsers.map((authUser) => {
    const profile = profileByUserId.get(authUser.id);
    const assignments = (rolesByUserId.get(authUser.id) ?? []).map((roleRow) => ({
      id: roleRow.id,
      role: roleRow.role,
      sabha_id: roleRow.sabha_id,
      sabha_name: roleRow.sabhas?.name ?? null,
      sabha_code: roleRow.sabhas?.code ?? null,
      is_active: roleRow.is_active,
    }));

    const activeAssignments = assignments.filter((item) => item.is_active);
    const roleSummary = activeAssignments.length === 0
      ? "No active roles"
      : activeAssignments
          .map((item) => item.sabha_name ? `${item.role} - ${item.sabha_name}` : item.role)
          .join(", ");

    return {
      id: authUser.id,
      email: authUser.email ?? "",
      full_name: profile?.full_name ?? authUser.user_metadata?.full_name ?? "",
      username: profile?.username ?? "",
      is_active: profile?.is_active !== false,
      created_at: authUser.created_at ?? null,
      last_sign_in_at: authUser.last_sign_in_at ?? null,
      assignments,
      role_summary: roleSummary,
    };
  });

  return {
    users,
    sabhas,
  };
}

async function ensureUsernameAvailable(
  supabase: ReturnType<typeof createServiceClient>,
  username: string,
  excludeUserId?: string,
) {
  let query = supabase
    .from("profiles")
    .select("user_id")
    .eq("username", username)
    .limit(1);

  if (excludeUserId) {
    query = query.neq("user_id", excludeUserId);
  }

  const { data, error } = await query;
  if (error) throw error;

  if (data && data.length > 0) {
    throw new Error("Username already exists.");
  }
}

async function syncAssignments(
  supabase: ReturnType<typeof createServiceClient>,
  userId: string,
  nextAssignments: Array<{ role: string; sabha_id: string | null; is_active: boolean }>,
) {
  const { data: existingRows, error } = await supabase
    .from("user_sabha_roles")
    .select("id, role, sabha_id, is_active")
    .eq("user_id", userId);

  if (error) throw error;

  const existing = existingRows ?? [];
  const existingByKey = new Map(
    existing.map((row) => [`${row.role}::${row.sabha_id ?? "none"}`, row]),
  );

  const processedKeys = new Set<string>();

  for (const assignment of nextAssignments) {
    const key = `${assignment.role}::${assignment.sabha_id ?? "none"}`;
    processedKeys.add(key);
    const current = existingByKey.get(key);

    if (current) {
      if (current.is_active !== assignment.is_active) {
        const { error: updateError } = await supabase
          .from("user_sabha_roles")
          .update({ is_active: assignment.is_active })
          .eq("id", current.id);
        if (updateError) throw updateError;
      }
      continue;
    }

    const { error: insertError } = await supabase
      .from("user_sabha_roles")
      .insert({
        user_id: userId,
        role: assignment.role,
        sabha_id: assignment.sabha_id,
        is_active: assignment.is_active,
      });

    if (insertError) throw insertError;
  }

  for (const row of existing) {
    const key = `${row.role}::${row.sabha_id ?? "none"}`;
    if (processedKeys.has(key)) continue;

    const { error: deactivateError } = await supabase
      .from("user_sabha_roles")
      .update({ is_active: false })
      .eq("id", row.id);

    if (deactivateError) throw deactivateError;
  }
}

async function createUser(
  supabase: ReturnType<typeof createServiceClient>,
  payload: Record<string, unknown>,
) {
  const fullName = normalizeText(payload.full_name);
  const email = normalizeEmail(payload.email);
  const username = normalizeUsername(payload.username);
  const password = normalizeText(payload.password);
  const isActive = payload.is_active !== false;
  const assignments = normalizeAssignments(payload.assignments);

  if (!fullName) throw new Error("Full name is required.");
  if (!email) throw new Error("Email is required.");
  if (!username) throw new Error("Username is required.");
  validatePassword(password, true);

  await ensureUsernameAvailable(supabase, username);

  const { data: created, error: createError } = await supabase.auth.admin.createUser({
    email,
    password: password!,
    email_confirm: true,
    ban_duration: isActive ? "none" : USER_BAN_DURATION,
    user_metadata: { full_name: fullName },
  });

  if (createError) throw createError;

  const userId = created.user?.id;
  if (!userId) {
    throw new Error("Failed to create auth user.");
  }

  const { error: profileError } = await supabase
    .from("profiles")
    .upsert({
      user_id: userId,
      full_name: fullName,
      username,
      is_active: isActive,
    });

  if (profileError) throw profileError;
  await syncAssignments(supabase, userId, assignments);

  return { user_id: userId };
}

async function updateUser(
  supabase: ReturnType<typeof createServiceClient>,
  adminUserId: string,
  payload: Record<string, unknown>,
) {
  const userId = normalizeText(payload.user_id);
  const fullName = normalizeText(payload.full_name);
  const email = normalizeEmail(payload.email);
  const username = normalizeUsername(payload.username);
  const password = normalizeText(payload.password);
  const isActive = payload.is_active !== false;
  const assignments = normalizeAssignments(payload.assignments);

  if (!userId) throw new Error("user_id is required.");
  if (!fullName) throw new Error("Full name is required.");
  if (!email) throw new Error("Email is required.");
  if (!username) throw new Error("Username is required.");
  validatePassword(password, false);

  if (adminUserId === userId) {
    const keepsActiveAdmin = isActive && assignments.some((item) => item.role === "admin" && item.is_active);
    if (!keepsActiveAdmin) {
      throw new Error("You cannot remove your own active admin access.");
    }
  }

  await ensureUsernameAvailable(supabase, username, userId);

  const updatePayload: Record<string, unknown> = {
    email,
    ban_duration: isActive ? "none" : USER_BAN_DURATION,
    user_metadata: { full_name: fullName },
  };

  if (password) {
    updatePayload.password = password;
  }

  const { error: authUpdateError } = await supabase.auth.admin.updateUserById(userId, updatePayload);
  if (authUpdateError) throw authUpdateError;

  const { error: profileError } = await supabase
    .from("profiles")
    .upsert({
      user_id: userId,
      full_name: fullName,
      username,
      is_active: isActive,
    });

  if (profileError) throw profileError;
  await syncAssignments(supabase, userId, assignments);

  return { user_id: userId };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return errorResponse("Only POST is allowed.", 405);
  }

  try {
    const jwt = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null;
    const supabase = createServiceClient();
    const adminUserId = await requireAdminUser(supabase, jwt);
    const body = await req.json();
    const action = normalizeText(body?.action);
    const payload = (body?.payload ?? {}) as Record<string, unknown>;

    if (!action) {
      return errorResponse("Action is required.");
    }

    if (action === "bootstrap") {
      const data = await loadBootstrapData(supabase);
      return new Response(JSON.stringify({ ok: true, ...data }), {
        status: 200,
        headers: jsonHeaders,
      });
    }

    if (action === "create_user") {
      const result = await createUser(supabase, payload);
      const data = await loadBootstrapData(supabase);
      return new Response(JSON.stringify({ ok: true, result, ...data }), {
        status: 200,
        headers: jsonHeaders,
      });
    }

    if (action === "update_user") {
      const result = await updateUser(supabase, adminUserId, payload);
      const data = await loadBootstrapData(supabase);
      return new Response(JSON.stringify({ ok: true, result, ...data }), {
        status: 200,
        headers: jsonHeaders,
      });
    }

    return errorResponse(`Unsupported action: ${action}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return errorResponse(message, classifyErrorStatus(message));
  }
});
