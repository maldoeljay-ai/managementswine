import { useEffect, useState } from 'react';
import { dataAPI } from '../lib/data';
import { Bar } from 'react-chartjs-2';
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend } from 'chart.js';
import Swal from 'sweetalert2';
import { isOnline } from '../lib/sync';
import { addNotification as pushOwnerNotification } from '../lib/notifications';

// ---- Date formatter: "Jul 24, 2026" ----
function fmtDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr + 'T00:00:00');
  if (isNaN(d)) return dateStr;
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend);

// ─── Cause badge colors ────────────────────────────────────────────
const causeBadge = {
  Disease: { bg: '#fee2e2', color: '#b91c1c' },
  Injury: { bg: '#fef3c7', color: '#92400e' },
  'Old Age': { bg: '#e0e7ff', color: '#3730a3' },
  Unknown: { bg: '#f3f4f6', color: '#4b5563' },
  Other: { bg: '#f0fdf4', color: '#166534' },
};

function CausePill({ cause }) {
  const cfg = causeBadge[cause] || causeBadge.Other;
  return (
    <span style={{
      background: cfg.bg, color: cfg.color,
      padding: '3px 12px', borderRadius: 999,
      fontSize: 12, fontWeight: 700,
    }}>
      {cause}
    </span>
  );
}

