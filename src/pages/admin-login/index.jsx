import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Input from '../../components/ui/Input';
import Button from '../../components/ui/Button';
import { supabase } from '../../supabaseClient';
import {
  clearUserSession,
  fetchUserProfile,
  getDefaultRouteForRole,
  persistUserSession,
  requireSupabaseSession,
  resolveIdentifierToEmail,
} from '../../utils/auth';

const AdminLogin = () => {
  const navigate = useNavigate();
  const logoUrl = new URL('../../../cropped-Math-Logo-Round.png', import.meta.url).href;
  const [formData, setFormData] = useState({ identifier: '', password: '' });
  const [errors, setErrors] = useState({});
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    let isMounted = true;

    const redirectIfSessionIsValid = async () => {
      const isAuthenticated = localStorage.getItem('isAuthenticated') === 'true';
      if (!isAuthenticated) return;

      try {
        await requireSupabaseSession(supabase);
        if (!isMounted) return;

        const userProfile = JSON.parse(localStorage.getItem('userProfile') || '{}');
        navigate(getDefaultRouteForRole(userProfile?.role), { replace: true });
      } catch {
        clearUserSession();
      }
    };

    redirectIfSessionIsValid();

    return () => {
      isMounted = false;
    };
  }, [navigate]);

  const handleInputChange = (event) => {
    const { name, value } = event.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    if (errors?.[name]) {
      setErrors((prev) => ({ ...prev, [name]: '' }));
    }
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    const identifier = formData.identifier.trim();
    const password = formData.password;

    if (!identifier || !password) {
      setErrors({
        identifier: !identifier ? 'Email or username is required' : '',
        password: !password ? 'Password is required' : '',
      });
      return;
    }

    setIsLoading(true);

    try {
      const email = await resolveIdentifierToEmail(supabase, identifier);
      if (!email) {
        throw new Error('Invalid email/username or password. Please try again.');
      }

      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error || !data?.user) {
        throw new Error('Invalid email/username or password. Please try again.');
      }

      const profile = await fetchUserProfile(supabase, data.user.id, data.user.email || email);
      if (profile?.role !== 'admin') {
        await supabase.auth.signOut();
        clearUserSession();
        throw new Error('This login is for admin users only.');
      }

      persistUserSession({
        user_id: data.user.id,
        email: data.user.email,
        role: profile.role,
        sabha: profile.sabha,
        sabhaId: profile.sabhaId,
        name: profile.fullName,
        username: profile.username || null,
      });

      navigate('/admin-users', { replace: true });
    } catch (error) {
      console.error('Admin login error:', error);
      clearUserSession();
      setErrors({ password: error?.message || 'Admin login failed. Please try again.' });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="bg-card rounded-lg shadow-lg elevation-lg p-8">
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-20 h-20 rounded-full mb-4">
              <img src={logoUrl} alt="SCM Vantiga Portal" className="w-20 h-20" />
            </div>
            <h1 className="text-2xl font-semibold text-card-foreground mb-2">
              Admin Portal Sign In
            </h1>
            <p className="text-sm text-muted-foreground">
              Use your separate admin credentials to manage users and access.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-6">
            <Input
              label="Email Or Username"
              type="text"
              name="identifier"
              placeholder="Enter email or username"
              value={formData.identifier}
              onChange={handleInputChange}
              error={errors.identifier}
              required
              disabled={isLoading}
            />

            <Input
              label="Password"
              type="password"
              name="password"
              placeholder="Enter admin password"
              value={formData.password}
              onChange={handleInputChange}
              error={errors.password}
              required
              disabled={isLoading}
              showPasswordToggle={true}
            />

            <Button
              type="submit"
              variant="outline"
              fullWidth
              loading={isLoading}
              disabled={isLoading}
              className="bg-[#F97316] text-white"
            >
              Sign In
            </Button>

            <div className="text-center">
              <Link to="/login" className="text-sm text-primary hover:underline">
                Back to user sign in
              </Link>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

export default AdminLogin;
