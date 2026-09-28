import { useState, useEffect, useCallback } from 'react'
import { supabase } from './lib/supabase'
import { dataAPI, getActiveFarm, setActiveFarm } from './lib/data'
import { isOnline } from './lib/sync'
import { getUnreadCount, subscribeToNotifications } from './lib/notifications'
import { useSyncStatus } from './hooks/useSyncStatus'
import { useRealtimeSync } from './hooks/useRealtimeSync'
import './App.css'
import Login from './components/Login'
import Sidebar from './components/Sidebar'
import Dashboard from './components/Dashboard'
import Breeding from './components/Breeding'
import Fatteners from './components/Fatteners'
import Feeding from './components/Feeding'
import Health from './components/Health'
import Inventory from './components/Inventory'
import GrowthMortality from './components/GrowthMortality'
import Financial from './components/Financial'
import Reports from './components/Reports'
import UserManagement from './components/UserManagement'
import NotificationsPanel from './components/NotificationsPanel'
import ResetPassword from './components/ResetPassword'
import FarmInvite from './components/FarmInvite'

const modules = {
  dashboard: Dashboard,
  breeding: Breeding,
  fatteners: Fatteners,
  feeding: Feeding,
  health: Health,
  inventory: Inventory,
  growth: GrowthMortality,
  financial: Financial,
  reports: Reports,
  users: UserManagement,
  farm: FarmInvite,
  admin_overview: UserManagement,
  admin_users: UserManagement,
  admin_farms: UserManagement,
  admin_roles: UserManagement,
  admin_invitations: UserManagement,
  admin_audit: UserManagement
}

const PROFILE_CACHE_KEY = 'swinesync_cached_profile'
const SESSION_CACHE_KEY = 'swinesync_cached_session'