function SummaryCard({ icon, iconColor, value, label, sub, highlight }) {
  return (
    <div style={{
      background: highlight ? 'linear-gradient(135deg, #fff1f2, #ffe4e6)' : 'white',
      borderRadius: 16,
      padding: 20,
      border: highlight ? '1.5px solid #fca5a5' : '1.5px solid #e5e7eb',
      boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
        <div style={{
          width: 40, height: 40, borderRadius: '50%',
          background: `${iconColor}22`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 20,
        }}>
          {icon}
        </div>
        <span style={{ fontSize: 13, color: '#6b7280', fontWeight: 500 }}>{label}</span>
      </div>
      <p style={{ fontSize: 32, fontWeight: 900, margin: 0, color: highlight ? '#b91c1c' : '#1f2937' }}>{value}</p>
      {sub && <p style={{ fontSize: 12, color: '#9ca3af', margin: '4px 0 0' }}>{sub}</p>}
    </div>
  );
}

export default function GrowthMortality({ profile }) {
  const [growth, setGrowth] = useState([]);
  const [mortality, setMortality] = useState([]);
  const [pigs, setPigs] = useState([]);
  const [online, setOnline] = useState(isOnline());
  const [activeTab, setActiveTab] = useState('growth');

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

  useEffect(() => {
    loadData();
    window.addEventListener('refreshAllData', loadData);
    return () => {
      window.removeEventListener('refreshAllData', loadData);
    };
  }, []);


  async function loadData() {
    const [growthResult, mortalityResult, pigsResult] = await Promise.allSettled([
      dataAPI.growth_records.getAll(),
      dataAPI.mortality_records.getAll(),
      dataAPI.pigs.getAll(),
    ]);
    const growthData = growthResult.status === 'fulfilled' ? growthResult.value : [];
    const mortalityData = mortalityResult.status === 'fulfilled' ? mortalityResult.value : [];
    const pigsData = pigsResult.status === 'fulfilled' ? pigsResult.value : [];

    // Calculate dynamic gain by sorting chronologically first
    const chronologicalGrowth = (growthData || []).slice().sort((a, b) => new Date(a.date) - new Date(b.date));
    const pigPreviousWeights = {};
    const processedGrowth = chronologicalGrowth.map(g => {
      const prev = pigPreviousWeights[g.pig_id];
      const gain = prev !== undefined ? Math.round((g.weight_kg - prev) * 10) / 10 : null;
      pigPreviousWeights[g.pig_id] = g.weight_kg;
      return { ...g, dynamicGain: gain };
    });

    // Sort newest first for display
    const sorted = processedGrowth.sort((a, b) => new Date(b.date) - new Date(a.date));
    setGrowth(sorted);
    setMortality((mortalityData || []).slice().sort((a, b) => new Date(b.date) - new Date(a.date)));
    setPigs(pigsData || []);
  }

  function getPigLabel(pigId) {
    const p = pigs.find(x => x.id === pigId);
    return p ? `${p.tag}${p.name ? ` (${p.name})` : ''}` : pigId;
  }

  // ─── Last recorded weight per pig ───────────────────────────────
  const lastWeightByPig = {};
  [...growth].reverse().forEach(g => {
    lastWeightByPig[g.pig_id] = g.weight_kg;
  });

  // ─── Chart: last 10 weight records ──────────────────────────────
  const chartData = {
    labels: growth.slice(0, 10).reverse().map(g => `${getPigLabel(g.pig_id).split('(')[0].trim()} • ${g.date}`),
    datasets: [{
      label: 'Weight (kg)',
      data: growth.slice(0, 10).reverse().map(g => g.weight_kg),
      backgroundColor: growth.slice(0, 10).reverse().map((_, i) =>
        `hsla(${160 + i * 12}, 70%, 50%, 0.8)`
      ),
      borderRadius: 8,
      borderSkipped: false,
    }],
  };

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: true,
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          label: ctx => ` ${ctx.parsed.y} kg`,
          title: ctxArr => ctxArr[0].label,
        },
        backgroundColor: '#1f2937',
        padding: 12,
        cornerRadius: 10,
      },
    },
    scales: {
      x: {
        grid: { display: false },
        ticks: { font: { size: 11 }, color: '#6b7280' },
      },
      y: {
        beginAtZero: true,
        grid: { color: 'rgba(0,0,0,0.05)' },
        ticks: { font: { size: 11 }, color: '#6b7280', callback: v => `${v} kg` },
        title: { display: true, text: 'Weight (kg)', color: '#9ca3af', font: { size: 11 } },
      },
    },
  };

  // ================================================================
  // 🆕 IMPROVED "Record a Pig Death" form
  // ================================================================
  async function addMortality() {
    const pigOptions = pigs.filter(p => p.status === 'active').map(p =>
      `<option value="${p.id}">${p.tag}${p.name ? ` - ${p.name}` : ''}</option>`
    ).join('');

    const { value: formValues } = await Swal.fire({
      title: '💀 Record a Pig Death',
      html: `
        <div style="text-align:left; max-width:480px; margin:0 auto;">
          <p style="color:#6b7280; font-size:14px; margin:0 0 16px 0;">
            Use this form when a pig has died. The pig will be marked as <strong style="color:#dc2626;">deceased</strong> and will no longer appear in active lists.
          </p>

          <div style="margin-bottom:18px;">
            <label style="display:block; font-weight:600; font-size:14px; color:#374151; margin-bottom:4px;">
              <i class="fas fa-piggy-bank" style="margin-right:6px; color:#6b7280;"></i> Which pig died?
            </label>
            <select id="swal-pig-id" class="swal2-select" style="width:100%; padding:10px 12px; border-radius:8px; border:1.5px solid #d1d5db; font-size:14px; background:white;">
              <option value="" disabled selected>Select a pig…</option>
              ${pigOptions}
            </select>
          </div>

          <div style="margin-bottom:18px;">
            <label style="display:block; font-weight:600; font-size:14px; color:#374151; margin-bottom:4px;">
              <i class="fas fa-question-circle" style="margin-right:6px; color:#6b7280;"></i> Cause of Death
            </label>
            <select id="swal-cause" class="swal2-select" style="width:100%; padding:10px 12px; border-radius:8px; border:1.5px solid #d1d5db; font-size:14px; background:white;">
              <option value="" disabled selected>Select the cause…</option>
              <option value="Disease"> Disease</option>
              <option value="Injury"> Injury</option>
              <option value="Old Age"> Old Age</option>
              <option value="Unknown"> Unknown</option>
              <option value="Other"> Other</option>
            </select
          </div>

          <div style="background:#fef2f2; border-left:4px solid #ef4444; padding:12px 14px; border-radius:8px; font-size:13px; color:#991b1b; margin-top:8px;">
            <i class="fas fa-exclamation-triangle" style="margin-right:6px;"></i>
            <strong>Note:</strong> Recording a death will immediately mark the pig as <strong>deceased</strong> and remove it from the active herd and breeding options.
          </div>
        </div>
      `,
      focusConfirm: false,
      showCancelButton: true,
      confirmButtonText: '✅ Record Death',
      confirmButtonColor: '#ef4444',
      cancelButtonColor: '#6b7280',
      reverseButtons: true,
      width: 560,
      padding: '1.5rem',
      preConfirm: () => {
        const pigId = document.getElementById('swal-pig-id').value;
        const cause = document.getElementById('swal-cause').value;
        if (!pigId || !cause) {
          Swal.showValidationMessage('Please select a pig and a cause of death.');
          return false;
        }
        return { pigId, cause };
      }
    });

    if (!formValues) return;
    const { pigId, cause } = formValues;

    try {
      // Insert mortality record
      await dataAPI.mortality_records.insert({
        cause,
        date: new Date().toISOString().split('T')[0],
        pig_id: pigId,
      });
      // Mark the pig as deceased
      await dataAPI.pigs.update(pigId, { status: 'deceased' });

      const actorName = profile?.username || 'Caretaker';
      await pushOwnerNotification(
        'mortality_recorded',
        `${actorName} recorded a mortality event for pig ${getPigLabel(pigId)}. Cause: ${cause}.`,
        'Owner',
        actorName
      );
      Swal.fire({ icon: 'success', title: 'Recorded', text: 'Mortality event has been saved.', timer: 1600, showConfirmButton: false });
      loadData();
    } catch (error) {
      Swal.fire('Error', error.message, 'error');
    }
  }

  // ─── Record weight ───────────────────────────────────────────────
  async function addWeight() {
    const pigOptions = pigs.filter(p => p.status === 'active').map(p =>
      `<option value="${p.id}">${p.tag}${p.name ? ` - ${p.name}` : ''}</option>`
    ).join('');

    const { value: formValues } = await Swal.fire({
      title: '📏 Record Pig Weight',
      html:
        '<p style="color:#6b7280;font-size:14px;margin:0 0 16px">Weigh the pig and enter the reading here. This tracks how much the pig has grown over time.</p>' +
        '<div style="display:flex;flex-direction:column;gap:12px;">' +
        `<div><label style="font-weight:600;font-size:13px;color:#374151;display:block;margin-bottom:4px">🐷 Which pig did you weigh?</label>` +
        `<select id="swal-pig-id" class="swal2-select" style="margin:0;width:100%;max-width:100%;box-sizing:border-box;">` +
        `<option value="" disabled selected>Select a pig…</option>${pigOptions}` +
        `</select></div>` +
        '<div><label style="font-weight:600;font-size:13px;color:#374151;display:block;margin-bottom:4px">⚖️ Current Weight (kg)</label>' +
        '<input id="swal-weight" type="number" step="0.1" min="0.1" class="swal2-input" placeholder="e.g., 45.5" style="margin:0;"/>' +
        '<p style="font-size:12px;color:#9ca3af;margin:4px 0 0">Enter the weight in kilograms (kg)</p></div>' +
        '</div>',
      focusConfirm: false,
      showCancelButton: true,
      confirmButtonText: '✅ Save Weight',
      confirmButtonColor: '#10b981',
      preConfirm: () => {
        const pigId = document.getElementById('swal-pig-id').value;
        const weight = document.getElementById('swal-weight').value;
        if (!pigId || !weight || isNaN(parseFloat(weight)) || parseFloat(weight) <= 0) {
          Swal.showValidationMessage('Please select a pig and enter a valid weight.');
          return false;
        }
        return { pigId, weight };
      }
    });

    if (!formValues) return;
    const { pigId, weight } = formValues;

    try {
      const weightKg = parseFloat(weight);
      // Calculate gain vs previous record
      const prevWeight = lastWeightByPig[pigId] || 0;
      const gain = Math.round((weightKg - prevWeight) * 10) / 10;
      await dataAPI.growth_records.insert({
        pig_id: pigId,
        date: new Date().toISOString().split('T')[0],
        weight_kg: weightKg,
        gain,
      });
      const actorName = profile?.username || 'Caretaker';
      await pushOwnerNotification(
        'growth_recorded',
        `${actorName} recorded weight for pig ${getPigLabel(pigId)}: ${weightKg} kg${gain > 0 ? ` (+${gain} kg gain)` : ''}.`,
        'Owner',
        actorName
      );
      Swal.fire({ icon: 'success', title: 'Saved!', text: `Weight of ${weightKg} kg recorded.`, timer: 1600, showConfirmButton: false });
      loadData();
    } catch (error) {
      Swal.fire('Error', error.message, 'error');
    }
  }

  const handleDeleteGrowth = async (id) => {
    const result = await Swal.fire({
      title: 'Delete this record?',
      text: "This weight record will be permanently deleted.",
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#ef4444',
      cancelButtonColor: '#9ca3af',
      confirmButtonText: 'Yes, delete it'
    });
    if (result.isConfirmed) {
      try {
        await dataAPI.growth_records.delete(id);
        await loadData();
        Swal.fire({ icon: 'success', title: 'Deleted', timer: 1200, showConfirmButton: false });
      } catch (err) {
        Swal.fire('Error', err.message, 'error');
      }
    }
  };

  // ─── Summary stats ───────────────────────────────────────────────
  const lastWeight = growth.length > 0 ? growth[0].weight_kg : null;
  const lastWeightPig = growth.length > 0 ? getPigLabel(growth[0].pig_id) : '—';
  const totalGainKg = growth.reduce((s, g) => s + (g.gain || 0), 0);

  // ─── Tab button style ────────────────────────────────────────────
  const tabStyle = (active) => ({
    padding: '10px 24px',
    borderRadius: 10,
    border: 'none',
    cursor: 'pointer',
    fontWeight: 700,
    fontSize: 14,
    transition: 'all 0.2s',
    background: active ? '#10b981' : 'transparent',
    color: active ? 'white' : '#6b7280',
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>

      {/* ─── Header ─── */}
      <div className="card" style={{ padding: '20px 24px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginBottom: 4 }}>
          <div>
            <h3 style={{ fontSize: 22, fontWeight: 800, margin: 0, display: 'flex', alignItems: 'center', gap: 10, color: '#1f2937' }}>
              <span style={{ background: 'linear-gradient(135deg, #059669, #10b981)', borderRadius: 10, width: 38, height: 38, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>📈</span>
              Growth &amp; Mortality Tracker
            </h3>
            <p style={{ margin: '6px 0 0', fontSize: 13, color: '#6b7280' }}>
              Track pig weights over time and log any deaths on the farm.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {!online && (
              <span style={{ background: '#fef3c7', color: '#92400e', padding: '6px 14px', borderRadius: 999, fontSize: 12, fontWeight: 700 }}>
                📶 Offline
              </span>
            )}
          </div>
        </div>
      </div>

      {/* ─── Summary Cards ─── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16 }}>
        <SummaryCard
          icon="📏"
          iconColor="#10b981"
          value={growth.length}
          label="Growth Records"
          sub="Total weight entries logged"
        />
        <SummaryCard
          icon="⚖️"
          iconColor="#6366f1"
          value={lastWeight !== null ? `${lastWeight} kg` : '—'}
          label="Last Recorded Weight"
          sub={lastWeight !== null ? `Pig: ${lastWeightPig}` : 'No records yet'}
        />
        <SummaryCard
          icon="📊"
          iconColor="#f59e0b"
          value={totalGainKg > 0 ? `+${totalGainKg.toFixed(1)} kg` : '—'}
          label="Total Weight Gain"
          sub="Sum of all recorded gains"
        />
        <SummaryCard
          icon="💀"
          iconColor="#ef4444"
          value={mortality.length}
          label="Mortality Events"
          sub="Total pig deaths recorded"
          highlight={mortality.length > 0}
        />
      </div>

      {/* ─── Action Buttons ─── */}
      <div className="card" style={{ padding: '20px 24px' }}>
        <h4 style={{ margin: '0 0 12px', fontWeight: 700, color: '#1f2937', fontSize: 16 }}>
          📋 Add a New Record
        </h4>
        <p style={{ margin: '0 0 16px', fontSize: 13, color: '#6b7280' }}>
          Choose an action below to log a new weight reading or record a pig that has died.
        </p>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <button
            onClick={addWeight}
            style={{
              background: 'linear-gradient(135deg, #059669, #10b981)',
              color: 'white', border: 'none', borderRadius: 12,
              padding: '12px 22px', cursor: 'pointer',
              fontWeight: 700, fontSize: 14,
              display: 'flex', alignItems: 'center', gap: 10,
              boxShadow: '0 4px 12px rgba(16,185,129,0.3)',
              transition: 'transform 0.15s, box-shadow 0.15s',
            }}
            onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-1px)'; e.currentTarget.style.boxShadow = '0 6px 18px rgba(16,185,129,0.4)'; }}
            onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = '0 4px 12px rgba(16,185,129,0.3)'; }}
          >
            <span style={{ fontSize: 20 }}>📏</span>
            <div style={{ textAlign: 'left' }}>
              <div>Record Weight</div>
              <div style={{ fontSize: 11, fontWeight: 400, opacity: 0.85 }}>Log how much a pig weighs today</div>
            </div>
          </button>

          <button
            onClick={addMortality}
            style={{
              background: 'linear-gradient(135deg, #dc2626, #ef4444)',
              color: 'white', border: 'none', borderRadius: 12,
              padding: '12px 22px', cursor: 'pointer',
              fontWeight: 700, fontSize: 14,
              display: 'flex', alignItems: 'center', gap: 10,
              boxShadow: '0 4px 12px rgba(239,68,68,0.3)',
              transition: 'transform 0.15s, box-shadow 0.15s',
            }}
            onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-1px)'; e.currentTarget.style.boxShadow = '0 6px 18px rgba(239,68,68,0.4)'; }}
            onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = '0 4px 12px rgba(239,68,68,0.3)'; }}
          >
            <span style={{ fontSize: 20 }}>💀</span>
            <div style={{ textAlign: 'left' }}>
              <div>Record a Death</div>
              <div style={{ fontSize: 11, fontWeight: 400, opacity: 0.85 }}>Log a pig that has died and why</div>
            </div>
          </button>
        </div>
      </div>

      {/* ─── Tabs ─── */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        {/* Tab switcher */}
        <div style={{ display: 'flex', gap: 4, padding: '16px 20px 0', borderBottom: '1px solid #e5e7eb', background: '#f9fafb' }}>
          <button style={tabStyle(activeTab === 'growth')} onClick={() => setActiveTab('growth')}>
            📏 Weight Records ({growth.length})
          </button>
          <button style={tabStyle(activeTab === 'chart')} onClick={() => setActiveTab('chart')}>
            📊 Growth Chart
          </button>
          <button style={tabStyle(activeTab === 'mortality')} onClick={() => setActiveTab('mortality')}>
            💀 Mortality Log ({mortality.length})
          </button>
        </div>

        {/* ─── Growth Records Table ─── */}
        {activeTab === 'growth' && (
          <div style={{ padding: '0 0 4px' }}>
            <div style={{ padding: '16px 20px 8px' }}>
              <p style={{ margin: 0, fontSize: 13, color: '#6b7280' }}>
                📌 <strong>How to use:</strong> Click <em>"Record Weight"</em> above after weighing a pig. The table below shows all past weight entries, newest first.
              </p>
            </div>
            {growth.length === 0 ? (
              <div style={{ padding: '48px 24px', textAlign: 'center', color: '#9ca3af' }}>
                <div style={{ fontSize: 48, marginBottom: 12 }}>📏</div>
                <p style={{ fontSize: 16, fontWeight: 600, color: '#374151', margin: '0 0 6px' }}>No weight records yet</p>
                <p style={{ fontSize: 14, margin: 0 }}>Click <strong>"Record Weight"</strong> above to log your first pig weight.</p>
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
                  <thead>
                    <tr style={{ background: '#f9fafb', borderBottom: '2px solid #e5e7eb' }}>
                      {['Pig', 'Date', 'Weight (kg)', 'Weight Gain', 'Notes', 'Actions'].map(h => (
                        <th key={h} style={{ padding: '12px 16px', textAlign: h === 'Actions' ? 'center' : 'left', fontSize: 12, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.5px', whiteSpace: 'nowrap' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {growth.map(g => (
                      <tr key={g.id} style={{ borderBottom: '1px solid #f3f4f6' }}
                        onMouseEnter={e => e.currentTarget.style.background = '#f9fafb'}
                        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                      >
                        <td style={{ padding: '12px 16px', fontWeight: 600, color: '#1f2937' }}>
                          🐷 {getPigLabel(g.pig_id)}
                        </td>
                        <td style={{ padding: '12px 16px', color: '#4b5563' }}>{fmtDate(g.date)}</td>
                        <td style={{ padding: '12px 16px' }}>
                          <span style={{ background: '#d1fae5', color: '#065f46', padding: '4px 12px', borderRadius: 999, fontWeight: 700, fontSize: 13 }}>
                            {g.weight_kg} kg
                          </span>
                        </td>
                        <td style={{ padding: '12px 16px' }}>
                          {g.dynamicGain === null ? (
                            <span style={{ color: '#9ca3af' }}>— first entry</span>
                          ) : g.dynamicGain > 0 ? (
                            <span style={{ color: '#059669', fontWeight: 600 }}>+{g.dynamicGain} kg ▲</span>
                          ) : g.dynamicGain < 0 ? (
                            <span style={{ color: '#dc2626', fontWeight: 600 }}>{g.dynamicGain} kg ▼</span>
                          ) : (
                            <span style={{ color: '#6b7280', fontWeight: 600 }}>No change</span>
                          )}
                        </td>
                        <td style={{ padding: '12px 16px', color: '#6b7280', fontSize: 13 }}>{g.notes || '—'}</td>
                        <td style={{ padding: '12px 16px', textAlign: 'center' }}>
                          <button onClick={() => handleDeleteGrowth(g.id)} style={{ background: '#fee2e2', border: 'none', padding: '6px 10px', borderRadius: 6, cursor: 'pointer', color: '#dc2626' }} title="Delete Record">
                            <i className="fas fa-trash-alt" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ─── Growth Chart ─── */}
        {activeTab === 'chart' && (
          <div style={{ padding: 24 }}>
            <p style={{ margin: '0 0 16px', fontSize: 13, color: '#6b7280' }}>
              📊 Shows the last 10 weight entries across all pigs. Each bar represents one weigh-in.
            </p>
            {growth.length === 0 ? (
              <div style={{ padding: '48px 24px', textAlign: 'center', color: '#9ca3af' }}>
                <div style={{ fontSize: 48, marginBottom: 12 }}>📊</div>
                <p style={{ fontSize: 16, fontWeight: 600, color: '#374151', margin: '0 0 6px' }}>No chart data yet</p>
                <p style={{ fontSize: 14, margin: 0 }}>Log some pig weights to see the growth chart.</p>
              </div>
            ) : (
              <Bar data={chartData} options={chartOptions} height={120} />
            )}
          </div>
        )}

        {/* ─── Mortality Table ─── */}
        {activeTab === 'mortality' && (
          <div style={{ padding: '0 0 4px' }}>
            <div style={{ padding: '16px 20px 8px' }}>
              <p style={{ margin: 0, fontSize: 13, color: '#6b7280' }}>
                📌 <strong>How to use:</strong> Click <em>"Record a Death"</em> above when a pig has died. Select the pig and the reason. This log is for reporting purposes only.
              </p>
            </div>
            {mortality.length === 0 ? (
              <div style={{ padding: '48px 24px', textAlign: 'center', color: '#9ca3af' }}>
                <div style={{ fontSize: 48, marginBottom: 12 }}>💀</div>
                <p style={{ fontSize: 16, fontWeight: 600, color: '#374151', margin: '0 0 6px' }}>No mortality events recorded</p>
                <p style={{ fontSize: 14, margin: 0 }}>Great! No pig deaths have been logged yet.</p>
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
                  <thead>
                    <tr style={{ background: '#f9fafb', borderBottom: '2px solid #e5e7eb' }}>
                      {['Pig', 'Date of Death', 'Cause', 'Recorded By'].map(h => (
                        <th key={h} style={{ padding: '12px 16px', textAlign: 'left', fontSize: 12, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.5px', whiteSpace: 'nowrap' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {mortality.map(m => (
                      <tr key={m.id} style={{ borderBottom: '1px solid #f3f4f6', borderLeft: '4px solid #fca5a5' }}
                        onMouseEnter={e => e.currentTarget.style.background = '#fff5f5'}
                        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                      >
                        <td style={{ padding: '12px 16px', fontWeight: 600, color: '#1f2937' }}>
                          🐷 {getPigLabel(m.pig_id)}
                        </td>
                        <td style={{ padding: '12px 16px', color: '#4b5563' }}>{fmtDate(m.date)}</td>
                        <td style={{ padding: '12px 16px' }}>
                          <CausePill cause={m.cause} />
                        </td>
                        <td style={{ padding: '12px 16px', color: '#6b7280', fontSize: 13 }}>
                          {m.actor_name || '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}