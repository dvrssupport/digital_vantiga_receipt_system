import React from 'react';
import { Navigate } from 'react-router-dom';

const RoleBasedRouter = ({ children, allowedRoles = [] }) => {
  const userProfile = JSON.parse(localStorage.getItem('userProfile') || '{}');
  const { role } = userProfile;

  if (!role) {
    return <Navigate to="/login" replace />;
  }

  if (allowedRoles?.length > 0 && !allowedRoles?.includes(role)) {
    const defaultRoute = getDefaultRouteForRole(role);
    return <Navigate to={defaultRoute} replace />;
  }

  return <>{children}</>;
};

const getDefaultRouteForRole = (role) => {
  const roleRoutes = {
    admin: '/admin-users',
    scm_office: '/scm-office-dashboard',
    pratinidhi: '/sabha-dashboard',
    treasurer: '/sabha-dashboard',
    auditor: '/sabha-dashboard',
  };

  return roleRoutes?.[role] || '/login';
};

export default RoleBasedRouter;
