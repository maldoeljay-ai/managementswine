import { useState } from 'react';
import { supabase } from '../lib/supabase';
import SyncStatus from './SyncStatus';
import Swal from 'sweetalert2';
import { useSyncStatus } from '../hooks/useSyncStatus';



const moduleIcons = {
  dashboard: 'fa-tachometer-alt',
  breeding: 'fa-heartbeat',
  fatteners: 'fa-weight',
  feeding: 'fa-utensils',
  health: 'fa-stethoscope',
  inventory: 'fa-boxes',
  growth: 'fa-chart-line',
  financial: 'fa-coins',
  reports: 'fa-chart-pie',
  users: 'fa-users-cog',
  farm: 'fa-door-open',
  admin_overview: 'fa-chart-bar',
  admin_users: 'fa-users',
  admin_farms: 'fa-tractor',
  admin_roles: 'fa-user-shield',
  admin_invitations: 'fa-envelope-open-text',
  admin_audit: 'fa-list-ul'
};

const moduleNames = {
  dashboard: 'Farm Hub',
  breeding: 'Breeding Manager',
  fatteners: 'Fatteners',
  feeding: 'Smart Feeding',
  health: 'Health Watch',
  inventory: 'AI Inventory',
  growth: 'Growth & Mortality',
  financial: 'Financial Ledger',
  reports: 'Analytics Pro',
  users: 'User Roles',
  farm: 'Farm Access',
  admin_overview: 'Overview',
  admin_users: 'Users',
  admin_farms: 'Farms',
  admin_roles: 'Roles & Permissions',
  admin_invitations: 'Invitations',
  admin_audit: 'Audit Log'
};

