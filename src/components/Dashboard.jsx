import { useEffect, useState } from 'react';
import { dataAPI, getSingletonInventory } from '../lib/data';
import Swal from 'sweetalert2';
import { isOnline, syncAll } from '../lib/sync';
import { getActiveFarm } from '../lib/data';
import { formatDate } from '../lib/utils';
import FarmInvite from './FarmInvite';

export default function Dashboard({ onNavigateToModule, profile }) {
  const [stats, setStats] = useState({
    pigCount: 0,
    feedStock: 0,
    netProfit: 0,
    upcomingEvents: 0,
  });
  const [recentTransactions, setRecentTransactions] = useState([]);
  const [upcomingFarrowings, setUpcomingFarrowings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState(new Date());
  const [realDailyConsumption, setRealDailyConsumption] = useState(0);
  const [farmOwner, setFarmOwner] = useState(null);

  useEffect(() => {
    loadDashboardData();
    window.addEventListener('refreshAllData', loadDashboardData);
    return () => {
      window.removeEventListener('refreshAllData', loadDashboardData);
    };
  }, []);

  async function loadDashboardData() {
    setLoading(true);
    try {
      const allPigs = await dataAPI.pigs.getAll();
      // Count only active pigs for the stats card
      const activePigs = allPigs.filter(p => p.status === 'active');
      const pigCount = activePigs.length;

      let inventory = await getSingletonInventory();
      const transactions = await dataAPI.financial_transactions.getAll();
      const today = new Date().toISOString().split('T')[0];
      const allBreedings = await dataAPI.breedings.getAll();
      const upcomingBreedings = allBreedings.filter(b => b.expected_farrow >= today);
      const upcoming = upcomingBreedings.length;
      const totalExp = transactions?.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0) || 0;
      const totalRev = transactions?.filter(t => t.type === 'revenue').reduce((s, t) => s + t.amount, 0) || 0;

      setStats({
        pigCount: pigCount || 0,
        feedStock: inventory?.feed_stock_kg || 0,
        netProfit: totalRev - totalExp,
        upcomingEvents: upcoming || 0,
      });

      const recent = await dataAPI.financial_transactions.getAll({
        orderBy: { column: 'date', ascending: false },
        limit: 5
      });
      setRecentTransactions(recent || []);

      let farrowings = await dataAPI.breedings.getAll({
        filters: { expected_farrow: { gte: today } },
        orderBy: { column: 'expected_farrow', ascending: true },
        limit: 5
      });
      // For upcoming farrowings we keep all pigs (even if status is not active) but we might want to hide deceased?
      // Usually a deceased pig won't have upcoming farrowings because it's dead, so no need to filter.
      farrowings = farrowings.map(f => ({ ...f, pigs: allPigs.find(p => p.id === f.pig_id) }));
      setUpcomingFarrowings(farrowings || []);

      await loadRealConsumption();

      // Fetch Farm Owner
      const currentFarmId = getActiveFarm();
      let ownerName = null;
      if (currentFarmId) {
        const ownerProfile = await dataAPI.profiles.getById(currentFarmId);
        if (ownerProfile) {
          ownerName = ownerProfile.username || ownerProfile.email || 'Unknown Owner';
        }
      }
      setFarmOwner(ownerName);

      setLastUpdated(new Date());
    } catch (error) {
      Swal.fire('Error', 'Failed to load dashboard data', 'error');
    } finally {
      setLoading(false);
    }
  }

  async function loadRealConsumption() {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const thirtyDaysAgoStr = thirtyDaysAgo.toISOString().split('T')[0];
    const logs = await dataAPI.feeding_logs.getAll({
      filters: { time: { gte: thirtyDaysAgoStr } }
    });
    if (!logs || logs.length === 0) {
      setRealDailyConsumption(0);
      return;
    }
    const dailyMap = new Map();
    logs.forEach((log) => {
      const day = log.time.split('T')[0];
      dailyMap.set(day, (dailyMap.get(day) || 0) + log.amount_kg);
    });
    const totalConsumption = Array.from(dailyMap.values()).reduce((s, v) => s + v, 0);
    const daysWithData = dailyMap.size;
    const avgDaily = daysWithData > 0 ? totalConsumption / daysWithData : 0;
    setRealDailyConsumption(Math.round(avgDaily * 10) / 10);
  }

  const [online, setOnline] = useState(isOnline());
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  async function handleSync() {
    setSyncing(true);
    try {
      await syncAll();
      await loadDashboardData();
      Swal.fire('Synced', 'All pending data has been uploaded', 'success');
    } catch (err) {
      Swal.fire('Sync Failed', err.message, 'error');
    } finally {
      setSyncing(false);
    }
  }

  function refreshData() {
    loadDashboardData();
    Swal.fire('Refreshed', 'Dashboard data updated', 'success');
  }

  function daysUntil(dateString) {
    const diff = new Date(dateString) - new Date();
    return Math.ceil(diff / (1000 * 60 * 60 * 24));
  }

  const realDaysLeft = realDailyConsumption > 0 ? Math.floor(stats.feedStock / realDailyConsumption) : 0;
  const stockPercent = Math.min(100, Math.round((stats.feedStock / (stats.feedStock + 500)) * 100));
  const isLowFeed = stats.feedStock < 500;

  if (loading) return <div className="card" style={{ textAlign: 'center', padding: 48 }}><i className="fas fa-spinner fa-pulse fa-2x"></i><p>Loading dashboard...</p></div>;

  const currentFarmId = getActiveFarm();

  return (
    <div style={{ maxWidth: 1280, margin: '0 auto', padding: '0 16px' }}>
      {/* Header Controls */}
      <div style={{
        display: 'flex',
        flexWrap: 'wrap',
        justifyContent: 'flex-end',
        alignItems: 'center',
        gap: '12px',
        marginBottom: '16px',
      }}>
        <span style={{ fontSize: 12, color: '#6b7280' }}>Last updated: {lastUpdated.toLocaleTimeString()}</span>
        <button onClick={refreshData} style={{
          background: '#e5e7eb',
          border: 'none',
          borderRadius: 8,
          padding: '4px 12px',
          cursor: 'pointer'
        }}>
          <i className="fas fa-sync-alt"></i> Refresh
        </button>
      </div>

      {/* Stats Cards */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
        gap: '20px',
        marginBottom: '32px'
      }}>
        <div className="card">
          <i className="fas fa-piggy-bank" style={{ fontSize: 32, color: '#10b981' }}></i>
          <p style={{ fontSize: 36, fontWeight: 900, marginTop: 8 }}>{stats.pigCount}</p>
          <p style={{ color: '#6b7280' }}>Active Pigs</p>
        </div>
        <div className="card">
          <i className="fas fa-warehouse" style={{ fontSize: 32, color: '#f59e0b' }}></i>
          <p style={{ fontSize: 36, fontWeight: 900, marginTop: 8 }}>{stats.feedStock} kg</p>
          <p style={{ color: '#6b7280' }}>Feed Stock</p>
        </div>
        {(profile?.role === 'Owner' || profile?.role === 'Admin') && (
          <div className="card">
            <i className="fas fa-chart-simple" style={{ fontSize: 32, color: '#22c55e' }}></i>
            <p style={{ fontSize: 36, fontWeight: 900, marginTop: 8 }}>₱{stats.netProfit.toLocaleString()}</p>
            <p style={{ color: '#6b7280' }}>Net Profit</p>
          </div>
        )}
        <div className="card">
          <i className="fas fa-bell" style={{ fontSize: 32, color: '#a855f7' }}></i>
          <p style={{ fontSize: 24, fontWeight: 900, marginTop: 8 }}>{stats.upcomingEvents}</p>
          <p style={{ fontSize: 14, color: '#6b7280' }}>Upcoming Farrowings</p>
        </div>
      </div>

      {/* Insights Row */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
        gap: '24px',
        marginBottom: '32px'
      }}>
        {/* Smart Insights Card */}
        <div className="card" style={{ cursor: 'pointer' }} onClick={() => onNavigateToModule && onNavigateToModule('inventory')}>
          <h3 style={{ fontWeight: 'bold', fontSize: 20, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
            <i className="fas fa-calendar-alt" style={{ color: '#059669' }}></i> Smart Insights
          </h3>
          {realDailyConsumption > 0 ? (
            <>
              <p>📈 AI predicts feed depletion in <strong>{Math.max(0, realDaysLeft)} days</strong>.</p>
              <div style={{ width: '100%', background: '#e5e7eb', borderRadius: 999, height: 10, marginTop: 8 }}>
                <div style={{ width: `${stockPercent}%`, background: isLowFeed ? '#ef4444' : '#059669', height: 10, borderRadius: 999 }}></div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginTop: 4 }}>
                <span>Stock level</span><span>{stockPercent}%</span>
              </div>
              {isLowFeed && <div style={{ marginTop: 12, background: '#fee2e2', padding: 8, borderRadius: 12, color: '#b91c1c', fontSize: 14 }}>⚠️ Low feed stock! Consider reordering soon.</div>}
            </>
          ) : (
            <p>📊 No consumption data yet – start logging feedings to get predictions.</p>
          )}
          <div style={{ marginTop: 12 }}><i className="fas fa-tasks"></i> Upcoming tasks: {stats.upcomingEvents} farrowings to monitor.</div>
          <button onClick={(e) => { e.stopPropagation(); if (onNavigateToModule) onNavigateToModule('inventory'); }} style={{ marginTop: 12, background: '#10b981', color: 'white', border: 'none', borderRadius: 8, padding: '6px 12px', cursor: 'pointer' }}>
            <i className="fas fa-arrow-right"></i> Go to AI Inventory
          </button>
        </div>

        {/* Recent Transactions */}
        <div className="card">
          <h3 style={{ fontWeight: 'bold', fontSize: 20, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
            <i className="fas fa-receipt" style={{ color: '#22c55e' }}></i> Recent Transactions
          </h3>
          {recentTransactions.length === 0 ? <p>No transactions yet.</p> : (
            <ul style={{ listStyle: 'none', padding: 0 }}>
              {recentTransactions.map(tx => (
                <li key={tx.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #e5e7eb' }}>
                  <span>
                    {tx.description || (tx.type === 'expense' ? 'Expense' : 'Revenue')}
                    {tx.category && <small style={{ display: 'block', fontSize: 11, color: '#6b7280' }}>{tx.category}</small>}
                    <br /><small style={{ fontSize: 11, color: '#6b7280' }}>{formatDate(tx.date)}</small>
                  </span>
                  <span style={{ fontWeight: 'bold', color: tx.type === 'expense' ? '#ef4444' : '#10b981' }}>
                    {tx.type === 'expense' ? '-' : '+'}₱{tx.amount}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Upcoming Farrowings */}
        <div className="card">
          <h3 style={{ fontWeight: 'bold', fontSize: 20, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
            <i className="fas fa-calendar-week" style={{ color: '#a855f7' }}></i> Upcoming Farrowings
          </h3>
          {upcomingFarrowings.length === 0 ? <p>No upcoming farrowings scheduled.</p> : (
            <ul style={{ listStyle: 'none', padding: 0 }}>
              {upcomingFarrowings.map(f => {
                const pig = f.pigs;
                const days = daysUntil(f.expected_farrow);
                return (
                  <li key={f.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid #e5e7eb' }}>
                    <div><strong>{pig?.tag || '?'} - {pig?.name || 'Unknown'}</strong><div style={{ fontSize: 12, color: '#4b5563' }}>{formatDate(f.expected_farrow)} ({days > 0 ? `${days} days left` : 'overdue'})</div></div>
                    <span style={{ background: days <= 7 ? '#fef3c7' : '#e0e7ff', padding: '2px 8px', borderRadius: 999, fontSize: 12 }}>{f.status}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>


      </div>

      <div style={{ marginTop: '32px' }}>
        <FarmInvite profile={profile} />
      </div>




      <style>{`
        .card {
          background: white;
          border-radius: 16px;
          padding: 20px;
          box-shadow: 0 1px 3px rgba(0,0,0,0.1);
          transition: transform 0.2s, box-shadow 0.2s;
        }
        .card:hover {
          transform: translateY(-2px);
          box-shadow: 0 4px 12px rgba(0,0,0,0.08);
        }
        @media (max-width: 768px) {
          .card {
            padding: 16px;
          }
          .card p:first-of-type {
            font-size: 28px !important;
          }
          .card i {
            font-size: 24px !important;
          }
        }
        @media (max-width: 480px) {
          .card p:first-of-type {
            font-size: 24px !important;
          }
        }
      `}</style>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CaretakerDashboardModal — read-only view of a caretaker's isolated data
// ─────────────────────────────────────────────────────────────────────────────
function CaretakerDashboardModal({ caretakerId, caretakerName, onClose }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, [caretakerId]);

  async function loadData() {
    setLoading(true);
    try {
      const today = new Date().toISOString().split('T')[0];

      const [pigs, breedings, feedLogs, inventory] = await Promise.all([
        getWithFarmId(caretakerId, 'pigs'),
        getWithFarmId(caretakerId, 'breedings'),
        getWithFarmId(caretakerId, 'feeding_logs', {
          filters: { time: { gte: new Date(Date.now() - 30 * 864e5).toISOString().split('T')[0] } }
        }),
        getWithFarmId(caretakerId, 'inventory', { limit: 1 }),
      ]);

      const activePigs = pigs.filter(p => p.status === 'active').length;
      const upcomingFarrowings = breedings.filter(b => b.expected_farrow >= today);

      let avgDaily = 0;
      if (feedLogs.length > 0) {
        const map = new Map();
        feedLogs.forEach(l => {
          const day = (l.time || '').split('T')[0];
          if (day) map.set(day, (map.get(day) || 0) + (l.amount_kg || 0));
        });
        const total = Array.from(map.values()).reduce((s, v) => s + v, 0);
        avgDaily = map.size > 0 ? Math.round((total / map.size) * 10) / 10 : 0;
      }

      const feedStock = inventory[0]?.feed_stock_kg || 0;

      setData({
        activePigs,
        feedStock,
        avgDaily,
        upcomingFarrowings: upcomingFarrowings.slice(0, 5),
        allPigs: pigs,
      });
    } catch (err) {
      console.error('CaretakerDashboardModal error:', err);
    }
    setLoading(false);
  }

  function daysUntil(dateStr) {
    return Math.ceil((new Date(dateStr) - new Date()) / (1000 * 60 * 60 * 24));
  }

  const statCard = {
    background: '#f9fafb', borderRadius: 16,
    padding: '20px 16px', textAlign: 'center',
    border: '1px solid #e5e7eb',
  };

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 16,
      }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        background: 'white', borderRadius: 24,
        width: '100%', maxWidth: 640,
        maxHeight: '90vh', overflowY: 'auto',
        boxShadow: '0 24px 64px rgba(0,0,0,0.25)',
        animation: 'cdmFadeIn 0.25s cubic-bezier(0.16,1,0.3,1)',
      }}>
        {/* Header */}
        <div style={{
          background: 'linear-gradient(135deg,#0f766e,#059669)',
          borderRadius: '24px 24px 0 0',
          padding: '24px 28px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <button
              onClick={onClose}
              style={{
                background: 'rgba(255,255,255,0.15)', border: 'none', borderRadius: 10,
                color: 'white', cursor: 'pointer', padding: '8px 16px',
                display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 600,
                transition: 'background 0.2s', marginRight: 4, gap: 8
              }}
              onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.25)'}
              onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,255,255,0.15)'}
            >
              <i className="fas fa-arrow-left"></i> Back
            </button>
            <div style={{
              width: 48, height: 48, borderRadius: '50%',
              background: 'rgba(255,255,255,0.2)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <i className="fas fa-user-cog" style={{ color: 'white', fontSize: 20 }}></i>
            </div>
            <div>
              <div style={{ color: 'rgba(255,255,255,0.75)', fontSize: 12, fontWeight: 600, letterSpacing: 1, textTransform: 'uppercase' }}>Caretaker Dashboard</div>
              <div style={{ color: 'white', fontSize: 20, fontWeight: 800 }}>{caretakerName}</div>
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'rgba(255,255,255,0.15)', border: 'none', borderRadius: 10,
              color: 'white', width: 36, height: 36, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16,
              transition: 'background 0.2s',
            }}
            onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.25)'}
            onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,255,255,0.15)'}
          >
            <i className="fas fa-times"></i>
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: 28 }}>
          {loading ? (
            <div style={{ textAlign: 'center', padding: 48 }}>
              <i className="fas fa-spinner fa-pulse" style={{ fontSize: 32, color: '#059669' }}></i>
              <p style={{ marginTop: 12, color: '#6b7280' }}>Loading caretaker data…</p>
            </div>
          ) : !data ? (
            <div style={{ textAlign: 'center', padding: 48, color: '#6b7280' }}>
              <i className="fas fa-exclamation-circle" style={{ fontSize: 32, marginBottom: 12, color: '#f59e0b' }}></i>
              <p>Could not load data for this caretaker.</p>
            </div>
          ) : (
            <>
              {/* Stats Grid */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))', gap: 16, marginBottom: 28 }}>
                <div style={statCard}>
                  <i className="fas fa-piggy-bank" style={{ fontSize: 28, color: '#10b981', marginBottom: 8 }}></i>
                  <div style={{ fontSize: 32, fontWeight: 900, color: '#1f2937' }}>{data.activePigs}</div>
                  <div style={{ fontSize: 13, color: '#6b7280', marginTop: 2 }}>Active Pigs</div>
                </div>
                <div style={statCard}>
                  <i className="fas fa-warehouse" style={{ fontSize: 28, color: '#f59e0b', marginBottom: 8 }}></i>
                  <div style={{ fontSize: 32, fontWeight: 900, color: '#1f2937' }}>
                    {data.feedStock} <span style={{ fontSize: 14, fontWeight: 600 }}>kg</span>
                  </div>
                  <div style={{ fontSize: 13, color: '#6b7280', marginTop: 2 }}>Feed Stock</div>
                </div>
                <div style={statCard}>
                  <i className="fas fa-seedling" style={{ fontSize: 28, color: '#3b82f6', marginBottom: 8 }}></i>
                  <div style={{ fontSize: 32, fontWeight: 900, color: '#1f2937' }}>
                    {data.avgDaily} <span style={{ fontSize: 14, fontWeight: 600 }}>kg</span>
                  </div>
                  <div style={{ fontSize: 13, color: '#6b7280', marginTop: 2 }}>Avg Daily Feed</div>
                </div>
                <div style={statCard}>
                  <i className="fas fa-calendar-week" style={{ fontSize: 28, color: '#a855f7', marginBottom: 8 }}></i>
                  <div style={{ fontSize: 32, fontWeight: 900, color: '#1f2937' }}>{data.upcomingFarrowings.length}</div>
                  <div style={{ fontSize: 13, color: '#6b7280', marginTop: 2 }}>Upcoming Farrowings</div>
                </div>
              </div>

              {/* Upcoming Farrowings */}
              {data.upcomingFarrowings.length > 0 && (
                <div style={{ background: '#f9fafb', borderRadius: 16, padding: 20, marginBottom: 20 }}>
                  <h4 style={{ margin: '0 0 14px', fontWeight: 800, color: '#1f2937', display: 'flex', alignItems: 'center', gap: 8 }}>
                    <i className="fas fa-calendar-check" style={{ color: '#a855f7' }}></i> Upcoming Farrowings
                  </h4>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {data.upcomingFarrowings.map(f => {
                      const pig = data.allPigs.find(p => p.id === f.pig_id);
                      const days = daysUntil(f.expected_farrow);
                      return (
                        <div key={f.id} style={{
                          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                          padding: '10px 14px', background: 'white', borderRadius: 10,
                          border: '1px solid #e5e7eb',
                        }}>
                          <div>
                            <div style={{ fontWeight: 700, fontSize: 14, color: '#1f2937' }}>
                              {pig?.tag || '?'} — {pig?.name || 'Unknown'}
                            </div>
                            <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>
                              {f.expected_farrow} · {days > 0 ? `${days} days left` : 'overdue'}
                            </div>
                          </div>
                          <span style={{
                            padding: '3px 12px', borderRadius: 999, fontSize: 12, fontWeight: 700,
                            background: days <= 7 ? '#fef3c7' : '#e0e7ff',
                            color: days <= 7 ? '#92400e' : '#3730a3',
                          }}>{f.status}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              <div style={{ background: '#ecfdf5', borderRadius: 12, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10 }}>
                <i className="fas fa-info-circle" style={{ color: '#059669' }}></i>
                <span style={{ fontSize: 13, color: '#065f46' }}>
                  This is a read-only view of {caretakerName}'s isolated data.
                </span>
              </div>
            </>
          )}
        </div>
      </div>

      <style>{`
        @keyframes cdmFadeIn {
          from { opacity: 0; transform: scale(0.93); }
          to   { opacity: 1; transform: scale(1); }
        }
      `}</style>
    </div>
  );
}