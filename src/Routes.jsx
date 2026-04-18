import React from "react";
import { BrowserRouter, Routes as RouterRoutes, Route, Navigate } from "react-router-dom";
import ScrollToTop from "components/ScrollToTop";
import ErrorBoundary from "components/ErrorBoundary";

import Login from './pages/login';
import AdminLogin from './pages/admin-login';
import AdminUsers from './pages/admin-users';
import SabhaDashboard from './pages/sabha-dashboard';
import ReceiptPreview from './pages/receipt-preview';
import NewEntryForm from './pages/new-entry-form';
import ScmOfficeDashboard from './pages/scm-office-dashboard';
import AdminRoute from './components/ui/AdminRoute';

const Routes = () => {
  return (
    <BrowserRouter>
      <ErrorBoundary>
      <ScrollToTop />
      <RouterRoutes>
        {/* Define your route here */}
        <Route path="/" element={<Login />} />
        <Route path="/login" element={<Login />} />
        <Route path="/admin-login" element={<AdminLogin />} />
        <Route path="/sabha-dashboard" element={<SabhaDashboard />} />
        <Route path="/scm-office-dashboard" element={<ScmOfficeDashboard />} />
        <Route path="/receipt-preview" element={<ReceiptPreview />} />
        <Route path="/new-entry-form" element={<NewEntryForm />} />
        <Route
          path="/admin-users"
          element={
            <AdminRoute>
              <AdminUsers />
            </AdminRoute>
          }
        />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </RouterRoutes>
      </ErrorBoundary>
    </BrowserRouter>
  );
};

export default Routes;
