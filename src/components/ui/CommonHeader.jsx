import React from 'react';
import { useNavigate } from 'react-router-dom';
import Button from './Button';
import { supabase } from '../../supabaseClient';
import { clearUserSession } from '../../utils/auth';

const CommonHeader = () => {
  const navigate = useNavigate();
  const logoUrl = new URL('../../../cropped-Math-Logo-Round.png', import.meta.url).href;
  const handleLogout = async () => {
    try {
      await supabase.auth.signOut();
    } catch (error) {
      console.warn('Sign out failed:', error);
    }
    clearUserSession();
    navigate('/login', { replace: true });
  };

  return (
    <header className="bg-card border-b border-border shadow-sm">
      <div className="container mx-auto px-4 py-4">
        <div className="flex items-center justify-between">
          {/* Left: App Icon + Portal Name */}
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg flex items-center justify-center">
              <img
                src={logoUrl}
                alt="SCM Vantiga Portal"
                className="w-10 h-10 object-contain"
              />
            </div>
            <h1 className="text-xl font-semibold text-card-foreground">
              Digital Vantiga Receipt System
            </h1>
          </div>

          {/* Right: Logout Button */}
          <div className="flex items-center">
            {/* Desktop: Icon + Text */}
            <Button
              variant="ghost"
              size="sm"
              onClick={handleLogout}
              iconName="LogOut"
              iconPosition="left"
              className="hidden md:flex"
            >
              Logout
            </Button>

            {/* Mobile: Icon Only */}
            <Button
              variant="ghost"
              size="sm"
              onClick={handleLogout}
              iconName="LogOut"
              className="md:hidden"
              title="Logout"
            />
          </div>
        </div>
      </div>
    </header>
  );
};

export default CommonHeader;
