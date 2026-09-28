import { useEffect, useState } from 'react';
import { dataAPI, getSingletonInventory } from '../lib/data';
import Swal from 'sweetalert2';
import { isOnline, getPendingCount } from '../lib/sync';
import { formatDate } from '../lib/utils';
import { addNotification as pushOwnerNotification, checkAndNotifyLowStock, checkAndNotifyLowStockWarning, checkAndNotifyFeedTypeLow, sendManualLowStockAlert } from '../lib/notifications';
import { analyseInventory, feedEfficiencyScore } from '../services/inventoryAI';
import { Line, Doughnut } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
  Filler,
} from 'chart.js';

ChartJS.register(
  CategoryScale, LinearScale, PointElement, LineElement,
  BarElement, ArcElement, Title, Tooltip, Legend, Filler
);

const TIME_BASED_TYPES = ['Morning', 'Afternoon', 'Evening'];



// ─── Chart theme ───
const CHART_COLORS = ['#10b981', '#f59e0b', '#3b82f6', '#a855f7', '#ef4444', '#06b6d4'];

const baseChartOptions = {
  responsive: true,
  maintainAspectRatio: true,
  animation: { duration: 800, easing: 'easeInOutQuart' },
  plugins: {
    legend: { position: 'top', labels: { font: { size: 12, family: 'Inter, sans-serif' }, padding: 16 } },
    tooltip: {
      backgroundColor: '#1f2937',
      titleFont: { size: 13, weight: 'bold' },
      bodyFont: { size: 12 },
      padding: 12,
      cornerRadius: 10,
      displayColors: true,
    },
  },
  scales: {
    x: {
      grid: { color: 'rgba(0,0,0,0.04)', drawBorder: false },
      ticks: { font: { size: 11 }, color: '#6b7280' },
    },
    y: {
      grid: { color: 'rgba(0,0,0,0.06)', drawBorder: false },
      ticks: { font: { size: 11 }, color: '#6b7280' },
      beginAtZero: true,
    },
  },
};

// ─── Helper: urgency badge ───
function UrgencyBadge({ urgency }) {
  const map = {
    critical: { bg: '#fee2e2', color: '#b91c1c', text: '🔴 Critical' },
    warning: { bg: '#fef3c7', color: '#92400e', text: '🟡 Warning' },
    ok: { bg: '#d1fae5', color: '#065f46', text: '🟢 Sufficient' },
  };
  const cfg = map[urgency] || map.ok;
  return (
    <span style={{
      padding: '3px 12px', borderRadius: 999, fontSize: 12, fontWeight: 700,
      background: cfg.bg, color: cfg.color,
    }}>
      {cfg.text}
    </span>
  );
}

