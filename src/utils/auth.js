export const ROLE_DEFAULT_ROUTES = {
  admin: '/admin-users',
  scm_office: '/scm-office-dashboard',
  general_manager: '/scm-office-dashboard',
  pratinidhi: '/sabha-dashboard',
  treasurer: '/sabha-dashboard',
  auditor: '/sabha-dashboard',
};

const ROLE_PRIORITY = ['admin', 'scm_office', 'general_manager', 'pratinidhi', 'treasurer', 'auditor'];

function rankRole(role) {
  const index = ROLE_PRIORITY.indexOf(role);
  return index === -1 ? ROLE_PRIORITY.length : index;
}

export function getDefaultRouteForRole(role) {
  return ROLE_DEFAULT_ROUTES[role] || '/login';
}

export async function resolveIdentifierToEmail(supabase, identifier) {
  const trimmed = String(identifier || '').trim();
  if (!trimmed) return '';
  if (trimmed.includes('@')) return trimmed.toLowerCase();

  const { data, error } = await supabase.rpc('resolve_login_email', {
    p_identifier: trimmed,
  });

  if (error) throw error;
  return data || '';
}

export async function fetchUserProfile(supabase, userId, fallbackEmail) {
  const [{ data: profile, error: profileError }, { data: roleRows, error: rolesError }] = await Promise.all([
    supabase
      .from('profiles')
      .select('full_name, username, is_active')
      .eq('user_id', userId)
      .maybeSingle(),
    supabase
      .from('user_sabha_roles')
      .select(`
        role,
        sabha_id,
        is_active,
        sabhas:sabha_id ( name )
      `)
      .eq('user_id', userId),
  ]);

  if (profileError) throw profileError;
  if (rolesError) throw rolesError;

  if (profile?.is_active === false) {
    throw new Error('Your account is inactive. Please contact admin.');
  }

  const activeRows = (roleRows || []).filter((row) => row?.is_active !== false);
  if (activeRows.length === 0) {
    throw new Error('Your role/sabha is not mapped to your user. Please contact admin.');
  }

  const picked = [...activeRows].sort((a, b) => rankRole(a?.role) - rankRole(b?.role))[0];

  return {
    role: picked?.role || 'pratinidhi',
    sabha: picked?.sabhas?.name || null,
    sabhaId: picked?.sabha_id || null,
    fullName:
      profile?.full_name ||
      (fallbackEmail ? fallbackEmail.split('@')[0] : 'User'),
    username: profile?.username || null,
    isActive: profile?.is_active !== false,
  };
}

export function persistUserSession(userProfile) {
  localStorage.setItem('isAuthenticated', 'true');
  localStorage.setItem('userProfile', JSON.stringify(userProfile));

  if (userProfile?.sabhaId) {
    localStorage.setItem('sabha_id', userProfile.sabhaId);
  } else {
    localStorage.removeItem('sabha_id');
  }
}

export function clearUserSession() {
  localStorage.removeItem('isAuthenticated');
  localStorage.removeItem('userProfile');
  localStorage.removeItem('sabha_id');
}
