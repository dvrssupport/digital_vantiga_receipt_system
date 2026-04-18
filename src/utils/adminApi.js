import { supabase } from '../supabaseClient';

async function invokeAdminAction(action, payload = {}) {
  const { data, error } = await supabase.functions.invoke('admin-user-management', {
    body: { action, payload },
  });

  if (error) {
    throw error;
  }

  if (!data?.ok) {
    throw new Error(data?.error || 'Admin operation failed.');
  }

  return data;
}

export async function fetchAdminBootstrap() {
  return invokeAdminAction('bootstrap');
}

export async function createAdminManagedUser(payload) {
  return invokeAdminAction('create_user', payload);
}

export async function updateAdminManagedUser(payload) {
  return invokeAdminAction('update_user', payload);
}
