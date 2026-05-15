import React, { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { supabase } from '../../supabaseClient';
import {
  getDefaultRouteForRole,
  requireSupabaseSession,
} from '../../utils/auth';

const AdminRoute = ({ children }) => {
  const [isCheckingSession, setIsCheckingSession] = useState(true);
  const [hasSupabaseSession, setHasSupabaseSession] = useState(false);

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

  const isAuthenticated = localStorage.getItem('isAuthenticated') === 'true';
  const userProfile = JSON.parse(localStorage.getItem('userProfile') || '{}');

  if (isCheckingSession) {
    return null;
  }

  if (!isAuthenticated || !hasSupabaseSession) {
    return <Navigate to="/admin-login" replace />;
  }

  if (!userProfile?.role) {
    return <Navigate to="/admin-login" replace />;
  }

  if (userProfile.role !== 'admin') {
    return <Navigate to={getDefaultRouteForRole(userProfile.role)} replace />;
  }

  return <>{children}</>;
};

export default AdminRoute;
