import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import Icon from '../AppIcon';

const UserProfileHeader = () => {
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const dropdownRef = useRef(null);
  const navigate = useNavigate();
  
  const userProfile = JSON.parse(localStorage.getItem('userProfile') || '{}');
  const { email = '', role = '', sabha = '' } = userProfile;

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef?.current && !dropdownRef?.current?.contains(event?.target)) {
        setIsDropdownOpen(false);
      }
    };

    if (isDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isDropdownOpen]);

  const handleLogout = () => {
    localStorage.removeItem('isAuthenticated');
    localStorage.removeItem('userProfile');
    localStorage.removeItem('redirectPath');
    setIsDropdownOpen(false);
    navigate('/login', { replace: true });
  };

  const toggleDropdown = () => {
    setIsDropdownOpen(!isDropdownOpen);
  };

  const getRoleDisplay = () => {
    if (role === 'scm_office') return 'SCM Office';
    if (role === 'general_manager') return 'General Manager';
    if (role === 'pratinidhi') return 'Pratinidhi';
    if (role === 'treasurer') return 'Treasurer';
    return role;
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={toggleDropdown}
        className="flex items-center gap-3 px-4 py-2 rounded-lg hover:bg-muted transition-smooth focus:outline-none focus:ring-2 focus:ring-ring"
        aria-expanded={isDropdownOpen}
        aria-haspopup="true"
      >
        <div className="hidden md:flex flex-col items-end">
          <span className="text-sm font-medium text-foreground">{email}</span>
          <span className="text-xs text-muted-foreground">
            {getRoleDisplay()}
            {sabha && ` - ${sabha}`}
          </span>
        </div>
        <div className="w-10 h-10 rounded-full bg-primary flex items-center justify-center">
          <Icon name="User" size={20} color="var(--color-primary-foreground)" />
        </div>
        <Icon 
          name={isDropdownOpen ? "ChevronUp" : "ChevronDown"} 
          size={16} 
          className="hidden md:block text-muted-foreground"
        />
      </button>

      {isDropdownOpen && (
        <div className="absolute right-0 mt-2 w-64 bg-popover border border-border rounded-lg shadow-lg elevation-lg z-50 animate-slide-in">
          <div className="p-4 border-b border-border md:hidden">
            <p className="text-sm font-medium text-popover-foreground">{email}</p>
            <p className="text-xs text-muted-foreground mt-1">
              {getRoleDisplay()}
              {sabha && ` - ${sabha}`}
            </p>
          </div>
          
          <div className="p-2">
            <button
              onClick={handleLogout}
              className="w-full flex items-center gap-3 px-4 py-2 text-sm text-destructive hover:bg-destructive/10 rounded-md transition-smooth"
            >
              <Icon name="LogOut" size={16} />
              <span>Logout</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default UserProfileHeader;