// ─── Helper: metric card ───
function MetricCard({ icon, iconColor, iconBg, value, label, sub, onClick, extra }) {
  return (
    <div
      onClick={onClick}
      style={{
        padding: 20, background: iconBg || '#f9fafb', borderRadius: 16,
        cursor: onClick ? 'pointer' : 'default',
        transition: 'transform 0.2s, box-shadow 0.2s',
        border: `1px solid ${iconColor}22`,
      }}
      onMouseEnter={e => onClick && (e.currentTarget.style.transform = 'translateY(-2px)')}
      onMouseLeave={e => onClick && (e.currentTarget.style.transform = 'translateY(0)')}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
        <div style={{
          width: 36, height: 36, borderRadius: '50%',
          background: `${iconColor}22`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <i className={`fas ${icon}`} style={{ color: iconColor, fontSize: 16 }} />
        </div>
        <span style={{ fontSize: 13, color: '#6b7280', fontWeight: 500 }}>{label}</span>
      </div>
      <p style={{ fontSize: 32, fontWeight: 900, margin: 0, color: '#1f2937' }}>{value}</p>
      {sub && <p style={{ fontSize: 12, color: '#9ca3af', margin: '4px 0 0' }}>{sub}</p>}
      {extra}
    </div>
  );
}

export default function Inventory({ profile }) {
  const [inventory, setInventory] = useState({ id: null, feed_stock_kg: 0, min_threshold: 500 });
  const [restocks, setRestocks] = useState([]);
  const [dailyConsumption, setDailyConsumption] = useState(0);
  const [consumptionTrend, setConsumptionTrend] = useState([]);
  const [consumptionByType, setConsumptionByType] = useState({});
  const [typeForecasts, setTypeForecasts] = useState([]);
  const [feedInventory, setFeedInventory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showRestockForm, setShowRestockForm] = useState(false);
  const [restockAmount, setRestockAmount] = useState('');
  const [restockCost, setRestockCost] = useState('');
  const [selectedRestockType, setSelectedRestockType] = useState('');
  const [editThreshold, setEditThreshold] = useState(false);
  const [newThreshold, setNewThreshold] = useState('');
  const [pendingCount, setPendingCount] = useState(0);
  const [notifyingOwner, setNotifyingOwner] = useState(false);
  const [showFeedTypesModal, setShowFeedTypesModal] = useState(false);
  const [feedTypeForm, setFeedTypeForm] = useState({ id: null, name: '', min_threshold: 100 });

  const [online, setOnline] = useState(isOnline());

  useEffect(() => {
    const handleOnline = () => { setOnline(true); refreshPending(); };
    const handleOffline = () => { setOnline(false); refreshPending(); };
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    refreshPending();
    const poll = setInterval(refreshPending, 5000);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      clearInterval(poll);
    };
  }, []);

  async function refreshPending() {
    try { setPendingCount(await getPendingCount()); } catch (_) { /* ignore */ }
  }

  useEffect(() => {
    loadAllData();
  }, []);

  async function loadAllData() {
    setLoading(true);
    try {
      const inv = await loadInventory();
      await loadRestocks();
      await loadFeedInventory();
      await calculateConsumption(inv ? inv.feed_stock_kg : null);
    } catch (err) {
      console.error('Error loading inventory data:', err);
      Swal.fire('Error', 'Failed to load inventory data', 'error');
    } finally {
      setLoading(false);
    }
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

  // ─── Load inventory ───
  async function loadInventory() {
    let data = await getSingletonInventory();

    setInventory(data);
    setNewThreshold(data.min_threshold.toString());

    try {
      await checkAndNotifyLowStock(data.feed_stock_kg, data.min_threshold);
    } catch (e) {
      console.warn('Failed to send low-stock notification:', e);
    }

    try {
      await checkAndNotifyLowStockWarning(data.feed_stock_kg, data.min_threshold, 0);
    } catch (e) {
      console.warn('Failed to send low-stock warning notification:', e);
    }

    return data;
  }


  // ─── Load restocks ───
  async function loadRestocks() {
    const data = await dataAPI.inventory_restocks.getAll({
      orderBy: { column: 'date', ascending: false },
      limit: 10
    });
    setRestocks(data || []);
  }

  // ─── Calculate consumption ───
  async function calculateConsumption(overrideStock = null) {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const thirtyDaysAgoStr = thirtyDaysAgo.toISOString().split('T')[0];

    const [logs, allPigs] = await Promise.all([
      dataAPI.feeding_logs.getAll({ filters: { time: { gte: thirtyDaysAgoStr } } }),
      dataAPI.pigs.getAll(),
    ]);

    // Ignore "Morning / Afternoon / Evening" placeholder rows
    const realLogs = (logs || []).filter((l) => !TIME_BASED_TYPES.includes(l.type));

    // ── New AI layer ───────────────────────────────────────────
    const ai = analyseInventory({
      logs: realLogs,
      herd: allPigs || [],
      stockKg: overrideStock ?? inventory.feed_stock_kg ?? 0,
      minThresholdKg: inventory.min_threshold ?? 500,
      feederType: 'trough',
    });

    // Daily average is now data-driven + seasonally adjusted
    setDailyConsumption(ai.forecast.dailyAvg);

    // Persist the 7-day projection so the chart can use it
    setConsumptionTrend(
      ai.forecast.projection7.map((kg, i) => {
        const d = new Date();
        d.setDate(d.getDate() + i + 1);
        return { date: d.toISOString().slice(0, 10), amount: kg };
      })
    );

    // Per-feed-type breakdown still uses the raw log mix
    const typeMap = new Map();
    realLogs.forEach((l) => {
      const t = l.type || 'Other';
      typeMap.set(t, (typeMap.get(t) || 0) + Number(l.amount_kg || 0));
    });
    const daysWithData = ai.forecast.sampleDays || 1;
    const avgByType = {};
    typeMap.forEach((total, t) => {
      avgByType[t] = Math.round((total / daysWithData) * 10) / 10;
    });
    setConsumptionByType(avgByType);

    // Reuse the same estimator for per-type forecasts
    computeTypeForecasts(avgByType, ai.forecast.dailyAvg, overrideStock);
  }

  function computeTypeForecasts(avgByType, totalAvgDaily, overrideStock = null, stockPerType = {}) {
    if (!totalAvgDaily || totalAvgDaily === 0 || Object.keys(avgByType).length === 0) {
      setTypeForecasts([]);
      return;
    }

    const totalStock = overrideStock !== null ? overrideStock : inventory.feed_stock_kg;
    const forecasts = [];
    const today = new Date();

    for (const [type, avg] of Object.entries(avgByType)) {
      // Use true independent stock if available, else fallback to proportional estimate
      let estimatedStock = stockPerType[type] !== undefined 
        ? stockPerType[type] 
        : totalStock * (avg / totalAvgDaily);

      const daysLeft = avg > 0 ? Math.floor(estimatedStock / avg) : 0;
      const depletionDate = new Date(today);
      depletionDate.setDate(depletionDate.getDate() + daysLeft);
      const depletionDateStr = formatDate(depletionDate);
      const safeLevel = avg * 30;
      const recommendedRestock = Math.max(0, safeLevel - estimatedStock);

      forecasts.push({
        type,
        avgDaily: Math.round(avg * 10) / 10,
        estimatedStock: Math.round(estimatedStock * 10) / 10,
        daysLeft,
        depletionDate: depletionDateStr,
        recommendedRestock: Math.round(recommendedRestock * 10) / 10,
        urgency: daysLeft < 7 ? 'critical' : daysLeft < 14 ? 'warning' : 'ok',
      });
    }

    forecasts.sort((a, b) => {
      const rank = { critical: 0, warning: 1, ok: 2 };
      return rank[a.urgency] - rank[b.urgency];
    });

    setTypeForecasts(forecasts);
  }

  // ─── RESTOCK FUNCTION (with optimistic update) ───
  async function restock(amount = null, feedType = null) {
    let restockKg = amount;
    if (!restockKg) {
      const parsed = parseFloat(restockAmount);
      if (!restockAmount || isNaN(parsed) || parsed <= 0) {
        Swal.fire('Error', 'Please enter a valid amount in kg.', 'error');
        return;
      }
      restockKg = parsed;
    }

    if (!inventory.id) {
      Swal.fire('Error', 'Inventory record not found. Please refresh.', 'error');
      return;
    }

    const typeToUse = feedType || selectedRestockType || 'General';
    const newStock = inventory.feed_stock_kg + restockKg;

    try {
      // 1. Update inventory
      await dataAPI.inventory.update(inventory.id, {
        feed_stock_kg: newStock,
        last_restock: new Date().toISOString().split('T')[0]
      });

      // 2. Insert restock record
      await dataAPI.inventory_restocks.insert({
        amount_kg: restockKg,
        date: new Date().toISOString().split('T')[0],
        notes: `Manual restock for ${typeToUse}`
      });

      // 2b. If cost is provided, insert financial transaction
      const parsedCost = parseFloat(restockCost);
      if (restockCost && !isNaN(parsedCost) && parsedCost > 0) {
        await dataAPI.financial_transactions.insert({
          type: 'expense',
          category: 'Feed Costs',
          amount: parsedCost,
          date: new Date().toISOString().split('T')[0],
          description: `Restocked ${restockKg} kg of ${typeToUse}`
        });
      }

      // 3. Optimistically update local state
      setInventory(prev => ({ ...prev, feed_stock_kg: newStock }));

      // 4. Clear form fields
      setRestockAmount('');
      setRestockCost('');
      setSelectedRestockType('');
      setShowRestockForm(false);

      // 5. Refresh supporting data
      await loadRestocks();
      await calculateConsumption(newStock);

      // 6. Notifications & success message
      const actorName = profile?.username || 'User';
      await pushOwnerNotification(
        'feed_logged',
        `${actorName} restocked ${restockKg} kg of ${typeToUse}. Total stock now: ${newStock} kg.`,
        'Owner',
        actorName
      );

      const offlineNote = !online ? ' (saved offline – will sync when connected)' : '';
      Swal.fire('Success', `Added ${restockKg} kg of ${typeToUse}. New total: ${newStock} kg${offlineNote}`, 'success');
    } catch (err) {
      // On error, re‑fetch inventory to correct the displayed value
      await loadInventory();
      Swal.fire('Error', 'Failed to update inventory: ' + err.message, 'error');
    }
  }

  // ─── Update Threshold ───
  async function updateThreshold() {
    const threshold = parseFloat(newThreshold);
    if (isNaN(threshold) || threshold < 0) {
      Swal.fire('Error', 'Please enter a valid threshold', 'error');
      return;
    }
    try {
      await dataAPI.inventory.update(inventory.id, { min_threshold: threshold });

      setInventory({ ...inventory, min_threshold: threshold });
      setEditThreshold(false);
      Swal.fire('Success', 'Minimum threshold updated.', 'success');
    } catch (err) {
      Swal.fire('Error', 'Failed to update threshold', 'error');
    }
  }

  async function saveFeedType() {
    if (!feedTypeForm.name.trim()) return Swal.fire('Error', 'Name is required', 'error');
    try {
      if (feedTypeForm.id) {
        await dataAPI.feed_inventory.update(feedTypeForm.id, {
          name: feedTypeForm.name,
          type: feedTypeForm.name,
          min_threshold: feedTypeForm.min_threshold
        });
      } else {
        await dataAPI.feed_inventory.insert({
          name: feedTypeForm.name,
          type: feedTypeForm.name,
          quantity_kg: 0,
          min_threshold: feedTypeForm.min_threshold
        });
      }
      setFeedTypeForm({ id: null, name: '', min_threshold: 100 });
      loadFeedInventory();
    } catch (e) {
      Swal.fire('Error', e.message, 'error');
    }
  }

  async function deleteFeedType(id) {
    const res = await Swal.fire({ title: 'Delete?', text: 'Remove this feed type?', icon: 'warning', showCancelButton: true });
    if (res.isConfirmed) {
      try {
        await dataAPI.feed_inventory.delete(id);
        loadFeedInventory();
      } catch (e) {
        Swal.fire('Error', e.message, 'error');
      }
    }
  }

  async function handleNotifyOwner() {
    setNotifyingOwner(true);
    try {
      const actorName = profile?.username || 'Staff';
      await sendManualLowStockAlert(inventory.feed_stock_kg, inventory.min_threshold, actorName);
      Swal.fire({
        icon: 'success',
        title: '📬 Owner Notified!',
        text: `An urgent low-stock alert has been sent to the Owner. Current stock: ${inventory.feed_stock_kg} kg (threshold: ${inventory.min_threshold} kg).`,
        confirmButtonColor: '#ef4444',
      });
    } catch (err) {
      Swal.fire('Error', 'Failed to send notification: ' + err.message, 'error');
    } finally {
      setNotifyingOwner(false);
    }
  }

  // ─── Derived values & chart definitions (unchanged) ───
  const hasConsumptionData = dailyConsumption > 0;
  const daysLeft = hasConsumptionData ? Math.floor(inventory.feed_stock_kg / dailyConsumption) : 0;
  const depletionDate = new Date();
  if (hasConsumptionData) depletionDate.setDate(depletionDate.getDate() + daysLeft);
  const recommendedRestock = Math.max(0, inventory.min_threshold + 1000 - inventory.feed_stock_kg);
  const isLowStock = inventory.feed_stock_kg < inventory.min_threshold;
  const stockHealthPct = Math.min(100, Math.round((inventory.feed_stock_kg / (inventory.min_threshold * 2)) * 100));
  const weeklyOrder = hasConsumptionData ? Math.round(dailyConsumption * 7) : 0;
  const biWeeklyOrder = hasConsumptionData ? Math.round(dailyConsumption * 14) : 0;
  const monthlyOrder = hasConsumptionData ? Math.round(dailyConsumption * 30) : 0;

  // ─── Chart data ───
  const trendChartData = {
    labels: consumptionTrend.map(item => {
      const d = new Date(item.date);
      return formatDate(d);
    }),
    datasets: [{
      label: 'Feed Used (kg)',
      data: consumptionTrend.map(item => item.amount),
      borderColor: '#f59e0b',
      backgroundColor: 'rgba(245, 158, 11, 0.12)',
      fill: true,
      tension: 0.4,
      pointBackgroundColor: '#f59e0b',
      pointBorderColor: 'white',
      pointBorderWidth: 2,
      pointRadius: 5,
      pointHoverRadius: 7,
    }],
  };

  const trendChartOptions = {
    ...baseChartOptions,
    plugins: {
      ...baseChartOptions.plugins,
      legend: { display: false },
      tooltip: {
        ...baseChartOptions.plugins.tooltip,
        callbacks: { label: (ctx) => ` ${ctx.parsed.y} kg consumed` },
      },
      title: { display: false },
    },
    scales: {
      ...baseChartOptions.scales,
      y: {
        ...baseChartOptions.scales.y,
        title: { display: true, text: 'Feed (kg)', color: '#9ca3af', font: { size: 11 } },
      },
      x: {
        ...baseChartOptions.scales.x,
        title: { display: true, text: 'Date', color: '#9ca3af', font: { size: 11 } },
      },
    },
  };

  const forecastLabels = [];
  const forecastData = [];
  const thresholdLine = [];
  if (hasConsumptionData) {
    let currentStock = inventory.feed_stock_kg;
    for (let i = 0; i <= Math.min(14, Math.ceil(inventory.feed_stock_kg / dailyConsumption) + 2); i++) {
      const d = new Date();
      d.setDate(d.getDate() + i);
      forecastLabels.push(formatDate(d));
      forecastData.push(Math.max(0, Math.round(currentStock)));
      thresholdLine.push(inventory.min_threshold);
      currentStock -= dailyConsumption;
    }
  }

  const forecastChartData = {
    labels: forecastLabels,
    datasets: [
      {
        label: 'Projected Stock (kg)',
        data: forecastData,
        borderColor: '#10b981',
        backgroundColor: 'rgba(16,185,129,0.08)',
        fill: true,
        tension: 0.4,
        borderDash: [6, 3],
        pointBackgroundColor: forecastData.map((v) => v < inventory.min_threshold ? '#ef4444' : '#10b981'),
        pointRadius: 4,
        pointHoverRadius: 7,
        borderWidth: 2,
      },
      {
        label: 'Min Threshold (kg)',
        data: thresholdLine,
        borderColor: '#ef4444',
        borderDash: [4, 4],
        borderWidth: 2,
        pointRadius: 0,
        fill: false,
        backgroundColor: 'transparent',
      },
    ],
  };

  const forecastChartOptions = {
    ...baseChartOptions,
    plugins: {
      ...baseChartOptions.plugins,
      tooltip: {
        ...baseChartOptions.plugins.tooltip,
        callbacks: {
          label: (ctx) => {
            if (ctx.datasetIndex === 1) return ` Threshold: ${ctx.parsed.y} kg`;
            return ` ${ctx.parsed.y} kg stock`;
          },
        },
      },
    },
    scales: {
      ...baseChartOptions.scales,
      y: {
        ...baseChartOptions.scales.y,
        title: { display: true, text: 'Stock (kg)', color: '#9ca3af', font: { size: 11 } },
      },
      x: {
        ...baseChartOptions.scales.x,
        title: { display: true, text: 'Date', color: '#9ca3af', font: { size: 11 } },
      },
    },
  };

  const typeKeys = Object.keys(consumptionByType);
  const donutChartData = {
    labels: typeKeys,
    datasets: [{
      data: typeKeys.map(k => consumptionByType[k]),
      backgroundColor: CHART_COLORS.slice(0, typeKeys.length),
      borderWidth: 2,
      borderColor: 'white',
      hoverOffset: 8,
    }],
  };
  const donutOptions = {
    responsive: true,
    maintainAspectRatio: true,
    animation: { duration: 800, easing: 'easeInOutQuart' },
    plugins: {
      legend: { position: 'right', labels: { font: { size: 12 }, padding: 12, boxWidth: 14 } },
      tooltip: {
        ...baseChartOptions.plugins.tooltip,
        callbacks: { label: (ctx) => ` ${ctx.label}: ${ctx.parsed} kg/day (${Math.round((ctx.parsed / dailyConsumption) * 100)}%)` },
      },
    },
  };

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: 48 }}>
        <i className="fas fa-spinner fa-pulse fa-2x" style={{ color: '#10b981' }} />
        <p style={{ marginTop: 12, color: '#6b7280' }}>Loading AI Inventory intelligence…</p>
      </div>
    );
  }

  const urgentItems = typeForecasts.filter(f => f.urgency === 'critical' || f.urgency === 'warning');
  const typeOptions = typeForecasts.map(f => f.type);
  const feedInvOptions = feedInventory.map(f => f.name || f.type);
  
  // Also include default feed types in case feedInventory is empty
  const defaultTypes = ['Starter', 'Grower', 'Finisher', 'Gestation', 'Lactation', 'Breeder'];
  
  const uniqueTypes = ['General', ...new Set([...typeOptions, ...feedInvOptions, ...(feedInventory.length === 0 ? defaultTypes : [])])];

  // ─── JSX (unchanged) ───
  return (
    <div>
      {/* ─── Offline Banner ─── */}
      {!online && (
        <div style={{
          background: 'linear-gradient(135deg, #fef3c7, #fde68a)',
          border: '1px solid #f59e0b', borderRadius: 14,
          padding: '12px 16px', marginBottom: 20,
          display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
        }}>
          <i className="fas fa-wifi-slash" style={{ color: '#b45309', fontSize: 20 }} />
          <div style={{ flex: 1 }}>
            <strong style={{ color: '#78350f' }}>Offline Mode</strong>
            <p style={{ margin: '2px 0 0', fontSize: 13, color: '#92400e' }}>
              Changes are saved locally and will sync automatically when you reconnect.
            </p>
          </div>
          {pendingCount > 0 && (
            <span style={{ background: '#b45309', color: 'white', borderRadius: 999, padding: '4px 12px', fontSize: 13, fontWeight: 700 }}>
              <i className="fas fa-clock" style={{ marginRight: 6 }} />{pendingCount} action{pendingCount !== 1 ? 's' : ''} queued
            </span>
          )}
        </div>
      )}

      {/* ─── Main Card ─── */}
      <div className="card" style={{ marginBottom: 24 }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginBottom: 20 }}>
          <h3 style={{ fontSize: 22, fontWeight: 800, display: 'flex', alignItems: 'center', gap: 10, margin: 0 }}>
            <span style={{ background: 'linear-gradient(135deg, #059669, #10b981)', borderRadius: 10, width: 38, height: 38, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
              <i className="fas fa-brain" style={{ color: 'white', fontSize: 18 }} />
            </span>
            AI Inventory Management
          </h3>
        </div>

        {/* ─── Metric Cards ─── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16, marginBottom: 20 }}>
          <MetricCard
            icon="fa-boxes"
            iconColor="#10b981"
            value={`${inventory.feed_stock_kg} kg`}
            label="Current Stock"
            sub={isLowStock ? '⚠️ Below minimum threshold' : `${stockHealthPct}% of safe level`}
            extra={
              <div style={{ marginTop: 10 }}>
                <div style={{ height: 6, background: '#e5e7eb', borderRadius: 999, overflow: 'hidden' }}>
                  <div style={{
                    width: `${stockHealthPct}%`, height: 6, borderRadius: 999,
                    background: isLowStock ? '#ef4444' : stockHealthPct < 60 ? '#f59e0b' : '#10b981',
                    transition: 'width 0.8s ease',
                  }} />
                </div>
              </div>
            }
          />
          <MetricCard
            icon="fa-sliders-h"
            iconColor={isLowStock ? '#ef4444' : '#6366f1'}
            value={
              editThreshold ? (
                <div style={{ display: 'flex', gap: 6 }}>
                  <input type="number" value={newThreshold} onChange={e => setNewThreshold(e.target.value)}
                    style={{ width: 90, padding: '4px 8px', borderRadius: 8, border: '2px solid #6366f1', fontSize: 16, fontWeight: 700 }} autoFocus />
                  <button onClick={updateThreshold} style={{ background: '#6366f1', color: 'white', border: 'none', borderRadius: 8, padding: '4px 10px', cursor: 'pointer' }}>✓</button>
                  <button onClick={() => setEditThreshold(false)} style={{ background: '#e5e7eb', border: 'none', borderRadius: 8, padding: '4px 10px', cursor: 'pointer' }}>✕</button>
                </div>
              ) : (
                <span style={{ color: isLowStock ? '#ef4444' : '#1f2937', fontWeight: 900, fontSize: 28 }}>
                  {inventory.min_threshold} kg
                  {isLowStock && <span style={{ fontSize: 14, marginLeft: 6 }}>⚠️</span>}
                </span>
              )
            }
            label={<span>Min Threshold <i className="fas fa-pen" style={{ fontSize: 11, opacity: 0.6 }} /></span>}
            sub={isLowStock
              ? <span style={{ color: '#ef4444', fontWeight: 600 }}>⛔ Stock is below this limit!</span>
              : 'Click to edit the reorder trigger'
            }
            onClick={editThreshold ? undefined : () => setEditThreshold(true)}
          />
          <MetricCard
            icon="fa-chart-line"
            iconColor="#f59e0b"
            value={hasConsumptionData ? `${dailyConsumption} kg` : '—'}
            label="Avg Daily Usage"
            sub={hasConsumptionData ? 'Average over the last 30 days' : 'Log feedings to see this'}
          />
          {hasConsumptionData && (
            <MetricCard
              icon="fa-calendar-alt"
              iconColor={daysLeft < 7 ? '#ef4444' : daysLeft < 14 ? '#f59e0b' : '#10b981'}
              value={`${daysLeft} days`}
              label="Feed Remaining"
              sub={`Depletes on ${formatDate(depletionDate)}`}
            />
          )}
          {/* Efficiency badge — derived from FCR + stock health */}
          {(() => {
            const fcr = 2.8; // replace with computeFCR(feedKg, gainKg) if you wire growth records
            const score = feedEfficiencyScore(fcr);
            return (
              <MetricCard
                icon="fa-tachometer-alt"
                iconColor={score > 70 ? '#10b981' : score > 40 ? '#f59e0b' : '#ef4444'}
                value={`${score}/100`}
                label="Feed Efficiency"
                sub={`FCR ${fcr} · lower is better`}
              />
            );
          })()}
        </div>

        {/* ─── Status Banner ─── */}
        {isLowStock ? (
          <div style={{ background: 'linear-gradient(135deg, #fee2e2, #fecaca)', padding: '14px 18px', borderRadius: 14, color: '#b91c1c', marginBottom: 20, display: 'flex', alignItems: 'center', gap: 10 }}>
            <i className="fas fa-exclamation-triangle" style={{ fontSize: 20 }} />
            <div>
              <strong>CRITICAL: Stock Below Threshold</strong>
              <p style={{ margin: '2px 0 0', fontSize: 13 }}>
                Your feed stock ({inventory.feed_stock_kg} kg) is below the minimum threshold ({inventory.min_threshold} kg). Order immediately to avoid feeding disruptions.
              </p>
            </div>
          </div>
        ) : hasConsumptionData && daysLeft < 7 ? (
          <div style={{ background: '#fef3c7', padding: '14px 18px', borderRadius: 14, color: '#92400e', marginBottom: 20, display: 'flex', alignItems: 'center', gap: 10 }}>
            <i className="fas fa-clock" style={{ fontSize: 18 }} />
            <div>
              <strong>Warning: Less than 7 days of feed left</strong>
              <p style={{ margin: '2px 0 0', fontSize: 13 }}>At current usage of {dailyConsumption} kg/day, you'll run out by {formatDate(depletionDate)}. Place an order soon.</p>
            </div>
          </div>
        ) : hasConsumptionData ? (
          <div style={{ background: '#d1fae5', padding: '14px 18px', borderRadius: 14, color: '#065f46', marginBottom: 20, display: 'flex', alignItems: 'center', gap: 10 }}>
            <i className="fas fa-check-circle" style={{ fontSize: 18 }} />
            <div>
              <strong>Stock Level: Good</strong>
              <p style={{ margin: '2px 0 0', fontSize: 13 }}>You have {daysLeft} days of feed at current usage ({dailyConsumption} kg/day). Next depletion: {formatDate(depletionDate)}.</p>
            </div>
          </div>
        ) : (
          <div style={{ background: '#f3f4f6', padding: '14px 18px', borderRadius: 14, color: '#6b7280', marginBottom: 20, display: 'flex', alignItems: 'center', gap: 10 }}>
            <i className="fas fa-info-circle" style={{ fontSize: 18 }} />
            <div>
              <strong>No Consumption Data Yet</strong>
              <p style={{ margin: '2px 0 0', fontSize: 13 }}>Start logging feedings in the Smart Feeding module to unlock AI predictions.</p>
            </div>
          </div>
        )}

        {/* ─── AI Predictive Analysis ─── */}
        <div style={{ background: 'linear-gradient(135deg, #faf5ff, #eff6ff)', padding: 20, borderRadius: 20, border: '1px solid #e0e7ff', marginBottom: 20 }}>
          <h4 style={{ fontWeight: 700, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
            <i className="fas fa-robot" style={{ color: '#6366f1' }} />
            AI Predictive Analysis
          </h4>
          {hasConsumptionData ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16 }}>
              <div style={{ background: 'white', borderRadius: 14, padding: 16, borderLeft: '4px solid #6366f1' }}>
                <p style={{ fontSize: 12, color: '#6b7280', marginBottom: 4 }}>📉 DEPLETION FORECAST</p>
                <p style={{ fontSize: 15, color: '#1f2937', lineHeight: 1.5 }}>
                  At your current rate of <strong>{dailyConsumption} kg/day</strong>, your feed will run out on{' '}
                  <strong style={{ color: daysLeft < 7 ? '#ef4444' : '#059669' }}>
                    {formatDate(depletionDate)}
                  </strong>{' '}({daysLeft} days from now).
                </p>
              </div>
              <div style={{ background: 'white', borderRadius: 14, padding: 16, borderLeft: '4px solid #f59e0b' }}>
                <p style={{ fontSize: 12, color: '#6b7280', marginBottom: 4 }}>🛒 RESTOCK RECOMMENDATION</p>
                <p style={{ fontSize: 15, color: '#1f2937', lineHeight: 1.5 }}>
                  Order <strong style={{ color: '#d97706' }}>{recommendedRestock} kg</strong> to reach your safety level.
                  This will last approximately <strong>{Math.floor(recommendedRestock / dailyConsumption)} days</strong>.
                </p>
              </div>
              <div style={{ background: 'white', borderRadius: 14, padding: 16, borderLeft: '4px solid #10b981' }}>
                <p style={{ fontSize: 12, color: '#6b7280', marginBottom: 4 }}>📅 SUGGESTED ORDER SCHEDULE</p>
                <ul style={{ listStyle: 'none', padding: 0, margin: 0, fontSize: 14, lineHeight: 2 }}>
                  <li>Weekly order: <strong>{weeklyOrder} kg</strong></li>
                  <li>Bi-weekly order: <strong>{biWeeklyOrder} kg</strong></li>
                  <li>Monthly order: <strong>{monthlyOrder} kg</strong></li>
                </ul>
              </div>
            </div>
          ) : (
            <p style={{ color: '#6b7280' }}>⚠️ No consumption data yet. Log feedings to unlock AI predictions.</p>
          )}
        </div>

        {/* ─── Restock Alerts ─── */}
        {urgentItems.length > 0 && (
          <div style={{ background: '#fef2f2', padding: 18, borderRadius: 16, border: '1px solid #fca5a5', marginBottom: 20 }}>
            <h4 style={{ fontWeight: 700, color: '#b91c1c', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
              <i className="fas fa-bell" /> Restock Alerts — {urgentItems.length} Feed Type{urgentItems.length > 1 ? 's' : ''} Need Attention
            </h4>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
              {urgentItems.map((item, idx) => (
                <div key={idx} style={{
                  background: 'white', borderRadius: 12, padding: 14,
                  borderLeft: `4px solid ${item.urgency === 'critical' ? '#ef4444' : '#f59e0b'}`,
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                    <strong style={{ fontSize: 15 }}>{item.type}</strong>
                    <UrgencyBadge urgency={item.urgency} />
                  </div>
                  <p style={{ margin: 0, fontSize: 13, color: '#4b5563' }}>
                    <i className="fas fa-clock" style={{ marginRight: 4 }} />
                    Only <strong>{item.daysLeft} day{item.daysLeft !== 1 ? 's' : ''}</strong> left at {item.avgDaily} kg/day
                  </p>
                  <p style={{ margin: '4px 0 0', fontSize: 13, color: '#d97706', fontWeight: 600 }}>
                    <i className="fas fa-truck" style={{ marginRight: 4 }} />
                    Order {item.recommendedRestock} kg by {item.depletionDate}
                  </p>
                  <button
                    onClick={() => restock(item.recommendedRestock, item.type)}
                    style={{
                      marginTop: 10,
                      width: '100%',
                      background: '#10b981',
                      color: 'white',
                      border: 'none',
                      borderRadius: 8,
                      padding: '8px',
                      cursor: 'pointer',
                      fontWeight: 600,
                      fontSize: 13,
                      display: 'flex',
                      justifyContent: 'center',
                      alignItems: 'center',
                      gap: 6,
                      transition: 'background 0.2s'
                    }}
                    onMouseEnter={e => e.target.style.background = '#059669'}
                    onMouseLeave={e => e.target.style.background = '#10b981'}
                  >
                    <i className="fas fa-plus-circle" /> Restock Predicted Amount
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ─── Restock Actions ─── */}
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center', marginBottom: 20 }}>
          <button onClick={() => restock(1000, 'General')} style={{ background: '#10b981', color: 'white', border: 'none', borderRadius: 12, padding: '10px 20px', cursor: 'pointer', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8, transition: 'background 0.2s' }}
            onMouseEnter={e => e.target.style.background = '#059669'} onMouseLeave={e => e.target.style.background = '#10b981'}>
            <i className="fas fa-truck-fast" /> Quick Restock +1000 kg
          </button>
          <button onClick={() => restock(recommendedRestock, 'General')} disabled={!hasConsumptionData || recommendedRestock === 0}
            style={{ background: '#f59e0b', color: 'white', border: 'none', borderRadius: 12, padding: '10px 20px', cursor: (!hasConsumptionData || recommendedRestock === 0) ? 'not-allowed' : 'pointer', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8, opacity: (!hasConsumptionData || recommendedRestock === 0) ? 0.5 : 1 }}>
            <i className="fas fa-calculator" /> Restock AI Amount ({recommendedRestock} kg)
          </button>
          <button onClick={() => { setShowRestockForm(true); setSelectedRestockType('General'); }}
            style={{ background: '#3b82f6', color: 'white', border: 'none', borderRadius: 12, padding: '10px 20px', cursor: 'pointer', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
            <i className="fas fa-plus-circle" /> Custom Restock
          </button>
          <button onClick={() => setShowFeedTypesModal(true)}
            style={{ background: '#8b5cf6', color: 'white', border: 'none', borderRadius: 12, padding: '10px 20px', cursor: 'pointer', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
            <i className="fas fa-list" /> Manage Feed Types
          </button>

          {/* ─ Notify Owner button (only shown when stock is low and user is a caretaker) ─ */}
          {isLowStock && profile?.role?.includes('Caretaker') && (
            <button
              id="notify-owner-low-stock-btn"
              onClick={handleNotifyOwner}
              disabled={notifyingOwner}
              style={{
                background: notifyingOwner ? '#9ca3af' : 'linear-gradient(135deg, #ef4444, #b91c1c)',
                color: 'white',
                border: 'none',
                borderRadius: 12,
                padding: '10px 20px',
                cursor: notifyingOwner ? 'not-allowed' : 'pointer',
                fontWeight: 700,
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                boxShadow: notifyingOwner ? 'none' : '0 4px 14px rgba(239,68,68,0.4)',
                transition: 'all 0.2s',
                animation: notifyingOwner ? 'none' : 'pulse-red 1.8s infinite',
              }}
            >
              {notifyingOwner
                ? <><i className="fas fa-spinner fa-spin" /> Sending…</>
                : <><i className="fas fa-bell" /> Notify Owner — Restock Needed!</>}
            </button>
          )}
        </div>

        {/* ─── Feed Type Forecasts Table ─── */}
        {typeForecasts.length > 0 && (
          <div style={{ background: 'linear-gradient(135deg, #f0fdf4, #dcfce7)', padding: 20, borderRadius: 20, border: '1px solid #10b981', marginBottom: 20 }}>
            <h4 style={{ fontWeight: 700, marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
              <i className="fas fa-table" style={{ color: '#059669' }} />
              Feed‑Type Restock Predictions
            </h4>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14, background: 'white', borderRadius: 12, overflow: 'hidden' }}>
                <thead>
                  <tr style={{ background: '#f9fafb' }}>
                    {['Feed Type', 'Daily Use (kg)', 'Est. Stock (kg)', 'Days Left', 'Depletes On', 'Order (kg)', 'Status', 'Action'].map(h => (
                      <th key={h} style={{ padding: '10px 12px', textAlign: h === 'Feed Type' ? 'left' : 'center', fontSize: 12, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {typeForecasts.map((f, idx) => (
                    <tr key={idx} style={{ borderTop: '1px solid #f3f4f6' }}>
                      <td style={{ padding: '10px 12px', fontWeight: 600 }}>{f.type}</td>
                      <td style={{ padding: '10px 12px', textAlign: 'center' }}>{f.avgDaily}</td>
                      <td style={{ padding: '10px 12px', textAlign: 'center' }}>{f.estimatedStock}</td>
                      <td style={{ padding: '10px 12px', textAlign: 'center', fontWeight: 700, color: f.urgency === 'critical' ? '#ef4444' : f.urgency === 'warning' ? '#d97706' : '#059669' }}>{f.daysLeft}</td>
                      <td style={{ padding: '10px 12px', textAlign: 'center', fontSize: 13 }}>{f.depletionDate}</td>
                      <td style={{ padding: '10px 12px', textAlign: 'center', fontWeight: 600, color: '#d97706' }}>{f.recommendedRestock}</td>
                      <td style={{ padding: '10px 12px', textAlign: 'center' }}><UrgencyBadge urgency={f.urgency} /></td>
                      <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                        {f.urgency !== 'ok' && (
                          <button
                            onClick={() => restock(f.recommendedRestock, f.type)}
                            disabled={f.recommendedRestock === 0}
                            style={{
                              background: f.recommendedRestock > 0 ? '#10b981' : '#e5e7eb',
                              color: f.recommendedRestock > 0 ? 'white' : '#9ca3af',
                              border: 'none',
                              borderRadius: 6,
                              padding: '6px 10px',
                              cursor: f.recommendedRestock > 0 ? 'pointer' : 'not-allowed',
                              fontWeight: 600,
                              fontSize: 12,
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 4
                            }}
                          >
                            <i className="fas fa-plus" /> Add
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p style={{ marginTop: 10, fontSize: 13, color: '#4b5563' }}>
              💡 <strong>Tip:</strong> For <span style={{ color: '#b91c1c' }}>Critical</span> or <span style={{ color: '#92400e' }}>Warning</span> items, place orders immediately to prevent shortages.
            </p>
          </div>
        )}


        {/* ─── Custom Restock Modal ─── */}
        {showRestockForm && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}
            onClick={() => setShowRestockForm(false)}>
            <div style={{ background: 'white', padding: '32px', borderRadius: 24, width: '90%', maxWidth: 420, boxShadow: '0 24px 48px rgba(0,0,0,0.2)' }}
              onClick={e => e.stopPropagation()}>
              <h3 style={{ marginBottom: 8, fontSize: 22, fontWeight: 700 }}>📦 Custom Restock</h3>
              <p style={{ color: '#4b5563', fontSize: 14, marginBottom: 20 }}>Select a feed type and enter the quantity to add to your stock.</p>

              <label style={{ display: 'block', fontWeight: 600, marginBottom: 6, fontSize: 14 }}>Feed Type</label>
              <select value={selectedRestockType} onChange={e => setSelectedRestockType(e.target.value)}
                style={{ width: '100%', padding: '10px 14px', fontSize: 15, border: '2px solid #e5e7eb', borderRadius: 12, marginBottom: 16, outline: 'none' }}
                onFocus={e => e.target.style.borderColor = '#10b981'} onBlur={e => e.target.style.borderColor = '#e5e7eb'}>
                
                {urgentItems.length > 0 && (
                  <optgroup label="⚠️ Low Stock (Urgent)">
                    {urgentItems.map(item => (
                      <option key={`urgent-${item.type}`} value={item.type}>
                        {item.type} (Needs {item.recommendedRestock} kg)
                      </option>
                    ))}
                  </optgroup>
                )}
                
                <optgroup label="All Feed Types">
                  {uniqueTypes.filter(type => !urgentItems.some(u => u.type === type)).map(type => (
                    <option key={type} value={type}>{type}</option>
                  ))}
                </optgroup>
              </select>

              <label style={{ display: 'block', fontWeight: 600, marginBottom: 6, fontSize: 14 }}>Amount (kg)</label>
              <input type="number" step="10" min="1" placeholder="e.g., 500" value={restockAmount} onChange={e => setRestockAmount(e.target.value)}
                style={{ width: '100%', padding: '12px 14px', fontSize: 16, border: '2px solid #e5e7eb', borderRadius: 12, marginBottom: 16, outline: 'none', boxSizing: 'border-box' }}
                onFocus={e => e.target.style.borderColor = '#10b981'} onBlur={e => e.target.style.borderColor = '#e5e7eb'} autoFocus />

              <label style={{ display: 'block', fontWeight: 600, marginBottom: 6, fontSize: 14 }}>Total Cost (₱) - Optional</label>
              <input type="number" step="0.01" min="0" placeholder="e.g., 15000" value={restockCost} onChange={e => setRestockCost(e.target.value)}
                style={{ width: '100%', padding: '12px 14px', fontSize: 16, border: '2px solid #e5e7eb', borderRadius: 12, marginBottom: 24, outline: 'none', boxSizing: 'border-box' }}
                onFocus={e => e.target.style.borderColor = '#10b981'} onBlur={e => e.target.style.borderColor = '#e5e7eb'} />

              <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
                <button onClick={() => setShowRestockForm(false)} style={{ padding: '10px 20px', background: '#f3f4f6', border: 'none', borderRadius: 12, color: '#4b5563', fontWeight: 600, cursor: 'pointer' }}>Cancel</button>
                <button onClick={() => restock()} style={{ padding: '10px 24px', background: '#10b981', border: 'none', borderRadius: 12, color: 'white', fontWeight: 600, cursor: 'pointer' }}>
                  <i className="fas fa-plus-circle" style={{ marginRight: 6 }} />Add Restock
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ─── Manage Feed Types Modal ─── */}
        {showFeedTypesModal && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}
            onClick={() => { setShowFeedTypesModal(false); setFeedTypeForm({id: null, name: '', min_threshold: 100}); }}>
            <div style={{ background: 'white', padding: '32px', borderRadius: 24, width: '90%', maxWidth: 500, boxShadow: '0 24px 48px rgba(0,0,0,0.2)', maxHeight: '90vh', overflowY: 'auto' }}
              onClick={e => e.stopPropagation()}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                <h3 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>📋 Manage Feed Types</h3>
                <button onClick={() => { setShowFeedTypesModal(false); setFeedTypeForm({id: null, name: '', min_threshold: 100}); }} style={{ background: 'none', border: 'none', fontSize: 24, cursor: 'pointer', color: '#9ca3af' }}>&times;</button>
              </div>
              
              {/* List existing types */}
              <div style={{ marginBottom: 24 }}>
                <h4 style={{ margin: '0 0 12px 0', fontSize: 16, color: '#4b5563' }}>Current Feed Types</h4>
                {feedInventory.length === 0 ? (
                  <p style={{ color: '#9ca3af', fontSize: 14 }}>No custom feed types yet. Default types are used.</p>
                ) : (
                  <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {feedInventory.map(ft => (
                      <li key={ft.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px', border: '1px solid #e5e7eb', borderRadius: 12, background: '#f9fafb' }}>
                        <div>
                          <div style={{ fontWeight: 600 }}>{ft.name || ft.type}</div>
                          <div style={{ fontSize: 12, color: '#6b7280' }}>Min Threshold: {ft.min_threshold || 0} kg</div>
                        </div>
                        <div style={{ display: 'flex', gap: 8 }}>
                          <button onClick={() => setFeedTypeForm({ id: ft.id, name: ft.name || ft.type, min_threshold: ft.min_threshold || 0 })} style={{ background: '#3b82f6', color: 'white', border: 'none', borderRadius: 6, padding: '6px 10px', cursor: 'pointer' }}><i className="fas fa-edit"></i></button>
                          <button onClick={() => deleteFeedType(ft.id)} style={{ background: '#ef4444', color: 'white', border: 'none', borderRadius: 6, padding: '6px 10px', cursor: 'pointer' }}><i className="fas fa-trash"></i></button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* Form */}
              <h4 style={{ margin: '0 0 12px 0', fontSize: 16, color: '#4b5563' }}>{feedTypeForm.id ? 'Edit Feed Type' : 'Add New Feed Type'}</h4>
              <label style={{ display: 'block', fontWeight: 600, marginBottom: 6, fontSize: 14 }}>Name</label>
              <input type="text" placeholder="e.g., Premium Starter" value={feedTypeForm.name} onChange={e => setFeedTypeForm({...feedTypeForm, name: e.target.value})}
                style={{ width: '100%', padding: '12px 14px', fontSize: 16, border: '2px solid #e5e7eb', borderRadius: 12, marginBottom: 16, outline: 'none', boxSizing: 'border-box' }} />
              <label style={{ display: 'block', fontWeight: 600, marginBottom: 6, fontSize: 14 }}>Minimum Threshold (kg)</label>
              <input type="number" min="0" value={feedTypeForm.min_threshold} onChange={e => setFeedTypeForm({...feedTypeForm, min_threshold: parseInt(e.target.value) || 0})}
                style={{ width: '100%', padding: '12px 14px', fontSize: 16, border: '2px solid #e5e7eb', borderRadius: 12, marginBottom: 24, outline: 'none', boxSizing: 'border-box' }} />
              
              <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
                {feedTypeForm.id && <button onClick={() => setFeedTypeForm({id: null, name: '', min_threshold: 100})} style={{ padding: '10px 20px', background: '#f3f4f6', border: 'none', borderRadius: 12, color: '#4b5563', fontWeight: 600, cursor: 'pointer' }}>Cancel Edit</button>}
                <button onClick={saveFeedType} style={{ padding: '10px 24px', background: '#10b981', border: 'none', borderRadius: 12, color: 'white', fontWeight: 600, cursor: 'pointer' }}>
                  <i className="fas fa-save" style={{ marginRight: 6 }} />{feedTypeForm.id ? 'Save Changes' : 'Add Feed Type'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ─── Charts Row ─── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 24, marginBottom: 24 }}>
        {/* Consumption Trend */}
        <div className="card">
          <h4 style={{ fontWeight: 700, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
            <i className="fas fa-chart-area" style={{ color: '#f59e0b' }} />
            Feed Consumption Trend
          </h4>
          <p style={{ fontSize: 13, color: '#6b7280', marginBottom: 16 }}>Daily feed usage over the last 7 days</p>
          {consumptionTrend.length > 0 ? (
            <Line data={trendChartData} options={trendChartOptions} height={140} />
          ) : (
            <div style={{ textAlign: 'center', padding: '32px 0', color: '#9ca3af' }}>
              <i className="fas fa-chart-line" style={{ fontSize: 40, opacity: 0.3, display: 'block', marginBottom: 8 }} />
              No feeding data yet. Log feedings first.
            </div>
          )}
        </div>

        {/* Stock Forecast */}
        <div className="card">
          <h4 style={{ fontWeight: 700, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
            <i className="fas fa-chart-line" style={{ color: '#10b981' }} />
            Stock Forecast
          </h4>
          <p style={{ fontSize: 13, color: '#6b7280', marginBottom: 16 }}>Projected stock decline at current consumption rate — red line = min threshold</p>
          {hasConsumptionData && forecastData.length > 0 ? (
            <Line data={forecastChartData} options={forecastChartOptions} height={140} />
          ) : (
            <div style={{ textAlign: 'center', padding: '32px 0', color: '#9ca3af' }}>
              <i className="fas fa-chart-line" style={{ fontSize: 40, opacity: 0.3, display: 'block', marginBottom: 8 }} />
              Insufficient data to generate forecast.
            </div>
          )}
        </div>

        {/* Consumption by Type Donut */}
        {typeKeys.length > 0 && (
          <div className="card">
            <h4 style={{ fontWeight: 700, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
              <i className="fas fa-chart-pie" style={{ color: '#6366f1' }} />
              Usage by Feed Type
            </h4>
            <p style={{ fontSize: 13, color: '#6b7280', marginBottom: 16 }}>Daily average breakdown per feed type</p>
            <Doughnut data={donutChartData} options={donutOptions} />
          </div>
        )}
      </div>

      {/* ─── Restock History ─── */}
      <div className="card">
        <h4 style={{ fontWeight: 700, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
          <i className="fas fa-history" style={{ color: '#6b7280' }} />
          Recent Restock History
        </h4>
        {restocks.length === 0 ? (
          <p style={{ color: '#9ca3af', textAlign: 'center', padding: 24 }}>No restocks recorded yet.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: '#f9fafb' }}>
                  {['Date', 'Amount (kg)', 'Notes'].map(h => (
                    <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontSize: 12, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {restocks.map(r => (
                  <tr key={r.id} style={{ borderTop: '1px solid #f3f4f6' }}>
                    <td style={{ padding: '10px 14px', fontSize: 14 }}>{formatDate(r.date)}</td>
                    <td style={{ padding: '10px 14px', fontWeight: 600, color: '#059669' }}>{r.amount_kg} kg</td>
                    <td style={{ padding: '10px 14px', color: '#4b5563', fontSize: 13 }}>{r.notes || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}