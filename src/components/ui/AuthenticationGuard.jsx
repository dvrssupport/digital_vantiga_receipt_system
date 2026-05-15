import React, { useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { supabase } from '../../supabaseClient';
import { requireSupabaseSession } from '../../utils/auth';

const AuthenticationGuard = ({ children }) => {
  const location = useLocation();
  const [isCheckingSession, setIsCheckingSession] = useState(true);
  const [hasSupabaseSession, setHasSupabaseSession] = useState(false);
  const isAuthenticated = localStorage.getItem('isAuthenticated') === 'true';
  const userProfile = JSON.parse(localStorage.getItem('userProfile') || '{}');

  useEffect(() => {
    let isMounted = true;

    const checkSession = async () => {
      try {
        await requireSupabaseSession(supabase);
        if (isMounted) setHasSupabaseSession(true);
      } catch {
        if (isMounted) setHasSupabaseSession(false);
      } finally {
        if (isMounted) setIsCheckingSession(false);
      }
    };

    checkSession();

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (!isAuthenticated && location?.pathname !== '/login') {
      localStorage.setItem('redirectPath', location?.pathname);
    }
  }, [isAuthenticated, location?.pathname]);

  if (isCheckingSession) {
    return null;
  }

  if (!isAuthenticated || !hasSupabaseSession) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (!userProfile?.role || !userProfile?.email) {
    localStorage.removeItem('isAuthenticated');
    localStorage.removeItem('userProfile');
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
};

export default AuthenticationGuard;