function App() {
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)

  const [activeModule, setActiveModule] = useState('dashboard')
  const [currentTime, setCurrentTime] = useState(new Date())
  const [notificationCount, setNotificationCount] = useState(0)
  const [notifPanelOpen, setNotifPanelOpen] = useState(false)
  const [syncToast, setSyncToast] = useState(null) // { message, type }
  const [isRecovering, setIsRecovering] = useState(false)

  const [userFarms, setUserFarms] = useState([])
  const [activeFarmState, setActiveFarmState] = useState(getActiveFarm())

  const { online, pendingCount, syncing, lastSynced, triggerSync } = useSyncStatus()
  useRealtimeSync() // Subscribe to Supabase Realtime for instant cross-device updates

  // --- Auth & session handling (with offline fallback) ---
  useEffect(() => {
    async function initSession() {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        setSession(session)
        if (session) {
          try {
            localStorage.setItem(SESSION_CACHE_KEY, JSON.stringify({
              user: { id: session.user.id, email: session.user.email }
            }))
          } catch (e) { /* ignore storage errors */ }
          await fetchProfile(session.user.id)
        } else {
          if (!isOnline()) {
            const cachedSession = loadCachedSession()
            const cachedProfile = loadCachedProfile()
            if (cachedSession && cachedProfile) {
              setSession(cachedSession)
              setProfile(cachedProfile)
              const farmId = cachedProfile.farm_id || cachedProfile.id || localStorage.getItem('swinesync_active_farm') || 'default_farm';
              setActiveFarm(farmId);
              setActiveFarmState(farmId);
            }
          }
          setLoading(false)
        }
      } catch (err) {
        console.error('Session init error:', err)
        const cachedSession = loadCachedSession()
        const cachedProfile = loadCachedProfile()
        if (cachedSession && cachedProfile) {
          setSession(cachedSession)
          setProfile(cachedProfile)
          const farmId = cachedProfile.farm_id || cachedProfile.id || localStorage.getItem('swinesync_active_farm') || 'default_farm';
          setActiveFarm(farmId);
          setActiveFarmState(farmId);
        }
        setLoading(false)
      }
    }
    initSession()

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      setSession(session)
      if (event === 'PASSWORD_RECOVERY') {
        setIsRecovering(true)
      }
      if (session) {
        try {
          localStorage.setItem(SESSION_CACHE_KEY, JSON.stringify({
            user: { id: session.user.id, email: session.user.email }
          }))
        } catch (e) { /* ignore */ }
        fetchProfile(session.user.id)
      } else {
        setProfile(null)
        // Clear farm context on logout so next user starts fresh
        setActiveFarm(null)
        setActiveFarmState(null)
        try {
          localStorage.removeItem(PROFILE_CACHE_KEY)
          localStorage.removeItem(SESSION_CACHE_KEY)
          localStorage.removeItem('swinesync_active_farm')
        } catch (e) { /* ignore */ }
      }
      setLoading(false)
    })

    const timer = setInterval(() => setCurrentTime(new Date()), 1000)
    return () => {
      subscription.unsubscribe()
      clearInterval(timer)
    }
  }, [])

  const [hadOfflineChanges, setHadOfflineChanges] = useState(false)

  useEffect(() => {
    if (pendingCount > 0) {
      setHadOfflineChanges(true)
    }
  }, [pendingCount])

  // --- Show toast when sync completes and clears pending items ---
  useEffect(() => {
    if (lastSynced && pendingCount === 0 && hadOfflineChanges) {
      setSyncToast({ message: 'All offline changes synced ✓', type: 'success' })
      setHadOfflineChanges(false)
      const t = setTimeout(() => setSyncToast(null), 4000)
      return () => clearTimeout(t)
    }
  }, [lastSynced, pendingCount, hadOfflineChanges])

  // --- 🔔 Notification count polling + real-time subscription ---
  const refreshNotifCount = useCallback(async (role) => {
    if (!role) return 0
    try {
      const count = await getUnreadCount(role)
      setNotificationCount(count)
      return count
    } catch (e) { return 0 }
  }, [])

  useEffect(() => {
    if (!profile?.role) return

    refreshNotifCount(profile.role).then(count => {
      if (count > 0) {
        setNotifPanelOpen(true)
      }
    })

    // Poll every 30 seconds as fallback
    const pollInterval = setInterval(() => refreshNotifCount(profile.role), 30000)

    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }

    // Real-time subscription
    const unsubscribe = subscribeToNotifications(profile.role, (newNotif) => {
      setNotificationCount(prev => prev + 1)
      setNotifPanelOpen(true)
      // Show a brief toast
      showNotifToast(newNotif)
    })

    return () => {
      clearInterval(pollInterval)
      unsubscribe()
    }
  }, [profile?.role, refreshNotifCount])

  function showNotifToast(notif) {
    const toast = document.createElement('div')
    const icons = { pig_added: '🐷', mating_added: '❤️', farrowing_recorded: '🐣', weaning_recorded: '🍼', feed_logged: '🌾', low_stock: '⚠️', growth_recorded: '📏', mortality_recorded: '💀', health_recorded: '💉', health_treatment: '🩺', vaccination_due: '📅', vaccination_overdue: '🚨', missed_feeding: '🍽️' }
    const icon = icons[notif.type] || '🔔'
    const titles = { pig_added: 'New Pig Added', mating_added: 'Mating Recorded', farrowing_recorded: 'Farrowing Recorded', weaning_recorded: 'Weaning Recorded', feed_logged: 'Feed Logged', low_stock: '🔴 Low Stock Alert', growth_recorded: 'Growth Recorded', mortality_recorded: 'Mortality Reported', health_recorded: 'Health Record Added', health_treatment: 'Treatment Applied', vaccination_due: 'Vaccination Due', vaccination_overdue: 'Vaccination Overdue', missed_feeding: 'Missed Feeding' }
    const title = titles[notif.type] || 'Notification'
    toast.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px;">
        <span style="font-size:22px">${icon}</span>
        <div>
          <div style="font-weight:700;font-size:14px;margin-bottom:2px">${title}</div>
          <div style="font-size:13px;color:#374151">${notif.message}</div>
        </div>
      </div>
    `
    toast.style.cssText = `
      position:fixed;bottom:24px;right:24px;z-index:9999;
      background:white;border-radius:16px;padding:16px 20px;
      box-shadow:0 8px 32px rgba(0,0,0,0.18);
      border-left:4px solid #10b981;
      max-width:340px;min-width:260px;
      animation:slideUpToast 0.35s cubic-bezier(0.16,1,0.3,1);
      font-family:inherit;
    `
    document.body.appendChild(toast)
    setTimeout(() => {
      toast.style.animation = 'fadeOutToast 0.3s ease forwards'
      setTimeout(() => toast.remove(), 300)
    }, 5000)

    // Trigger browser notification if permitted
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification(title, { body: notif.message });
    }
  }

  function loadCachedProfile() {
    try {
      const cached = localStorage.getItem(PROFILE_CACHE_KEY)
      return cached ? JSON.parse(cached) : null
    } catch (e) {
      return null
    }
  }

  function loadCachedSession() {
    try {
      const cached = localStorage.getItem(SESSION_CACHE_KEY)
      return cached ? JSON.parse(cached) : null
    } catch (e) {
      return null
    }
  }

  async function fetchProfile(userId) {
    try {
      let data = await dataAPI.profiles.getById(userId)

      // Fallback: If no profile exists (e.g. trigger failed), recover from user metadata
      if (!data) {
        const { data: { session } } = await supabase.auth.getSession();
        const metadata = session?.user?.user_metadata;
        if (metadata && (metadata.username || metadata.role)) {
          data = await dataAPI.profiles.insert({
            id: userId,
            username: metadata.username || 'User',
            role: metadata.role || 'Farm Caretaker'
          });
        }
      }

      setProfile(data)
      if (data) {
        try {
          localStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify(data))
        } catch (e) { /* ignore */ }
      }

      // Resolve the correct farm for THIS user
      let farmIds = [];
      let myFarms = [];

      if (data) {
        if (data.farm_id) {
          farmIds.push(data.farm_id);
        }
        if (data.id && !farmIds.includes(data.id)) {
          farmIds.push(data.id);
        }
      }

      const cachedFarm = localStorage.getItem('swinesync_active_farm');
      if (cachedFarm && !farmIds.includes(cachedFarm)) {
        farmIds.push(cachedFarm);
      }

      if (farmIds.length === 0) {
        farmIds.push(userId || 'default_farm');
      }

      myFarms = farmIds.map(id => ({
        id,
        name: (data && id === data.id) ? 'My Farm Workspace' : 'Farm Workspace'
      }));

      setUserFarms(myFarms);

      const correctFarm = (cachedFarm && farmIds.includes(cachedFarm)) ? cachedFarm : myFarms[0].id;
      setActiveFarm(correctFarm);
      setActiveFarmState(correctFarm);
    } catch (error) {
      console.error('Error fetching profile:', error)
      const cachedProfile = loadCachedProfile()
      if (cachedProfile) {
        setProfile(cachedProfile)
      } else {
        setProfile(null)
      }
    }
    setLoading(false)
  }

  useEffect(() => {
    if (profile?.role === 'Admin' && activeModule === 'dashboard') {
      setActiveModule('admin_overview');
    }
  }, [profile, activeModule]);

  if (loading) {
    return <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
      <i className="fas fa-spinner fa-pulse" style={{ fontSize: 40, color: '#059669' }}></i>
    </div>
  }

  if (isRecovering) {
    return <ResetPassword onResetComplete={() => setIsRecovering(false)} />
  }

  if (!session) {
    // onLogin is a no-op — onAuthStateChange already triggers setSession → fetchProfile → re-render
    return <Login onLogin={() => {}} />
  }

  const allowedModules = (() => {
    let rolesConfig = [];
    try {
      const savedRolesJSON = localStorage.getItem('swinesync_custom_roles');
      if (savedRolesJSON) rolesConfig = JSON.parse(savedRolesJSON);
    } catch (e) { }

    if (!rolesConfig || rolesConfig.length === 0) {
      rolesConfig = [
        { name: 'Admin', permissions: ['Manage Users', 'Manage All Farms', 'View Audit Logs', 'Manage System Settings'] },
        { name: 'Farm Owner', permissions: ['Manage Own Farms', 'Manage Farm Staff', 'View Financials', 'Generate Invite Codes', 'Manage Livestock', 'View Dashboard', 'Log Feed', 'Manage Pigs (Add/Edit)', 'View Health & Growth', 'Record Farrowing/Mating', 'Manage Inventory'] },
        { name: 'Owner', permissions: ['Manage Own Farms', 'Manage Farm Staff', 'View Financials', 'Generate Invite Codes', 'Manage Livestock', 'View Dashboard', 'Log Feed', 'Manage Pigs (Add/Edit)', 'View Health & Growth', 'Record Farrowing/Mating', 'Manage Inventory'] },
        { name: 'Farm Caretaker', permissions: ['View Dashboard', 'Log Feed', 'Manage Pigs (Add/Edit)', 'View Health & Growth', 'Record Farrowing/Mating', 'Manage Inventory'] }
      ];
    }

    let userRoleConfig = rolesConfig.find(r => r.name === profile?.role);
    if (!userRoleConfig && profile?.role === 'Owner') {
      userRoleConfig = rolesConfig.find(r => r.name === 'Farm Owner');
    }

    if (!userRoleConfig) return ['dashboard'];

    const perms = userRoleConfig.permissions || [];
    let modules = new Set();

    if (perms.includes('Manage Users')) modules.add('admin_users');
    if (perms.includes('Manage All Farms')) modules.add('admin_farms');
    if (perms.includes('View Audit Logs')) modules.add('admin_audit');
    if (perms.includes('Manage System Settings')) {
      modules.add('admin_overview');
      modules.add('admin_roles');
      modules.add('admin_invitations');
    }
    if (perms.includes('Manage Farm Staff')) modules.add('users');
    if (perms.includes('View Financials')) { modules.add('financial'); modules.add('reports'); }
    if (perms.includes('Generate Invite Codes')) modules.add('farm');
    if (perms.includes('Manage Livestock')) { modules.add('breeding'); modules.add('fatteners'); }
    if (perms.includes('View Dashboard')) modules.add('dashboard');
    if (perms.includes('Log Feed')) modules.add('feeding');
    if (perms.includes('Manage Pigs (Add/Edit)')) { modules.add('breeding'); modules.add('fatteners'); }
    if (perms.includes('View Health & Growth')) { modules.add('health'); modules.add('growth'); }
    if (perms.includes('Record Farrowing/Mating')) modules.add('breeding');
    if (perms.includes('Manage Inventory')) modules.add('inventory');

    // Always give admin overview if they have any admin perms
    if (perms.some(p => ['Manage Users', 'Manage All Farms', 'View Audit Logs', 'Manage System Settings'].includes(p))) {
      modules.add('admin_overview');
    }

    // Hide Farm Access and User Roles from Farm Owner / Owner sidebar
    if (profile?.role === 'Farm Owner' || profile?.role === 'Owner') {
      modules.delete('farm');
      modules.delete('users');
    }

    const desiredOrder = [
      'dashboard',        // Farm Hub
      'breeding',         // Breeding Manager
      'fatteners',        // Fatteners
      'feeding',          // Smart Feeding
      'health',           // Health Watch
      'growth',           // Growth & Mortality
      'reports',          // Analytics Pro
      'inventory',        // AI Inventory
      'financial',        // Financial Ledger
      'farm',             // Farm Access
      'users',            // User Roles
      'admin_overview',
      'admin_users',
      'admin_farms',
      'admin_roles',
      'admin_invitations',
      'admin_audit'
    ];

    return Array.from(modules).sort((a, b) => {
      let indexA = desiredOrder.indexOf(a);
      let indexB = desiredOrder.indexOf(b);
      // If not in desiredOrder, put them at the end
      if (indexA === -1) indexA = 999;
      if (indexB === -1) indexB = 999;
      return indexA - indexB;
    });
  })();

  const ActiveComponent = modules[activeModule]

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      <Sidebar
        activeModule={activeModule}
        setActiveModule={setActiveModule}
        allowedModules={allowedModules}
        profile={profile}
        notificationCount={notificationCount}
        onOpenNotifications={() => setNotifPanelOpen(true)}
        userFarms={userFarms}
        activeFarmId={activeFarmState}
        onFarmChange={(farmId) => {
          // No page reload — key prop on ActiveComponent remounts it cleanly
          setActiveFarm(farmId);
          setActiveFarmState(farmId);
        }}
      />
      <main style={{ flex: 1, overflowY: 'auto', padding: 24 }}>
        {/* ── Sync status banner ── */}
        {(() => {
          const isFarmOwner = profile?.role === 'Farm Owner' || profile?.role === 'Owner';
          return (
            <>
              {!online && !isFarmOwner && (
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  background: 'linear-gradient(90deg,#fef3c7,#fde68a)',
                  border: '1px solid #f59e0b', borderRadius: 10,
                  padding: '10px 16px', marginBottom: 16,
                  fontSize: 13, fontWeight: 600, color: '#92400e',
                  boxShadow: '0 2px 8px rgba(245,158,11,0.15)'
                }}>
                  <span style={{ fontSize: 18 }}>📶</span>
                  <span>You're offline. {pendingCount > 0 ? `${pendingCount} change${pendingCount > 1 ? 's' : ''} will sync when connection returns.` : 'Changes will sync when connection returns.'}</span>
                </div>
              )}
              {syncToast && !online && !isFarmOwner && (
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  background: 'linear-gradient(90deg,#d1fae5,#a7f3d0)',
                  border: '1px solid #10b981', borderRadius: 10,
                  padding: '10px 16px', marginBottom: 16,
                  fontSize: 13, fontWeight: 600, color: '#065f46',
                  boxShadow: '0 2px 8px rgba(16,185,129,0.15)',
                  animation: 'slideDownBanner 0.35s cubic-bezier(0.16,1,0.3,1)'
                }}>
                  <span style={{ fontSize: 18 }}>✅</span>
                  <span>{syncToast.message}</span>
                </div>
              )}
              {isFarmOwner && activeFarmState && activeFarmState !== profile?.id && (
                <div style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  background: 'linear-gradient(135deg,#0f766e,#059669)',
                  border: '1px solid #047857', borderRadius: 12,
                  padding: '12px 20px', marginBottom: 20,
                  color: 'white', boxShadow: '0 4px 12px rgba(5,150,105,0.2)'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <i className="fas fa-eye" style={{ fontSize: 20, opacity: 0.8 }}></i>
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, opacity: 0.9 }}>Viewing Mode</div>
                      <div style={{ fontSize: 15, fontWeight: 800 }}>Caretaker Dashboard</div>
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      setActiveFarm(profile.id);
                      window.location.reload();
                    }}
                    style={{
                      background: 'rgba(255,255,255,0.2)', border: 'none', borderRadius: 8,
                      color: 'white', padding: '8px 16px', fontSize: 14, fontWeight: 700,
                      cursor: 'pointer', transition: 'background 0.2s',
                      display: 'flex', alignItems: 'center', gap: 8
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.3)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,255,255,0.2)'}
                  >
                    <i className="fas fa-arrow-left"></i>
                    Back to My Farm
                  </button>
                </div>
              )}
            </>
          );
        })()}

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
          <h2 style={{ fontSize: 28, fontWeight: 800, color: '#1f2937', display: 'flex', alignItems: 'center', gap: 8 }}>
            <i className="fas fa-chart-line" style={{ color: '#10b981' }}></i>
            {activeModule.charAt(0).toUpperCase() + activeModule.slice(1)}
          </h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ background: 'white', borderRadius: 999, padding: '8px 16px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)', fontFamily: 'monospace', fontSize: 14 }}>
              {currentTime.toLocaleTimeString()}
            </div>
          </div>
        </div>
        {/* key=activeFarmState remounts the component cleanly on farm switch */}
        <ActiveComponent key={activeFarmState} onNavigateToModule={setActiveModule} profile={profile} activeModule={activeModule} />
      </main>

      {/* Notifications Panel */}
      {profile?.role && (
        <NotificationsPanel
          open={notifPanelOpen}
          onClose={() => { setNotifPanelOpen(false); refreshNotifCount(profile.role); }}
          profile={profile}
          onCountChange={(count) => setNotificationCount(count)}
        />
      )}

      <style>{`
        @keyframes slideUpToast {
          from { transform: translateY(40px); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
        @keyframes fadeOutToast {
          from { opacity: 1; transform: translateY(0); }
          to { opacity: 0; transform: translateY(20px); }
        }
      `}</style>
    </div>
  )
}

export default App