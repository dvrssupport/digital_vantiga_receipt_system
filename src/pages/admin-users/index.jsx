import React, { useEffect, useMemo, useState } from 'react';
import toast, { Toaster } from 'react-hot-toast';
import CommonHeader from '../../components/ui/CommonHeader';
import Input from '../../components/ui/Input';
import Select from '../../components/ui/Select';
import Button from '../../components/ui/Button';
import Icon from '../../components/AppIcon';
import {
  createAdminManagedUser,
  fetchAdminBootstrap,
  updateAdminManagedUser,
} from '../../utils/adminApi';

const ROLE_OPTIONS = [
  { value: 'admin', label: 'Admin' },
  { value: 'scm_office', label: 'SCM Office' },
  { value: 'pratinidhi', label: 'Pratinidhi' },
  { value: 'treasurer', label: 'Treasurer' },
  { value: 'auditor', label: 'Auditor' },
];

const ROLE_LABELS = Object.fromEntries(ROLE_OPTIONS.map((item) => [item.value, item.label]));
const SABHA_BOUND_ROLES = new Set(['pratinidhi', 'treasurer', 'auditor']);

function createAssignmentRow() {
  return {
    id: `assignment-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    role: 'pratinidhi',
    sabhaId: '',
    isActive: true,
  };
}

function createEmptyForm() {
  return {
    userId: null,
    fullName: '',
    email: '',
    username: '',
    password: '',
    confirmPassword: '',
    isActive: true,
    assignments: [createAssignmentRow()],
  };
}

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

const AdminUsers = () => {
  const [adminProfile, setAdminProfile] = useState(null);
  const [users, setUsers] = useState([]);
  const [sabhas, setSabhas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [roleFilter, setRoleFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [selectedUserId, setSelectedUserId] = useState(null);
  const [mode, setMode] = useState('create');
  const [formData, setFormData] = useState(createEmptyForm());
  const [errors, setErrors] = useState({});

  useEffect(() => {
    const profile = JSON.parse(localStorage.getItem('userProfile') || '{}');
    setAdminProfile(profile);
  }, []);

  const sabhaOptions = useMemo(
    () => (sabhas || []).map((sabha) => ({
      value: sabha.id,
      label: sabha.is_active === false ? `${sabha.name} (${sabha.code}) - inactive` : `${sabha.name} (${sabha.code})`,
    })),
    [sabhas],
  );

  useEffect(() => {
    let mounted = true;

    const load = async () => {
      setLoading(true);
      try {
        const data = await fetchAdminBootstrap();
        if (!mounted) return;
        setUsers(data?.users || []);
        setSabhas(data?.sabhas || []);
      } catch (error) {
        console.error('Failed to load admin data:', error);
        if (mounted) {
          toast.error(error?.message || 'Failed to load admin data.');
        }
      } finally {
        if (mounted) setLoading(false);
      }
    };

    load();

    return () => {
      mounted = false;
    };
  }, []);

  const filteredUsers = useMemo(() => {
    const search = searchTerm.trim().toLowerCase();

    return users.filter((user) => {
      const matchesSearch =
        !search ||
        user?.full_name?.toLowerCase().includes(search) ||
        user?.email?.toLowerCase().includes(search) ||
        user?.username?.toLowerCase().includes(search) ||
        user?.role_summary?.toLowerCase().includes(search);

      const matchesRole =
        roleFilter === 'ALL' ||
        user?.assignments?.some((assignment) => assignment?.role === roleFilter && assignment?.is_active);

      const matchesStatus =
        statusFilter === 'ALL' ||
        (statusFilter === 'ACTIVE' ? user?.is_active : !user?.is_active);

      return matchesSearch && matchesRole && matchesStatus;
    });
  }, [users, searchTerm, roleFilter, statusFilter]);

  const selectedUser = useMemo(
    () => users.find((user) => user.id === selectedUserId) || null,
    [users, selectedUserId],
  );

  const beginCreate = () => {
    setMode('create');
    setSelectedUserId(null);
    setErrors({});
    setFormData(createEmptyForm());
  };

  const beginEdit = (user) => {
    setMode('edit');
    setSelectedUserId(user.id);
    setErrors({});
    setFormData({
      userId: user.id,
      fullName: user.full_name || '',
      email: user.email || '',
      username: user.username || '',
      password: '',
      confirmPassword: '',
      isActive: user.is_active !== false,
      assignments: (user.assignments?.length ? user.assignments : []).map((assignment) => ({
        id: assignment.id || createAssignmentRow().id,
        role: assignment.role,
        sabhaId: assignment.sabha_id || '',
        isActive: assignment.is_active !== false,
      })).concat(user.assignments?.length ? [] : [createAssignmentRow()]),
    });
  };

  const handleFieldChange = (name, value) => {
    setFormData((prev) => ({ ...prev, [name]: value }));
    if (errors?.[name]) {
      setErrors((prev) => ({ ...prev, [name]: '' }));
    }
  };

  const updateAssignment = (assignmentId, changes) => {
    setFormData((prev) => ({
      ...prev,
      assignments: prev.assignments.map((assignment) => {
        if (assignment.id !== assignmentId) return assignment;

        const nextAssignment = { ...assignment, ...changes };
        if (!SABHA_BOUND_ROLES.has(nextAssignment.role)) {
          nextAssignment.sabhaId = '';
        }
        return nextAssignment;
      }),
    }));
  };

  const addAssignment = () => {
    setFormData((prev) => ({
      ...prev,
      assignments: [...prev.assignments, createAssignmentRow()],
    }));
  };

  const removeAssignment = (assignmentId) => {
    setFormData((prev) => {
      if (prev.assignments.length === 1) return prev;
      return {
        ...prev,
        assignments: prev.assignments.filter((assignment) => assignment.id !== assignmentId),
      };
    });
  };

  const validateForm = () => {
    const nextErrors = {};

    if (!formData.fullName.trim()) nextErrors.fullName = 'Full name is required.';
    if (!formData.email.trim()) nextErrors.email = 'Email is required.';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email.trim())) nextErrors.email = 'Enter a valid email address.';

    if (!formData.username.trim()) nextErrors.username = 'Username is required.';
    else if (!/^[a-zA-Z0-9_.-]{3,30}$/.test(formData.username.trim())) nextErrors.username = 'Use 3-30 letters, numbers, ., _, or -.';

    if (mode === 'create' && !formData.password.trim()) {
      nextErrors.password = 'Password is required.';
    } else if (formData.password && formData.password.length < 8) {
      nextErrors.password = 'Password must be at least 8 characters.';
    }

    if (formData.password !== formData.confirmPassword) {
      nextErrors.confirmPassword = 'Passwords do not match.';
    }

    if (formData.assignments.length === 0) {
      nextErrors.assignments = 'At least one role assignment is required.';
    }

    const seen = new Set();
    formData.assignments.forEach((assignment, index) => {
      if (!assignment.role) {
        nextErrors[`assignment_role_${assignment.id}`] = 'Role is required.';
        return;
      }

      if (SABHA_BOUND_ROLES.has(assignment.role) && !assignment.sabhaId) {
        nextErrors[`assignment_sabha_${assignment.id}`] = 'Sabha is required for this role.';
      }

      const key = `${assignment.role}::${assignment.sabhaId || 'none'}`;
      if (seen.has(key)) {
        nextErrors[`assignment_role_${assignment.id}`] = `Duplicate assignment in row ${index + 1}.`;
      }
      seen.add(key);
    });

    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!validateForm()) return;

    setSaving(true);

    const payload = {
      user_id: formData.userId || undefined,
      full_name: formData.fullName.trim(),
      email: formData.email.trim().toLowerCase(),
      username: formData.username.trim().toLowerCase(),
      password: formData.password.trim() || undefined,
      is_active: formData.isActive,
      assignments: formData.assignments.map((assignment) => ({
        role: assignment.role,
        sabha_id: assignment.sabhaId || null,
        is_active: assignment.isActive,
      })),
    };

    try {
      const response = mode === 'create'
        ? await createAdminManagedUser(payload)
        : await updateAdminManagedUser(payload);

      setUsers(response?.users || []);
      setSabhas(response?.sabhas || []);

      const targetUserId = response?.result?.user_id || null;
      if (targetUserId) {
        const nextUser = (response?.users || []).find((item) => item.id === targetUserId);
        if (nextUser) {
          beginEdit(nextUser);
        }
      }

      toast.success(mode === 'create' ? 'User created successfully.' : 'User updated successfully.');
      if (mode === 'create' && !targetUserId) {
        beginCreate();
      }
    } catch (error) {
      console.error('Failed to save user:', error);
      toast.error(error?.message || 'Failed to save user.');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleUserStatus = async () => {
    if (mode !== 'edit' || !formData.userId) return;

    setSaving(true);
    try {
      const response = await updateAdminManagedUser({
        user_id: formData.userId,
        full_name: formData.fullName.trim(),
        email: formData.email.trim().toLowerCase(),
        username: formData.username.trim().toLowerCase(),
        is_active: !formData.isActive,
        assignments: formData.assignments.map((assignment) => ({
          role: assignment.role,
          sabha_id: assignment.sabhaId || null,
          is_active: assignment.isActive,
        })),
      });

      setUsers(response?.users || []);
      setSabhas(response?.sabhas || []);

      const nextUser = (response?.users || []).find((item) => item.id === formData.userId);
      if (nextUser) {
        beginEdit(nextUser);
      }

      toast.success(formData.isActive ? 'User deactivated.' : 'User reactivated.');
    } catch (error) {
      console.error('Failed to toggle user:', error);
      toast.error(error?.message || 'Failed to update user status.');
    } finally {
      setSaving(false);
    }
  };

  const roleFilterOptions = [
    { value: 'ALL', label: 'All Roles' },
    ...ROLE_OPTIONS,
  ];

  const statusFilterOptions = [
    { value: 'ALL', label: 'All Statuses' },
    { value: 'ACTIVE', label: 'Active Users' },
    { value: 'INACTIVE', label: 'Inactive Users' },
  ];

  if (loading) {
    return (
      <div className="min-h-screen bg-background">
        <CommonHeader />
        <div className="flex min-h-[70vh] items-center justify-center">
          <div className="flex items-center gap-3 text-muted-foreground">
            <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            <span>Loading admin workspace...</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Toaster position="top-right" />
      <CommonHeader />

      <div className="border-b border-border bg-card shadow-sm">
        <div className="container mx-auto px-4 py-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full bg-[#F97316]/10 px-3 py-1 text-sm font-medium text-[#C2410C]">
                <Icon name="ShieldCheck" size={16} />
                Separate Admin Portal
              </div>
              <h1 className="mt-3 text-3xl font-bold text-card-foreground">
                User Management
              </h1>
              <p className="mt-2 text-sm text-muted-foreground max-w-2xl">
                Create users, manage usernames and passwords, and control role-to-sabha access without touching the SCM Office dashboard flow.
              </p>
            </div>

            <div className="rounded-xl border border-border bg-background px-4 py-3 text-sm shadow-sm">
              <div className="font-semibold text-foreground">{adminProfile?.name || adminProfile?.email || 'Admin'}</div>
              <div className="text-muted-foreground">Role: {ROLE_LABELS[adminProfile?.role] || adminProfile?.role || 'Admin'}</div>
            </div>
          </div>
        </div>
      </div>

      <main className="container mx-auto px-4 py-8">
        <div className="grid gap-6 xl:grid-cols-[1.2fr_0.9fr]">
          <section className="rounded-2xl border border-border bg-card shadow-sm">
            <div className="border-b border-border px-6 py-5">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                <div>
                  <h2 className="text-xl font-semibold text-card-foreground">All Users</h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {filteredUsers.length} of {users.length} users shown
                  </p>
                </div>

                <div className="flex flex-col gap-3 md:flex-row md:items-end">
                  <div className="w-full md:w-72">
                    <Input
                      label="Search"
                      value={searchTerm}
                      onChange={(event) => setSearchTerm(event.target.value)}
                      placeholder="Search by name, email, username, or role"
                    />
                  </div>
                  <div className="w-full md:w-48">
                    <Select
                      label="Role"
                      value={roleFilter}
                      onChange={setRoleFilter}
                      options={roleFilterOptions}
                    />
                  </div>
                  <div className="w-full md:w-48">
                    <Select
                      label="Status"
                      value={statusFilter}
                      onChange={setStatusFilter}
                      options={statusFilterOptions}
                    />
                  </div>
                </div>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-border text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">User</th>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">Username</th>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">Assignments</th>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">Status</th>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">Last Sign In</th>
                    <th className="px-4 py-3 text-right font-medium text-muted-foreground">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filteredUsers.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-10 text-center text-muted-foreground">
                        No users match the current filters.
                      </td>
                    </tr>
                  ) : filteredUsers.map((user) => {
                    const isSelected = selectedUserId === user.id;
                    return (
                      <tr
                        key={user.id}
                        className={isSelected ? 'bg-[#FFF7ED]' : 'hover:bg-muted/30'}
                      >
                        <td className="px-4 py-4 align-top">
                          <div className="font-semibold text-foreground">{user.full_name || '—'}</div>
                          <div className="text-muted-foreground break-all">{user.email || '—'}</div>
                        </td>
                        <td className="px-4 py-4 align-top text-foreground">{user.username || '—'}</td>
                        <td className="px-4 py-4 align-top">
                          <div className="flex flex-wrap gap-2">
                            {(user.assignments || []).filter((assignment) => assignment.is_active).map((assignment) => (
                              <span
                                key={`${assignment.role}-${assignment.sabha_id || 'none'}`}
                                className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-foreground"
                              >
                                {ROLE_LABELS[assignment.role] || assignment.role}
                                {assignment.sabha_name ? ` • ${assignment.sabha_name}` : ''}
                              </span>
                            ))}
                            {(user.assignments || []).filter((assignment) => assignment.is_active).length === 0 && (
                              <span className="text-muted-foreground">No active assignments</span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-4 align-top">
                          <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${user.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>
                            {user.is_active ? 'Active' : 'Inactive'}
                          </span>
                        </td>
                        <td className="px-4 py-4 align-top text-muted-foreground">{formatDate(user.last_sign_in_at)}</td>
                        <td className="px-4 py-4 align-top text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => beginEdit(user)}
                            iconName="Pencil"
                            iconPosition="left"
                          >
                            Edit
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          <section className="rounded-2xl border border-border bg-card shadow-sm">
            <div className="border-b border-border px-6 py-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-xl font-semibold text-card-foreground">
                    {mode === 'create' ? 'Create User' : 'Edit User'}
                  </h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {mode === 'create'
                      ? 'Provision a new login with the right role and sabha access.'
                      : 'Update login details, permissions, and assignment activity.'}
                  </p>
                </div>

                <Button
                  variant="outline"
                  size="sm"
                  onClick={beginCreate}
                  iconName="UserPlus"
                  iconPosition="left"
                >
                  New User
                </Button>
              </div>
            </div>

            <form onSubmit={handleSubmit} className="space-y-6 px-6 py-6">
              <div className="grid gap-4 md:grid-cols-2">
                <Input
                  label="Full Name"
                  value={formData.fullName}
                  onChange={(event) => handleFieldChange('fullName', event.target.value)}
                  error={errors.fullName}
                  required
                />
                <Input
                  label="Email"
                  type="email"
                  value={formData.email}
                  onChange={(event) => handleFieldChange('email', event.target.value)}
                  error={errors.email}
                  required
                />
                <Input
                  label="Username"
                  value={formData.username}
                  onChange={(event) => handleFieldChange('username', event.target.value.toLowerCase())}
                  error={errors.username}
                  required
                  description="3-30 chars using letters, numbers, ., _, or -"
                />
                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground">
                    User Status
                  </label>
                  <div className="flex items-center gap-3 rounded-md border border-input bg-background px-3 py-2">
                    <button
                      type="button"
                      onClick={() => handleFieldChange('isActive', !formData.isActive)}
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${formData.isActive ? 'bg-emerald-500' : 'bg-muted-foreground/40'}`}
                    >
                      <span
                        className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${formData.isActive ? 'translate-x-5' : 'translate-x-1'}`}
                      />
                    </button>
                    <span className="text-sm text-foreground">
                      {formData.isActive ? 'User can sign in' : 'User is blocked from sign in'}
                    </span>
                  </div>
                </div>
                <Input
                  label={mode === 'create' ? 'Initial Password' : 'New Password'}
                  type="password"
                  value={formData.password}
                  onChange={(event) => handleFieldChange('password', event.target.value)}
                  error={errors.password}
                  required={mode === 'create'}
                  showPasswordToggle={true}
                  description={mode === 'edit' ? 'Leave blank to keep the current password.' : undefined}
                />
                <Input
                  label="Confirm Password"
                  type="password"
                  value={formData.confirmPassword}
                  onChange={(event) => handleFieldChange('confirmPassword', event.target.value)}
                  error={errors.confirmPassword}
                  required={mode === 'create' || Boolean(formData.password)}
                  showPasswordToggle={true}
                />
              </div>

              <div className="rounded-xl border border-border bg-muted/20 p-4">
                <div className="mb-4 flex items-start justify-between gap-4">
                  <div>
                    <h3 className="text-base font-semibold text-foreground">Role Assignments</h3>
                    <p className="text-sm text-muted-foreground">
                      Admin and SCM Office do not take a sabha. Sabha-bound roles require one.
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={addAssignment}
                    iconName="Plus"
                    iconPosition="left"
                  >
                    Add Assignment
                  </Button>
                </div>

                {errors.assignments && (
                  <p className="mb-3 text-sm text-destructive">{errors.assignments}</p>
                )}

                <div className="space-y-4">
                  {formData.assignments.map((assignment, index) => {
                    const roleError = errors[`assignment_role_${assignment.id}`];
                    const sabhaError = errors[`assignment_sabha_${assignment.id}`];
                    const needsSabha = SABHA_BOUND_ROLES.has(assignment.role);

                    return (
                      <div key={assignment.id} className="rounded-lg border border-border bg-background p-4">
                        <div className="mb-3 flex items-center justify-between">
                          <div className="text-sm font-medium text-foreground">Assignment {index + 1}</div>
                          <div className="flex items-center gap-2">
                            <Button
                              type="button"
                              variant={assignment.isActive ? 'success' : 'secondary'}
                              size="xs"
                              onClick={() => updateAssignment(assignment.id, { isActive: !assignment.isActive })}
                            >
                              {assignment.isActive ? 'Active' : 'Inactive'}
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="xs"
                              onClick={() => removeAssignment(assignment.id)}
                              disabled={formData.assignments.length === 1}
                              iconName="Trash2"
                            >
                              Remove
                            </Button>
                          </div>
                        </div>

                        <div className="grid gap-4 md:grid-cols-[1fr_1fr_auto]">
                          <Select
                            label="Role"
                            value={assignment.role}
                            onChange={(value) => updateAssignment(assignment.id, { role: value })}
                            options={ROLE_OPTIONS}
                            error={roleError}
                            required
                          />
                          <Select
                            label="Sabha"
                            value={assignment.sabhaId}
                            onChange={(value) => updateAssignment(assignment.id, { sabhaId: value })}
                            options={sabhaOptions}
                            error={sabhaError}
                            disabled={!needsSabha}
                            required={needsSabha}
                            placeholder={needsSabha ? 'Select sabha' : 'No sabha needed'}
                            searchable
                          />
                          <div className="pt-8 text-xs text-muted-foreground">
                            {needsSabha
                              ? 'This role is scoped to a sabha.'
                              : 'This role applies across the system.'}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {mode === 'edit' && selectedUser && (
                <div className="rounded-xl border border-border bg-muted/20 p-4 text-sm text-muted-foreground">
                  <div>Created: {formatDate(selectedUser.created_at)}</div>
                  <div className="mt-1">Last sign in: {formatDate(selectedUser.last_sign_in_at)}</div>
                </div>
              )}

              <div className="flex flex-wrap items-center justify-end gap-3">
                {mode === 'edit' && (
                  <Button
                    type="button"
                    variant={formData.isActive ? 'danger' : 'success'}
                    onClick={handleToggleUserStatus}
                    disabled={saving}
                  >
                    {formData.isActive ? 'Deactivate User' : 'Reactivate User'}
                  </Button>
                )}
                <Button
                  type="button"
                  variant="outline"
                  onClick={mode === 'create' ? beginCreate : () => beginEdit(selectedUser)}
                  disabled={saving || (mode === 'edit' && !selectedUser)}
                >
                  Reset
                </Button>
                <Button
                  type="submit"
                  variant="outline"
                  className="bg-[#F97316] text-white"
                  disabled={saving}
                >
                  {saving ? 'Saving...' : mode === 'create' ? 'Create User' : 'Save Changes'}
                </Button>
              </div>
            </form>
          </section>
        </div>
      </main>
    </div>
  );
};

export default AdminUsers;
