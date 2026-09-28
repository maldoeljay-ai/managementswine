import { useEffect, useState, useRef } from 'react';
import { dataAPI, getSingletonInventory } from '../lib/data';
import { syncAll, isOnline, getPendingCount } from '../lib/sync';
import { supabase } from '../lib/supabase';
import { addNotification as pushOwnerNotification, checkAndNotifyMissedFeedings } from '../lib/notifications';
import Swal from 'sweetalert2';

function generateId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

// ─── Helper: convert 24h (HH:MM) to 12h with AM/PM ───
function formatTimeDisplay(timeStr) {
  if (!timeStr) return '';
  const [hours, minutes] = timeStr.split(':').map(Number);
  const ampm = hours >= 12 ? 'PM' : 'AM';
  const hour12 = hours % 12 || 12;
  return `${hour12}:${minutes.toString().padStart(2, '0')} ${ampm}`;
}

export default function Feeding({ profile }) {
  const [schedules, setSchedules] = useState([]);
  const [logs, setLogs] = useState([]);
  const [feedStock, setFeedStock] = useState(0);
  const [inventoryId, setInventoryId] = useState(null);
  const [pigs, setPigs] = useState([]);
  const [feedInventory, setFeedInventory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showScheduleForm, setShowScheduleForm] = useState(false);
  const [editingSchedule, setEditingSchedule] = useState(null);
  const [scheduleForm, setScheduleForm] = useState({
    time: '',
    feed_type: '',
    pig_id: '',
    amount_kg: '',
  });
  const [activeTab, setActiveTab] = useState('schedules');
  const [scheduleFilter, setScheduleFilter] = useState('All');
  const [stats, setStats] = useState({ todayTotal: 0, weekTotal: 0, missedFeedings: 0 });
  const [loggingId, setLoggingId] = useState(null);
  const [fulfilledScheduleIds, setFulfilledScheduleIds] = useState(new Set());
  const [syncing, setSyncing] = useState(false);
  const [online, setOnline] = useState(isOnline());
  const [notifications, setNotifications] = useState([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [hasNotifiedMissed, setHasNotifiedMissed] = useState(false);
  const notificationTimeout = useRef(null);

  const addNotification = (message, type = 'info') => {
    const id = Date.now();
    setNotifications(prev => [...prev, { id, message, type }]);
    clearTimeout(notificationTimeout.current);
    notificationTimeout.current = setTimeout(() => {
      setNotifications(prev => prev.filter(n => n.id !== id));
    }, 5000);
  };

  // Track online/offline state and pending queue count
  useEffect(() => {
    const handleOnline = () => { setOnline(true); refreshPendingCount(); };
    const handleOffline = () => { setOnline(false); refreshPendingCount(); };
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    refreshPendingCount();
    const pollPending = setInterval(refreshPendingCount, 5000);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      clearInterval(pollPending);
    };
  }, []);

  async function refreshPendingCount() {
    try {
      const count = await getPendingCount();
      setPendingCount(count);
    } catch (e) { /* ignore */ }
  }

  const handleSync = async () => {
    setSyncing(true);
    try {
      await syncAll();
      addNotification('✅ Sync completed successfully', 'info');
      await loadAllData();
    } catch (error) {
      addNotification('❌ Sync failed: ' + error.message, 'error');
    } finally {
      setSyncing(false);
    }
  };

  useEffect(() => {
    loadAllData();
    window.addEventListener('refreshAllData', loadAllData);
    
    // Realtime subscription for feeding changes
    const feedingSub = supabase.channel('feeding_changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'feeding_logs' }, () => {
        loadLogs();
        loadStats();
        loadInventory();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'feeding_schedules' }, () => {
        loadSchedules();
      })
      .subscribe();

    // Check for missed feedings automatically every minute
    const statsInterval = setInterval(() => {
      loadStats();
    }, 60000);

    return () => {
      window.removeEventListener('refreshAllData', loadAllData);
      clearInterval(statsInterval);
      supabase.removeChannel(feedingSub);
    };
  }, []);

  useEffect(() => {
    if (stats.missedFeedings > 0 && !hasNotifiedMissed) {
      addNotification(`Reminder: You need to feed the pigs! (${stats.missedFeedings} missed)`, 'error');
      setHasNotifiedMissed(true);
    } else if (stats.missedFeedings === 0) {
      setHasNotifiedMissed(false);
    }
  }, [stats.missedFeedings, hasNotifiedMissed]);

  const [tick, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick(t => t + 1), 30000);
    return () => clearInterval(timer);
  }, []);

  async function loadAllData() {
    setLoading(true);
    try {
      // Use allSettled so a single failure doesn't block all data from loading (critical for offline)
      const results = await Promise.allSettled([
        loadSchedules(),
        loadLogs(),
        loadInventory(),
        loadFeedInventory(),
        loadPigs(),
        loadStats(),
      ]);
      results.forEach((r, i) => {
        if (r.status === 'rejected') {
          console.warn(`Feeding loadAllData[${i}] failed:`, r.reason);
        }
      });
    } catch (error) {
      console.error('Error loading data:', error);
    } finally {
      setLoading(false);
    }
  }

  async function loadSchedules() {
    const data = await dataAPI.feeding_schedules.getAll({ orderBy: { column: 'time', ascending: true } });
    setSchedules(data || []);
  }

  async function loadLogs() {
    const data = await dataAPI.feeding_logs.getAll({ orderBy: { column: 'time', ascending: false }, limit: 20 });
    setLogs(data || []);
  }

  async function loadInventory() {
    try {
      let data = await getSingletonInventory();

      if (data && data.id) {
        setFeedStock(data.feed_stock_kg || 0);
        setInventoryId(data.id);
      } else {
        // Still no id — use a placeholder so feeding logs can still be recorded offline
        console.warn('Inventory has no id, using local placeholder for offline mode.');
        const localId = generateId();
        setFeedStock(0);
        setInventoryId(localId);
      }
    } catch (error) {
      // Never block the UI — log and use a placeholder
      console.warn('loadInventory failed, using offline placeholder:', error);
      const localId = generateId();
      setFeedStock(0);
      setInventoryId(localId);
    }
  }

  async function loadPigs() {
    const data = await dataAPI.pigs.getAll();
    setPigs((data || []).filter(p => p.status === 'active'));
  }

  async function loadFeedInventory() {
    try {
      const data = await dataAPI.feed_inventory.getAll();
      setFeedInventory(data || []);
    } catch (err) {
      console.warn('Failed to load feed inventory', err);
      setFeedInventory([]);
    }
  }

  async function loadStats() {
    const localStartOfDay = new Date();
    localStartOfDay.setHours(0, 0, 0, 0);
    const today = localStartOfDay.toISOString();
    
    const weekAgo = new Date();
    weekAgo.setHours(0, 0, 0, 0);
    weekAgo.setDate(weekAgo.getDate() - 7);
    const weekAgoStr = weekAgo.toISOString();
    
    const todayLogs = await dataAPI.feeding_logs.getAll({ filters: { time: { gte: today } } });
    const todayTotal = todayLogs?.reduce((sum, l) => sum + l.amount_kg, 0) || 0;
    
    const weekLogs = await dataAPI.feeding_logs.getAll({ filters: { time: { gte: weekAgoStr } } });
    const weekTotal = weekLogs?.reduce((sum, l) => sum + l.amount_kg, 0) || 0;
    
    const now = new Date();
    const todaySchedules = await dataAPI.feeding_schedules.getAll();
    const todayLogsForCheck = todayLogs; // Reuse the already fetched todayLogs
    const fulfilled = new Set();
    const missed = (todaySchedules || []).filter(schedule => {
      const [hours, minutes] = schedule.time.split(':');
      const scheduleTime = new Date();
      scheduleTime.setHours(parseInt(hours), parseInt(minutes), 0);
      
      const isFulfilled = (todayLogsForCheck || []).some(log => {
        // We match by schedule_id if available, or just time proximity
        if (log.schedule_id === schedule.id) return true;
        const logTime = new Date(log.time);
        const diffMinutes = Math.abs(logTime - scheduleTime) / (1000 * 60);
        return diffMinutes < 60;
      });

      if (isFulfilled) fulfilled.add(schedule.id);

      if (scheduleTime > now) return false;
      return !isFulfilled;
    }).length;
    
    setFulfilledScheduleIds(fulfilled);
    setStats({ todayTotal, weekTotal, missedFeedings: missed });

    // ── Auto-notify owner about missed feedings ──────────────
    try {
      await checkAndNotifyMissedFeedings(missed);
    } catch (e) {
      console.warn('Failed to send missed feeding notification:', e);
    }
  }

  async function saveSchedule(e) {
    e.preventDefault();
    if (!scheduleForm.time || !scheduleForm.amount_kg || !scheduleForm.feed_type) {
      Swal.fire('Error', 'Please fill all required fields (time, amount, feed type)', 'error');
      return;
    }

    const [hours] = scheduleForm.time.split(':');
    const h = parseInt(hours, 10);
    let derivedType = 'Morning';
    if (h >= 12 && h < 17) derivedType = 'Afternoon';
    else if (h >= 17) derivedType = 'Evening';

    const payload = {
      id: editingSchedule ? editingSchedule.id : generateId(),
      time: scheduleForm.time,
      type: derivedType,
      feed_type: scheduleForm.feed_type,
      pig_id: scheduleForm.pig_id || null,
      amount_kg: parseFloat(scheduleForm.amount_kg),
    };
    try {
      if (editingSchedule) {
        await dataAPI.feeding_schedules.update(editingSchedule.id, payload);
      } else {
        await dataAPI.feeding_schedules.insert(payload);
      }
      Swal.fire('Success', 'Schedule saved', 'success');
      setShowScheduleForm(false);
      setEditingSchedule(null);
      setScheduleForm({ time: '', feed_type: '', pig_id: '', amount_kg: '' });
      loadSchedules();
      loadStats();
    } catch (error) {
      Swal.fire('Error', 'Error saving schedule: ' + error.message, 'error');
    }
  }

  async function deleteSchedule(id) {
    const result = await Swal.fire({
      title: 'Delete schedule?',
      text: 'This cannot be undone.',
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#d33',
      confirmButtonText: 'Delete',
    });
    if (result.isConfirmed) {
      try {
        await dataAPI.feeding_schedules.delete(id);
        Swal.fire('Deleted', 'Schedule removed', 'success');
        loadSchedules();
        loadStats();
      } catch (error) {
        Swal.fire('Error', 'Error deleting schedule: ' + error.message, 'error');
      }
    }
  }

  async function logFeed(schedule, isAuto = false) {
    if (!inventoryId) {
      try {
        await loadInventory();
      } catch (error) {
        if (!isAuto) Swal.fire('Error', 'Inventory not loaded. Please refresh.', 'error');
        return;
      }
      if (!inventoryId) {
        if (!isAuto) Swal.fire('Error', 'Inventory not loaded. Please refresh.', 'error');
        return;
      }
    }
    if (feedStock < schedule.amount_kg) {
      if (!isAuto) Swal.fire('Not enough feed', `Only ${feedStock} kg left.`, 'error');
      // If it's auto and fails, maybe we can notify owner about missed auto feed due to low stock?
      if (isAuto) {
         const actorName = 'SmartFeeder';
         await pushOwnerNotification(
           'missed_feeding',
           `⚠️ Auto-feed failed: Not enough feed stock to dispense ${schedule.amount_kg} kg for schedule at ${schedule.time}. Only ${feedStock} kg left.`,
           'Owner',
           actorName
         );
      }
      return;
    }
    setLoggingId(schedule.id);
    try {
      const newStock = feedStock - schedule.amount_kg;
      await dataAPI.inventory.update(inventoryId, { feed_stock_kg: newStock });
      await dataAPI.feeding_logs.insert({
        amount_kg: schedule.amount_kg,
        time: new Date().toISOString(),
        schedule_id: schedule.id,
        type: schedule.feed_type || schedule.type,
      });
      await loadAllData();

      // Notify the farm owner
      const actorName = isAuto ? 'SmartFeeder' : (profile?.username || 'Caretaker');
      const actionText = isAuto ? 'automatically dispensed' : 'logged';
      await pushOwnerNotification(
        'feed_logged',
        `${actorName} ${actionText} ${schedule.amount_kg} kg of ${schedule.feed_type || schedule.type || 'feed'}. New stock: ${newStock} kg.`,
        'Owner',
        actorName
      );
      // Low stock warning notification
      let currentInv = await getSingletonInventory();
      if (!currentInv) {
        const inv = await dataAPI.inventory.getAll();
        currentInv = inv && inv[0];
      }
      if (currentInv && newStock < currentInv.min_threshold) {
        await pushOwnerNotification(
          'low_stock',
          `⚠️ Feed stock is critically low! Only ${newStock} kg remaining (threshold: ${currentInv.min_threshold} kg). Please restock immediately.`,
          'Owner',
          actorName
        );
      }

      const offlineNote = !isOnline() ? ' (saved offline – will sync when connected)' : '';
      refreshPendingCount();
      if (!isAuto) {
        Swal.fire('Success', `Logged ${schedule.amount_kg} kg of ${schedule.feed_type || schedule.type} feed${offlineNote}`, 'success');
      } else {
        addNotification(`🤖 SmartFeeder auto-dispensed ${schedule.amount_kg} kg of ${schedule.feed_type || schedule.type}`, 'info');
      }
    } catch (error) {
      if (!isAuto) Swal.fire('Error', error.message, 'error');
      console.error('Auto-feed error:', error);
    } finally {
      setLoggingId(null);
    }
  }



  function editSchedule(schedule) {
    setEditingSchedule(schedule);
    setScheduleForm({
      time: schedule.time,
      feed_type: schedule.feed_type || '',
      pig_id: schedule.pig_id || '',
      amount_kg: schedule.amount_kg,
    });
    setShowScheduleForm(true);
  }

  function getPigInfo(pigId) {
    if (!pigId) return 'All pigs';
    const pig = pigs.find(p => p.id === pigId);
    return pig ? `${pig.tag} - ${pig.name}` : 'Unknown';
  }

  // ---- Real-time subscriptions ----
  useEffect(() => {
    let channel = null;
    if (online) {
      channel = supabase
        .channel('feeding-realtime')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'feeding_schedules' }, () => {
          addNotification('📋 Feeding schedule changed', 'info');
          loadAllData();
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'feeding_logs' }, () => {
          addNotification('📝 Feeding log changed', 'info');
          loadAllData();
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'inventory' }, () => {
          addNotification('📦 Inventory changed', 'info');
          loadAllData();
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'pigs' }, () => {
          addNotification('🐷 Pig changed', 'info');
          loadPigs();
        })
        .subscribe();
    } else if (channel) {
      supabase.removeChannel(channel);
      channel = null;
    }
    return () => { if (channel) supabase.removeChannel(channel); };
  }, [online]);

  if (loading) return (
    <div className="loading-container">
      <i className="fas fa-spinner fa-pulse fa-2x"></i>
      <p>Loading feeding data...</p>
    </div>
  );

  return (
    <div className="feeding-container">
      {/* In-app notifications */}
      {notifications.length > 0 && (
        <div className="notification-container">
          {notifications.map((n) => (
            <div key={n.id} className={`notification ${n.type}`}>
              <i className={`fas ${n.type === 'error' ? 'fa-exclamation-circle' : 'fa-info-circle'}`}></i>
              {n.message}
            </div>
          ))}
        </div>
      )}

      {/* Offline / queue banner */}
      {!online && (
        <div style={{
          background: 'linear-gradient(135deg, #fef3c7, #fde68a)',
          border: '1px solid #f59e0b',
          borderRadius: 14,
          padding: '12px 16px',
          marginBottom: 16,
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          flexWrap: 'wrap',
        }}>
          <i className="fas fa-wifi-slash" style={{ color: '#b45309', fontSize: 20 }}></i>
          <div style={{ flex: 1 }}>
            <strong style={{ color: '#78350f' }}>You're offline</strong>
            <p style={{ margin: '2px 0 0', fontSize: 13, color: '#92400e' }}>
              Data you enter will be saved locally and automatically synced when your connection is restored.
            </p>
          </div>
          {pendingCount > 0 && (
            <span style={{
              background: '#b45309',
              color: 'white',
              borderRadius: 999,
              padding: '4px 12px',
              fontSize: 13,
              fontWeight: 700,
              whiteSpace: 'nowrap',
            }}>
              <i className="fas fa-clock" style={{ marginRight: 6 }}></i>
              {pendingCount} action{pendingCount !== 1 ? 's' : ''} queued
            </span>
          )}
        </div>
      )}

      {stats.missedFeedings > 0 && (
        <div style={{
          background: 'linear-gradient(135deg, #fee2e2, #fecaca)',
          border: '1px solid #ef4444',
          borderRadius: 14,
          padding: '12px 16px',
          marginBottom: 16,
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          boxShadow: '0 4px 6px rgba(239, 68, 68, 0.1)',
        }}>
          <i className="fas fa-exclamation-triangle" style={{ color: '#b91c1c', fontSize: 24 }}></i>
          <div style={{ flex: 1 }}>
            <strong style={{ color: '#7f1d1d', fontSize: 16 }}>Action Required: Missed Feedings</strong>
            <p style={{ margin: '4px 0 0', fontSize: 14, color: '#991b1b' }}>
              You have {stats.missedFeedings} missed feeding{stats.missedFeedings !== 1 ? 's' : ''} for today. Please review the schedules below and ensure the pigs are fed.
            </p>
          </div>
        </div>
      )}

      {/* Inventory Summary */}
      <div className="inventory-summary" style={{ borderLeftColor: feedStock < 200 ? '#ef4444' : '#f59e0b' }}>
        <div className="inventory-content">
          <div className="inventory-left">
            <div>
              <h3><i className="fas fa-warehouse"></i> Feed Inventory</h3>
              <p className="stock-value">{feedStock} kg</p>
            </div>
          </div>
          <div className="inventory-right">
            <p>📊 Today: {stats.todayTotal} kg | This week: {stats.weekTotal} kg</p>
            {feedStock < 200 && <span className="low-stock-badge">⚠️ Low stock</span>}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="tabs">
        <button
          className={`tab ${activeTab === 'schedules' ? 'active' : ''}`}
          onClick={() => setActiveTab('schedules')}
        >
          <i className="fas fa-clock"></i> Feeding Schedules
        </button>
        <button
          className={`tab ${activeTab === 'logs' ? 'active' : ''}`}
          onClick={() => setActiveTab('logs')}
        >
          <i className="fas fa-history"></i> Feeding Logs
        </button>
      </div>

      {activeTab === 'schedules' && (
        <div className="schedules-section">
          <div className="section-header">
            <h3><i className="fas fa-list"></i> Automated Schedules</h3>
            <button className="btn-add" onClick={() => {
              setEditingSchedule(null);
              setScheduleForm({ time: '', feed_type: '', pig_id: '', amount_kg: '' });
              setShowScheduleForm(true);
            }}>
              <i className="fas fa-plus"></i> Add Schedule
            </button>
          </div>

          <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', overflowX: 'auto', paddingBottom: '4px' }}>
            {['All', 'Morning', 'Afternoon', 'Evening'].map(filter => (
              <button
                key={filter}
                onClick={() => setScheduleFilter(filter)}
                style={{
                  padding: '6px 14px',
                  borderRadius: '20px',
                  border: 'none',
                  fontSize: '13px',
                  fontWeight: '600',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                  background: scheduleFilter === filter ? '#10b981' : '#f3f4f6',
                  color: scheduleFilter === filter ? 'white' : '#4b5563',
                  transition: 'all 0.2s'
                }}
              >
                {filter}
              </button>
            ))}
          </div>

          {showScheduleForm && (
            <div className="schedule-form">
              <form onSubmit={saveSchedule}>
                <div className="form-grid">
                  <div className="form-field">
                    <label>Time (24h)</label>
                    <input type="time" value={scheduleForm.time} onChange={(e) => setScheduleForm({ ...scheduleForm, time: e.target.value })} required />
                  </div>
                  <div className="form-field">
                    <label>Feed Type *</label>
                    <select value={scheduleForm.feed_type} onChange={(e) => setScheduleForm({ ...scheduleForm, feed_type: e.target.value })} required>
                      <option value="" disabled>Select Feed Type</option>
                      {feedInventory.length > 0 ? (
                        feedInventory.map(f => (
                          <option key={f.id} value={f.name || f.type}>{f.name || f.type}</option>
                        ))
                      ) : (
                        <>
                          <option value="Starter">Starter</option>
                          <option value="Grower">Grower</option>
                          <option value="Finisher">Finisher</option>
                          <option value="Gestation">Gestation (Sow)</option>
                          <option value="Lactation">Lactation (Sow)</option>
                          <option value="Breeder">Breeder</option>
                        </>
                      )}
                    </select>
                  </div>
                  <div className="form-field">
                    <label>Pig (optional)</label>
                    <select value={scheduleForm.pig_id} onChange={(e) => setScheduleForm({ ...scheduleForm, pig_id: e.target.value })}>
                      <option value="">All pigs</option>
                      {pigs.map(p => <option key={p.id} value={p.id}>{p.tag} - {p.name}</option>)}
                    </select>
                  </div>
                  <div className="form-field">
                    <label>Amount (kg)</label>
                    <input type="number" step="0.1" value={scheduleForm.amount_kg} onChange={(e) => setScheduleForm({ ...scheduleForm, amount_kg: e.target.value })} required />
                  </div>
                </div>
                <div className="form-actions">
                  <button type="button" onClick={() => setShowScheduleForm(false)} className="btn-cancel">Cancel</button>
                  <button type="submit" className="btn-save">{editingSchedule ? 'Update' : 'Save'} Schedule</button>
                </div>
              </form>
            </div>
          )}

          <div className="schedules-grid">
            {schedules.filter(s => {
              if (scheduleFilter === 'All') return true;
              return s.type === scheduleFilter;
            }).map((s) => {
              const [hours, minutes] = s.time.split(':');
              const scheduleTime = new Date();
              scheduleTime.setHours(parseInt(hours, 10), parseInt(minutes, 10), 0);
              const isFuture = scheduleTime > new Date();
              const isFulfilled = fulfilledScheduleIds.has(s.id);
              const isDisabled = loggingId === s.id || isFulfilled || isFuture;

              return (
                <div key={s.id} className="schedule-card">
                  <div className="schedule-header">
                    <div>
                      <i className="fas fa-bell"></i>
                      <strong>{formatTimeDisplay(s.time)}</strong>
                      <span className="feed-type">{s.feed_type || 'Standard'}</span>
                      <span className="pig-assignment">{getPigInfo(s.pig_id)}</span>
                    </div>
                    <div className="schedule-actions">
                      <button onClick={() => editSchedule(s)} className="btn-edit" title="Edit"><i className="fas fa-edit"></i></button>
                      <button onClick={() => deleteSchedule(s.id)} className="btn-delete" title="Delete"><i className="fas fa-trash-alt"></i></button>
                    </div>
                  </div>
                  <div className="schedule-footer">
                    <span className="amount">{s.amount_kg} kg</span>
                    <button 
                      onClick={() => logFeed(s)} 
                      disabled={isDisabled} 
                      className={`btn-log ${!online ? 'btn-log-offline' : ''} ${isFulfilled ? 'btn-log-success' : ''}`}
                      title={isFuture ? 'Cannot log before scheduled time' : ''}
                    >
                      {loggingId === s.id
                        ? <i className="fas fa-spinner fa-spin"></i>
                        : isFulfilled
                          ? <><i className="fas fa-check-circle"></i> Logged</>
                          : isFuture
                            ? <><i className="fas fa-clock"></i> Waiting</>
                            : !online
                              ? <><i className="fas fa-cloud-upload-alt"></i> Log (Offline)</>
                              : <><i className="fas fa-check"></i> Log Feed</>}
                    </button>
                  </div>
                </div>
              );
            })}
            {schedules.length === 0 && <div className="empty-state">No schedules yet.</div>}
          </div>

          <div className={`ai-alert ${stats.missedFeedings > 0 ? 'warning' : 'success'}`}>
            <i className={`fas ${stats.missedFeedings > 0 ? 'fa-exclamation-triangle' : 'fa-robot'}`}></i>
            <strong>AI Alert:</strong> {stats.missedFeedings > 0 ? `Missed ${stats.missedFeedings} feeding(s) today.` : 'All feedings on track.'}
          </div>
        </div>
      )}

      {activeTab === 'logs' && (
        <div className="logs-section">
          <h3><i className="fas fa-history"></i> Recent Feeding Logs (last 20)</h3>
          <div className="table-wrapper">
            <table className="logs-table">
              <thead>
                <tr><th>Time</th><th>Type</th><th>Amount (kg)</th></tr>
              </thead>
              <tbody>
                {logs.map((log) => (
                  <tr key={log.id}>
                    <td>{new Date(log.time).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })}</td>
                    <td>{log.type || 'Feeding'}</td>
                    <td>{log.amount_kg} kg</td>
                  </tr>
                ))}
                {logs.length === 0 && (
                  <tr><td colSpan="3" className="empty-cell">No feeding logs yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Responsive Styles */}
      <style>{`
        /* ---- Container & base ---- */
        .feeding-container {
          width: 100%;
          margin: 0 auto;
          padding: 16px;
          position: relative;
        }

        /* ---- Notifications ---- */
        .notification-container {
          position: fixed;
          top: 20px;
          right: 20px;
          z-index: 9999;
          display: flex;
          flex-direction: column;
          gap: 8px;
          max-width: 400px;
          width: calc(100% - 40px);
        }
        .notification {
          padding: 12px 16px;
          border-radius: 12px;
          box-shadow: 0 4px 12px rgba(0,0,0,0.15);
          font-size: 14px;
          font-weight: 500;
          animation: slideIn 0.3s ease-out;
        }
        .notification.info {
          background: #d1fae5;
          color: #065f46;
          border-left: 4px solid #10b981;
        }
        .notification.error {
          background: #fee2e2;
          color: #b91c1c;
          border-left: 4px solid #ef4444;
        }

        /* ---- Inventory Summary ---- */
        .inventory-summary {
          background: linear-gradient(135deg, #fef3c7 0%, #fde68a 100%);
          border-radius: 16px;
          padding: 16px 20px;
          margin-bottom: 24px;
          border-left: 8px solid #f59e0b;
        }
        .inventory-content {
          display: flex;
          justify-content: space-between;
          align-items: center;
          flex-wrap: wrap;
          gap: 12px;
        }
        .inventory-left {
          display: flex;
          align-items: center;
          gap: 12px;
          flex-wrap: wrap;
        }
        .inventory-left h3 {
          font-weight: bold;
          font-size: 20px;
          margin: 0;
        }
        .stock-value {
          font-size: 32px;
          font-weight: 900;
          margin: 0;
        }
        .inventory-right {
          display: flex;
          align-items: center;
          gap: 12px;
          flex-wrap: wrap;
        }
        .low-stock-badge {
          background: #ef4444;
          color: white;
          padding: 4px 12px;
          border-radius: 999px;
          font-size: 14px;
        }

        /* ---- Tabs ---- */
        .tabs {
          display: flex;
          gap: 8px;
          margin-bottom: 24px;
          border-bottom: 2px solid #e5e7eb;
        }
        .tab {
          padding: 8px 16px;
          background: transparent;
          color: #4b5563;
          border: none;
          border-radius: 8px 8px 0 0;
          cursor: pointer;
          font-weight: 500;
          transition: all 0.2s;
        }
        .tab.active {
          background: #10b981;
          color: white;
        }
        .tab:hover:not(.active) {
          background: #f3f4f6;
        }

        /* ---- Schedules Section ---- */
        .schedules-section {
          background: white;
          border-radius: 16px;
          padding: 20px;
          box-shadow: 0 1px 3px rgba(0,0,0,0.1);
        }
        .section-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 16px;
          flex-wrap: wrap;
        }
        .section-header h3 {
          font-size: 20px;
          font-weight: bold;
          margin: 0;
        }
        .btn-add {
          background: #10b981;
          color: white;
          border: none;
          padding: 8px 16px;
          border-radius: 8px;
          cursor: pointer;
          font-weight: 500;
          display: flex;
          align-items: center;
          gap: 6px;
          transition: background 0.2s;
        }
        .btn-add:hover {
          background: #059669;
        }

        /* ---- Form ---- */
        .schedule-form {
          background: #f0fdf4;
          padding: 16px;
          border-radius: 16px;
          margin-bottom: 16px;
          border: 1px solid #bbf7d0;
        }
        .form-grid {
          display: grid;
          grid-template-columns: 1fr 1fr 1fr 1fr;
          gap: 12px;
        }
        .form-field label {
          display: block;
          margin-bottom: 4px;
          font-weight: 500;
        }
        .form-field input,
        .form-field select {
          width: 100%;
          padding: 8px;
          border-radius: 8px;
          border: 1px solid #ccc;
          font-size: 14px;
        }
        .form-actions {
          display: flex;
          gap: 8px;
          justify-content: flex-end;
          margin-top: 12px;
        }
        .btn-cancel {
          background: #9ca3af;
          padding: 6px 12px;
          border-radius: 8px;
          border: none;
          color: white;
          cursor: pointer;
        }
        .btn-save {
          background: #10b981;
          padding: 6px 12px;
          border-radius: 8px;
          border: none;
          color: white;
          cursor: pointer;
        }
        .btn-save:hover {
          background: #059669;
        }

        /* ---- Schedule Cards ---- */
        .schedules-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
          gap: 16px;
          margin-top: 8px;
        }
        .schedule-card {
          border: 1px solid #e5e7eb;
          border-radius: 16px;
          padding: 16px;
          background: #fafafa;
        }
        .schedule-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          margin-bottom: 12px;
          flex-wrap: wrap;
        }
        .schedule-header i {
          color: #f59e0b;
        }
        .schedule-header strong {
          margin-left: 8px;
        }
        .feed-type {
          display: block;
          font-size: 14px;
          color: #4b5563;
        }
        .pig-assignment {
          display: block;
          font-size: 12px;
          color: #6b7280;
        }
        .schedule-actions {
          display: flex;
          gap: 6px;
        }
        .btn-edit {
          background: #e0e7ff;
          border: none;
          padding: 4px 8px;
          border-radius: 8px;
          cursor: pointer;
        }
        .btn-delete {
          background: #fee2e2;
          border: none;
          padding: 4px 8px;
          border-radius: 8px;
          cursor: pointer;
          color: #ef4444;
        }
        .schedule-footer {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-top: 8px;
        }
        .amount {
          font-weight: bold;
        }
        .btn-log {
          background: #10b981;
          border: none;
          padding: 6px 12px;
          border-radius: 12px;
          color: white;
          cursor: pointer;
          display: flex;
          align-items: center;
          gap: 4px;
          transition: background 0.2s;
        }
        .btn-log-offline {
          background: #f59e0b !important;
        }
        .btn-log-offline:hover {
          background: #d97706 !important;
        }
        .btn-log:disabled {
          background: #9ca3af;
          cursor: not-allowed;
        }
        .btn-log.btn-log-success:disabled {
          background: #34d399; /* lighter green for success */
          color: white;
          opacity: 0.9;
        }

        /* ---- AI Alert ---- */
        .ai-alert {
          margin-top: 24px;
          padding: 16px;
          border-radius: 16px;
          border-left: 4px solid #0ea5e9;
          background: #e0f2fe;
        }
        .ai-alert.warning {
          border-left-color: #ef4444;
          background: #fee2e2;
        }
        .ai-alert.success {
          border-left-color: #0ea5e9;
          background: #e0f2fe;
        }

        /* ---- Logs ---- */
        .logs-section {
          background: white;
          border-radius: 16px;
          padding: 20px;
          box-shadow: 0 1px 3px rgba(0,0,0,0.1);
        }
        .logs-section h3 {
          font-size: 20px;
          font-weight: bold;
          margin-bottom: 16px;
        }
        .table-wrapper {
          overflow-x: auto;
        }
        .logs-table {
          width: 100%;
          border-collapse: collapse;
        }
        .logs-table th {
          background: #f3f4f6;
          padding: 12px;
          text-align: left;
        }
        .logs-table td {
          padding: 8px 12px;
          border-bottom: 1px solid #e5e7eb;
        }
        .empty-cell {
          text-align: center;
          padding: 32px;
          color: #6b7280;
        }
        .empty-state {
          text-align: center;
          padding: 32px;
          color: #6b7280;
          grid-column: 1 / -1;
        }

        /* ---- Loading ---- */
        .loading-container {
          text-align: center;
          padding: 48px;
        }

        /* ---- Keyframes ---- */
        @keyframes slideIn {
          from { opacity: 0; transform: translateX(20px); }
          to { opacity: 1; transform: translateX(0); }
        }

        /* ---- Responsive breakpoints ---- */
        @media (max-width: 1024px) {
          .form-grid {
            grid-template-columns: 1fr 1fr;
          }
          .inventory-content {
            flex-direction: column;
            align-items: stretch;
          }
          .inventory-left, .inventory-right {
            justify-content: center;
          }
        }

        @media (max-width: 768px) {
          .form-grid {
            grid-template-columns: 1fr;
          }
          .schedules-grid {
            grid-template-columns: 1fr;
          }
          .section-header {
            flex-direction: column;
            align-items: stretch;
            gap: 8px;
          }
          .btn-add {
            width: 100%;
            justify-content: center;
          }
          .inventory-left h3 {
            font-size: 18px;
          }
          .stock-value {
            font-size: 28px;
          }
          .inventory-right p {
            font-size: 14px;
          }
          .tab {
            font-size: 14px;
            padding: 6px 12px;
          }
        }

        @media (max-width: 480px) {
          .feeding-container {
            padding: 8px;
          }
          .notification-container {
            top: 10px;
            right: 10px;
            max-width: calc(100% - 20px);
          }
          .notification {
            font-size: 12px;
            padding: 10px 12px;
          }
          .inventory-summary {
            padding: 12px;
          }
          .stock-value {
            font-size: 24px;
          }
          .schedule-card {
            padding: 12px;
          }
          .btn-log {
            font-size: 12px;
            padding: 4px 10px;
          }
        }
      `}</style>
    </div>
  );
}