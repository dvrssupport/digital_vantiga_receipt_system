import React from 'react';
import { Navigate } from 'react-router-dom';
import { getDefaultRouteForRole } from '../../utils/auth';

const AdminRoute = ({ children }) => {
  const isAuthenticated = localStorage.getItem('isAuthenticated') === 'true';
  const userProfile = JSON.parse(localStorage.getItem('userProfile') || '{}');

  if (!isAuthenticated) {
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