export default function Sidebar({
  activeModule, setActiveModule, allowedModules, profile,
  notificationCount = 0, onOpenNotifications,
  activeFarmId, farmName, managedFarms = [], onFarmChange
}) {
  const [isOpen, setIsOpen] = useState(false);
  const { online } = useSyncStatus();

  const toggleSidebar = () => setIsOpen(!isOpen);
  const closeSidebar = () => setIsOpen(false);

  const handleLogout = async () => {
    const result = await Swal.fire({
      title: 'Are you sure?',
      text: 'You will be logged out of the system.',
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#d33',
      cancelButtonColor: '#3085d6',
      confirmButtonText: 'Yes, logout',
      cancelButtonText: 'Cancel'
    });

    if (result.isConfirmed) {
      await supabase.auth.signOut();
      // Intentionally keeping local DB and active farm so data is preserved for the next session

      await Swal.fire({
        title: 'Logged Out',
        text: 'You have been successfully logged out.',
        icon: 'success',
        timer: 1500,
        showConfirmButton: false
      });
      window.location.reload();
    }
  };

  // --- Inline styles for the sidebar slide ---
  const sidebarStyles = {
    width: 280,
    background: 'rgba(255,255,255,0.95)',
    backdropFilter: 'blur(8px)',
    boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)',
    display: 'flex',
    flexDirection: 'column',
    borderRight: '1px solid #e5e7eb',
    position: 'fixed',
    top: 0,
    left: 0,
    bottom: 0,
    zIndex: 1000,
    transform: isOpen ? 'translateX(0)' : 'translateX(-100%)',
    transition: 'transform 0.3s ease',
    overflowY: 'auto',
  };

  // Show bell for all authenticated roles
  const showBell = !!profile?.role;

  return (
    <>
      {/* Overlay for mobile */}
      {isOpen && (
        <div
          onClick={closeSidebar}
          style={{
            position: 'fixed',
            top: 0, left: 0, right: 0, bottom: 0,
            background: 'rgba(0,0,0,0.5)',
            zIndex: 999,
            display: 'block',
          }}
        />
      )}

      {/* Hamburger toggle (visible only on small screens) */}
      <button
        onClick={toggleSidebar}
        className="hamburger-toggle"
        style={{
          position: 'fixed',
          top: '16px',
          left: '16px',
          zIndex: 1001,
          background: '#059669',
          color: 'white',
          border: 'none',
          borderRadius: '8px',
          padding: '10px 12px',
          fontSize: '20px',
          cursor: 'pointer',
          display: 'none',
          boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
        }}
        aria-label="Toggle sidebar"
      >
        <i className="fas fa-bars"></i>
      </button>

      {/* The sidebar */}
      <aside style={sidebarStyles}>
        {/* Logo & header */}
        <div style={{ padding: 20, borderBottom: '1px solid #e5e7eb', display: 'flex', alignItems: 'center', gap: 12 }}>
          <i className="fas fa-piggy-bank" style={{ fontSize: 32, color: '#059669' }}></i>
          <div>
            <span style={{ fontWeight: 900, fontSize: 20, color: '#1f2937' }}>SwineSync</span>
            <span style={{ marginLeft: 8, fontSize: 10, background: '#d1fae5', color: '#047857', padding: '2px 8px', borderRadius: 999 }}>v2.0</span>
            {!online && (
              <span style={{ marginLeft: 8, fontSize: 10, background: '#fee2e2', color: '#ef4444', padding: '2px 8px', borderRadius: 999, fontWeight: 'bold' }} title="Offline Mode">
                <i className="fas fa-wifi" style={{ textDecoration: 'line-through', marginRight: 4 }}></i>Offline
              </span>
            )}
          </div>
          <button
            onClick={closeSidebar}
            className="close-sidebar-btn"
            style={{ marginLeft: 'auto', background: 'none', border: 'none', color: '#6b7280', fontSize: 20, cursor: 'pointer', display: 'none' }}
          >
            <i className="fas fa-times"></i>
          </button>
        </div>

        {/* User profile row */}
        <div style={{ padding: 16, background: '#ecfdf5', margin: 12, borderRadius: 20, display: 'flex', alignItems: 'center', gap: 12, boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.02)' }}>
          <i className="fas fa-user-circle" style={{ fontSize: 36, color: '#047857' }}></i>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ fontWeight: 'bold', margin: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{profile?.username || 'Farmer'}</p>
            <p style={{ fontSize: 12, color: '#6b7280', margin: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {profile?.role || 'Role'}
            </p>
            {activeFarmId && (
              <p style={{ fontSize: 11, color: '#059669', margin: '2px 0 0 0', fontWeight: '700', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={farmName || 'My Farm'}>
                <i className="fas fa-map-marker-alt" style={{ marginRight: 4 }}></i>
                {farmName || 'My Farm'}
              </p>
            )}
          </div>
          {/* Notification Bell — only for Owner/Admin */}
          {showBell && (
            <button
              onClick={() => { if (onOpenNotifications) onOpenNotifications(); }}
              title="Notifications"
              style={{
                position: 'relative',
                background: notificationCount > 0 ? '#fee2e2' : '#f3f4f6',
                border: 'none',
                borderRadius: '50%',
                width: 36,
                height: 36,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: notificationCount > 0 ? '#ef4444' : '#6b7280',
                transition: 'all 0.2s',
                animation: notificationCount > 0 ? 'bellRing 1.5s ease infinite' : 'none',
              }}
            >
              <i className="fas fa-bell" style={{ fontSize: 16 }}></i>
              {notificationCount > 0 && (
                <span style={{
                  position: 'absolute',
                  top: -4,
                  right: -4,
                  background: '#ef4444',
                  color: 'white',
                  borderRadius: '50%',
                  width: 18,
                  height: 18,
                  fontSize: 11,
                  fontWeight: 700,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  boxShadow: '0 0 0 2px white',
                  animation: 'pulse 1.5s ease infinite',
                }}>
                  {notificationCount > 9 ? '9+' : notificationCount}
                </span>
              )}
            </button>
          )}
        </div>
        
        {/* Supervisor Menu: Switch Managed Farms */}
        {managedFarms.length > 0 && (
          <div style={{ padding: '0 16px', marginBottom: 12 }}>
            <div style={{ padding: '8px 4px', fontSize: 11, fontWeight: 'bold', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Supervised Farms
            </div>
            <select
              value={activeFarmId || profile?.id}
              onChange={(e) => {
                const selectedId = e.target.value;
                const selectedName = e.target.options[e.target.selectedIndex].text;
                if (onFarmChange) onFarmChange(selectedId, selectedName);
              }}
              style={{
                width: '100%',
                padding: '8px 12px',
                borderRadius: '8px',
                border: '1px solid #d1d5db',
                background: '#f9fafb',
                color: '#374151',
                fontSize: 13,
                outline: 'none',
                cursor: 'pointer'
              }}
            >
              <option value={profile?.id}>My Farm (Personal)</option>
              {managedFarms.map(f => (
                <option key={f.id} value={f.farm_id || f.id}>
                  {f.username}'s Farm
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Navigation */}
        <nav style={{ flex: 1, padding: '0 16px 12px 16px', display: 'flex', flexDirection: 'column', gap: 6, overflowY: 'auto' }}>
          {profile?.role === 'Admin' && (
            <div style={{ padding: '8px 4px', fontSize: 11, fontWeight: 'bold', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '4px' }}>
              Administration
            </div>
          )}
          {allowedModules.map(module => (
            <button
              key={module}
              onClick={() => {
                setActiveModule(module);
                closeSidebar();
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '10px 16px',
                borderRadius: 12,
                border: 'none',
                background: activeModule === module ? '#d1fae5' : 'transparent',
                color: activeModule === module ? '#065f46' : '#4b5563',
                fontWeight: 500,
                cursor: 'pointer',
                transition: 'all 0.2s',
                textAlign: 'left',
                width: '100%',
              }}
            >
              <i className={`fas ${moduleIcons[module]}`} style={{ width: 24 }}></i>
              {moduleNames[module]}
            </button>
          ))}
        </nav>

        <div style={{ padding: 16, borderTop: '1px solid #e5e7eb', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <button onClick={handleLogout} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px', background: '#fee2e2', color: '#ef4444', border: 'none', borderRadius: 12, cursor: 'pointer', fontWeight: 500, width: '100%', justifyContent: 'center', transition: 'background 0.2s' }}>
            <i className="fas fa-sign-out-alt"></i>
            Logout
          </button>
          {!online && (
            <div style={{ padding: '8px 12px', background: '#fee2e2', color: '#b91c1c', borderRadius: 8, fontSize: 13, display: 'flex', alignItems: 'center', gap: 8, fontWeight: 500 }}>
              <i className="fas fa-wifi" style={{ textDecoration: 'line-through' }}></i>
              No Internet Connection
            </div>
          )}
          <SyncStatus />
        </div>
      </aside>

      {/* Responsive CSS */}
      <style>{`
        @media (max-width: 1023px) {
          .hamburger-toggle { display: block !important; }
          .close-sidebar-btn { display: block !important; }
        }
        @media (min-width: 1024px) {
          .hamburger-toggle { display: none !important; }
          .close-sidebar-btn { display: none !important; }
          aside {
            transform: translateX(0) !important;
            position: sticky !important;
            top: 0;
            height: 100vh;
            width: 280px !important;
          }
        }
        @keyframes bellRing {
          0%, 100% { transform: rotate(0deg); }
          10%, 30% { transform: rotate(-10deg); }
          20%, 40% { transform: rotate(10deg); }
          50% { transform: rotate(0deg); }
        }
        @keyframes pulse {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.15); }
        }
      `}</style>
    </>
  );
}