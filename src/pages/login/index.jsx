import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Input from '../../components/ui/Input';
import Button from '../../components/ui/Button';
import Checkbox from '../../components/ui/Checkbox';
import { supabase } from '../../supabaseClient';
import {
  clearUserSession,
  fetchUserProfile,
  getDefaultRouteForRole,
  persistUserSession,
  resolveIdentifierToEmail,
} from '../../utils/auth';

const Login = () => {
  const logoUrl = new URL('../../../cropped-Math-Logo-Round.png', import.meta.url).href;
  const navigate = useNavigate();

  const [formData, setFormData] = useState({ identifier: '', password: '', email: '' });
  const [errors, setErrors] = useState({});
  const [isLoading, setIsLoading] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [showForgotPassword, setShowForgotPassword] = useState(false);

  useEffect(() => {
    const isAuthenticated = localStorage.getItem('isAuthenticated') === 'true';
    if (isAuthenticated) {
      const userProfile = JSON.parse(localStorage.getItem('userProfile') || '{}');
      navigate(getDefaultRouteForRole(userProfile?.role), { replace: true });
    }

    const savedIdentifier =
      localStorage.getItem('rememberedIdentifier') ||
      localStorage.getItem('rememberedEmail') ||
      '';
    const savedRememberMe = localStorage.getItem('rememberMe') === 'true';
    if (savedRememberMe && savedIdentifier) {
      setFormData((prev) => ({ ...prev, identifier: savedIdentifier }));
      setRememberMe(true);
    }
  }, [navigate]);

  const validateForm = () => {
    const newErrors = {};

    const identifier = formData?.identifier?.trim();
    if (!identifier) {
      newErrors.identifier = 'Email or username is required';
    } else if (identifier.includes('@')) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identifier)) {
        newErrors.identifier = 'Please enter a valid email address';
      }
    } else if (!/^[a-zA-Z0-9_.-]{3,30}$/.test(identifier)) {
      newErrors.identifier = 'Username must be 3-30 chars and can include letters, numbers, ., _, -';
    }

    if (!formData?.password?.trim()) newErrors.password = 'Password is required';
    else if (formData?.password?.length < 8) newErrors.password = 'Password must be at least 8 characters';

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleInputChange = (event) => {
    const { name, value } = event?.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    if (errors?.[name]) setErrors((prev) => ({ ...prev, [name]: '' }));
  };

  const handleSubmit = async (event) => {
    event?.preventDefault();
    if (!validateForm()) return;

    setIsLoading(true);

    try {
      const identifier = formData?.identifier?.trim();
      const emailToUse = await resolveIdentifierToEmail(supabase, identifier);

      if (!emailToUse) {
        setErrors({ password: 'Invalid email/username or password. Please try again.' });
        return;
      }

      const { data, error } = await supabase.auth.signInWithPassword({
        email: emailToUse,
        password: formData?.password,
      });

      if (error || !data?.user) {
        setErrors({ password: 'Invalid email/username or password. Please try again.' });
        return;
      }

      const user = data.user;
      const profile = await fetchUserProfile(supabase, user.id, user?.email || emailToUse);

      const userProfile = {
        user_id: user.id,
        email: user?.email,
        role: profile?.role,
        sabha: profile?.sabha,
        sabhaId: profile?.sabhaId,
        name: profile?.fullName,
        username: profile?.username || null,
      };

      persistUserSession(userProfile);

      if (rememberMe) {
        localStorage.setItem('rememberedIdentifier', identifier);
        if (identifier.includes('@')) localStorage.setItem('rememberedEmail', identifier);
        else localStorage.removeItem('rememberedEmail');
        localStorage.setItem('rememberMe', 'true');
      } else {
        localStorage.removeItem('rememberedIdentifier');
        localStorage.removeItem('rememberedEmail');
        localStorage.removeItem('rememberMe');
      }

      const redirectPath = localStorage.getItem('redirectPath');
      localStorage.removeItem('redirectPath');

      const roleDefault = getDefaultRouteForRole(profile?.role);
      const safeRedirect =
        profile?.role === 'scm_office'
          ? '/scm-office-dashboard'
          : profile?.role === 'admin'
            ? '/admin-users'
            : (redirectPath || roleDefault);

      navigate(safeRedirect, { replace: true });
    } catch (err) {
      console.error('Login error:', err);
      clearUserSession();
      setErrors({ password: err?.message || 'Login failed. Please try again.' });
    } finally {
      setIsLoading(false);
    }
  };

  const handleForgotPassword = () => {
    const identifier = formData?.identifier?.trim();
    if (identifier && identifier.includes('@')) {
      setFormData((prev) => ({ ...prev, email: identifier }));
    }
    setShowForgotPassword(true);
  };

  const handleForgotPasswordSubmit = async (event) => {
    event?.preventDefault();

    if (!formData?.email?.trim()) {
      setErrors({ email: 'Please enter your email address' });
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData?.email)) {
      setErrors({ email: 'Please enter a valid email address' });
      return;
    }

    try {
      const { error } = await supabase.auth.resetPasswordForEmail(formData.email.trim(), {
        redirectTo: window.location.origin + '/reset-password',
      });
      if (error) throw error;

      alert(`Password reset instructions have been sent to ${formData?.email}. Please check your inbox.`);
      setShowForgotPassword(false);
      setErrors({});
    } catch (err) {
      console.error('Forgot password error:', err);
      setErrors({ email: err?.message || 'Failed to send reset email. Please try again.' });
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="bg-card rounded-lg shadow-lg elevation-lg p-8">
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-20 h-20 bg-transperant rounded-full mb-4">
              <img src={logoUrl} alt="SCM Vantiga Portal" className="w-20 h-20" />
            </div>
            <h1 className="text-2xl font-semibold text-card-foreground mb-2">
              {showForgotPassword ? 'Reset Password' : 'Digital Vantiga Receipt System'}
            </h1>
            <p className="text-sm text-muted-foreground">
              {showForgotPassword
                ? 'Enter your email to receive reset instructions'
                : 'Sign in to access your dashboard'}
            </p>
          </div>

          {!showForgotPassword ? (
            <form onSubmit={handleSubmit} className="space-y-6">
              <Input
                label="Email Or Username"
                type="text"
                name="identifier"
                placeholder="Enter email or username"
                value={formData?.identifier}
                onChange={handleInputChange}
                error={errors?.identifier}
                required
                disabled={isLoading}
              />

              <Input
                label="Password"
                type="password"
                name="password"
                placeholder="Enter your password"
                value={formData?.password}
                onChange={handleInputChange}
                error={errors?.password}
                required
                disabled={isLoading}
                showPasswordToggle={true}
              />

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="remember-me"
                    checked={rememberMe}
                    onCheckedChange={setRememberMe}
                    disabled={isLoading}
                  />
                  <label
                    htmlFor="remember-me"
                    className="text-sm font-medium text-foreground cursor-pointer select-none"
                  >
                    Remember me
                  </label>
                </div>

                <button
                  type="button"
                  onClick={handleForgotPassword}
                  className="text-sm text-primary hover:underline"
                >
                  Forgot password?
                </button>
              </div>

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
                <Link to="/admin-login" className="text-sm text-primary hover:underline">
                  Admin sign in
                </Link>
              </div>
            </form>
          ) : (
            <form onSubmit={handleForgotPasswordSubmit} className="space-y-6">
              <Input
                label="Email Address"
                type="email"
                name="email"
                placeholder="Enter your email"
                value={formData?.email}
                onChange={handleInputChange}
                error={errors?.email}
                required
              />

              <div className="flex gap-3">
                <Button
                  type="button"
                  variant="outline"
                  fullWidth
                  onClick={() => {
                    setShowForgotPassword(false);
                    setErrors({});
                  }}
                >
                  Cancel
                </Button>
                <Button type="submit" variant="default" fullWidth>
                  Send Reset Link
                </Button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};

export default Login;
