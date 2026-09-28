import { useState, useEffect } from 'react';
import { Line, Radar, Bar } from 'react-chartjs-2';
import { Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, RadialLinearScale, BarElement, Title, Tooltip, Legend, Filler } from 'chart.js';
import Swal from 'sweetalert2';
import { addNotification } from '../lib/notifications';
import { supabase } from '../lib/supabase';
import { dataAPI, getActiveFarm } from '../lib/data';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, RadialLinearScale, BarElement, Title, Tooltip, Legend, Filler);

export default function Reports({ profile }) {
  const [loading, setLoading] = useState(true);
  const [fcrRaw, setFcrRaw] = useState([]);
  const [complianceRaw, setComplianceRaw] = useState([]);
  const [growthRaw, setGrowthRaw] = useState([]);
  const [userProgressRaw, setUserProgressRaw] = useState([]);

  // Quick stats state
  const [quickStats, setQuickStats] = useState({
    activePigs: 0,
    healthScore: 100,
    feedStatus: 'Unknown',
    alerts: 0,
  });

  useEffect(() => {
    fetchAnalytics();
  }, []);

  async function fetchAnalytics() {
    setLoading(true);
    try {
      // 1. Fetch all required tables locally
      const [
        feedingLogs, growthRecords, notifications, 
        profilesData, pigs, inventoryList, healthRecords
      ] = await Promise.all([
        dataAPI.feeding_logs.getAll(),
        dataAPI.growth_records.getAll(),
        dataAPI.notifications.getAll(),
        dataAPI.profiles.getAll(),
        dataAPI.pigs.getAll(),
        dataAPI.inventory.getAll(),
        dataAPI.health_records.getAll()
      ]);

      const activePigs = (pigs || []).filter(p => p.status === 'active');
      const unreadAlerts = (notifications || []).filter(n => !n.read && n.target_role === 'Owner').length;
      
      let totalFeedStock = 0;
      let totalMinThreshold = 0;
      (inventoryList || []).forEach(inv => {
        totalFeedStock += Number(inv.feed_stock_kg) || 0;
        totalMinThreshold += Number(inv.min_threshold) || 0;
      });
      const feedStatus = totalFeedStock > totalMinThreshold ? 'Adequate' : (totalFeedStock > 0 ? 'Low' : 'Critical');

      const sickPigs = new Set((healthRecords || []).map(r => r.pig_id)).size;
      const healthScore = activePigs.length > 0 
        ? Math.round(((activePigs.length - sickPigs) / activePigs.length) * 100) 
        : 100;

      setQuickStats({
        activePigs: activePigs.length,
        healthScore: Math.max(0, healthScore),
        feedStatus,
        alerts: unreadAlerts
      });

      // 2. Generate month keys for the last 6 months (YYYY-MM)
      const monthKeys = [];
      for (let i = 5; i >= 0; i--) {
        const d = new Date();
        d.setMonth(d.getMonth() - i);
        monthKeys.push(d.toISOString().substring(0, 7));
      }

      // 3. Calculate FCR
      const computedFCR = monthKeys.map(month => {
        const feedSum = (feedingLogs || [])
          .filter(log => log.time && log.time.startsWith(month))
          .reduce((sum, log) => sum + (Number(log.amount_kg) || 0), 0);
        const gainSum = (growthRecords || [])
          .filter(rec => rec.date && rec.date.startsWith(month))
          .reduce((sum, rec) => sum + (Number(rec.gain) || 0), 0);
        
        let fcr = 0;
        if (gainSum > 0) fcr = (feedSum / gainSum).toFixed(2);
        else if (feedSum > 0) fcr = feedSum.toFixed(2); // If they ate but didn't grow, FCR is bad
        
        // Month abbreviation formatting (e.g., 'May', 'Jun')
        const monthLabel = new Date(month + '-01').toLocaleString('default', { month: 'short' });
        return { month: monthLabel, fcr };
      });
      setFcrRaw(computedFCR);

      // 4. Calculate Growth Trend
      const computedGrowth = monthKeys.map(month => {
        const records = (growthRecords || []).filter(rec => rec.date && rec.date.startsWith(month) && Number(rec.gain) > 0);
        const avg = records.length > 0 
          ? (records.reduce((s, r) => s + Number(r.gain), 0) / records.length).toFixed(1)
          : 0;
        const monthLabel = new Date(month + '-01').toLocaleString('default', { month: 'short' });
        return { week_label: monthLabel, avg_gain: avg };
      });
      setGrowthRaw(computedGrowth);

      // 5 & 6. Calculate User Progress & Compliance from Caretaker Data
      const userProgressMap = {};
      const profileRoleMap = {};
      const currentFarmId = getActiveFarm();

      (profilesData || []).forEach(p => {
        if (p.username && p.role) {
          profileRoleMap[p.username] = p.role;
        }
      });
      
      // Initialize with staff belonging to this specific farm so those with 0 actions still show up
      (profilesData || []).forEach(p => {
        // Strictly require the profile to belong to the current farm.
        // For Owners, their farm_id matches the active farm.
        // For Caretakers, their supervisor_id matches the active farm owner's id.
        const belongsToFarm = (p.farm_id === currentFarmId) || (p.supervisor_id === currentFarmId);
        if (!belongsToFarm) return;
        
        if (p.username && (p.role.includes('Caretaker') || p.role.includes('Owner'))) {
          userProgressMap[p.username] = {
            username: p.username,
            role: p.role,
            total_actions: 0,
            feed_actions: 0,
            health_actions: 0,
            growth_actions: 0,
            pig_actions: 0
          };
        }
      });

      (notifications || []).forEach(n => {
        if (!n.actor_name || n.actor_name === 'System' || n.actor_name === 'Admin') return;
        
        if (!userProgressMap[n.actor_name]) {
          userProgressMap[n.actor_name] = {
            username: n.actor_name,
            role: profileRoleMap[n.actor_name] || 'Farm Staff',
            total_actions: 0,
            feed_actions: 0,
            health_actions: 0,
            growth_actions: 0,
            pig_actions: 0
          };
        }
        const u = userProgressMap[n.actor_name];
        u.total_actions++;
        
        if (n.type.includes('feed') || n.type.includes('stock')) u.feed_actions++;
        else if (n.type.includes('health') || n.type.includes('vaccin') || n.type.includes('treat')) u.health_actions++;
        else if (n.type.includes('growth') || n.type.includes('mortal')) u.growth_actions++;
        else u.pig_actions++;
      });

      const userProgressData = Object.values(userProgressMap);
      setUserProgressRaw(userProgressData);

      // Calculate true compliance percentages based on the caretakers' actual logged actions
      let staffFeed = 0, staffHealth = 0, staffGrowth = 0, staffPigs = 0;
      userProgressData.forEach(u => {
        staffFeed += u.feed_actions;
        staffHealth += u.health_actions;
        staffGrowth += u.growth_actions;
        staffPigs += u.pig_actions;
      });

      // Target baselines (simplified heuristic based on herd size)
      const expectedFeed = Math.max(10, activePigs.length * 2);
      const expectedHealth = Math.max(5, activePigs.length * 0.5);
      const expectedGrowth = Math.max(5, activePigs.length * 0.2);
      const expectedPigs = Math.max(5, userProgressData.length * 3);

      setComplianceRaw([
        { label: 'Feeding Routine', percentage: Math.min(100, Math.round((staffFeed / expectedFeed) * 100) || 0) },
        { label: 'Health Checks', percentage: Math.min(100, Math.round((staffHealth / expectedHealth) * 100) || 0) },
        { label: 'Growth Tracking', percentage: Math.min(100, Math.round((staffGrowth / expectedGrowth) * 100) || 0) },
        { label: 'Pig & Inventory Mgmt', percentage: Math.min(100, Math.round((staffPigs / expectedPigs) * 100) || 0) }
      ]);

      // User Progress was calculated above.

    } catch (error) {
      console.error('Error fetching analytics:', error);
    } finally {
      setLoading(false);
    }
  }

  // Map data, fallback to placeholder labels if empty
  const fcrLabels = fcrRaw.length > 0 ? fcrRaw.map(r => r.month) : ['No Data'];
  const fcrValues = fcrRaw.length > 0 ? fcrRaw.map(r => r.fcr) : [0];

  const compLabels = complianceRaw.length > 0 ? complianceRaw.map(r => r.label) : ['No Data'];
  const compValues = complianceRaw.length > 0 ? complianceRaw.map(r => r.percentage) : [0];

  const growthLabels = growthRaw.length > 0 ? growthRaw.map(r => r.week_label) : ['No Data'];
  const growthValues = growthRaw.length > 0 ? growthRaw.map(r => r.avg_gain) : [0];

  // --- Compute Dynamic Badge Values ---
  const currentFcr = fcrRaw.length > 0 ? Number(fcrRaw[fcrRaw.length - 1].fcr).toFixed(1) : 'N/A';
  
  let overallCompliance = 'N/A';
  if (complianceRaw.length > 0) {
    const sum = complianceRaw.reduce((acc, curr) => acc + Number(curr.percentage), 0);
    overallCompliance = Math.round(sum / complianceRaw.length) + '%';
  }

  let growthTrendStr = 'N/A';
  if (growthRaw.length >= 2) {
    const latest = Number(growthRaw[growthRaw.length - 1].avg_gain);
    const prev = Number(growthRaw[growthRaw.length - 2].avg_gain);
    if (prev > 0) {
      const diff = Math.round(((latest - prev) / prev) * 100);
      growthTrendStr = diff > 0 ? `Up ${diff}%` : (diff < 0 ? `Down ${Math.abs(diff)}%` : 'Stable');
    } else {
      growthTrendStr = `+${latest}kg`;
    }
  } else if (growthRaw.length === 1) {
    growthTrendStr = `+${growthRaw[0].avg_gain}kg`;
  }
  // ------------------------------------

  const fcrData = {
    labels: fcrLabels,
    datasets: [{
      label: 'FCR (Lower is Better)',
      data: fcrValues,
      borderColor: '#f97316',
      backgroundColor: 'rgba(249, 115, 22, 0.1)',
      fill: true,
      tension: 0.4,
      pointBackgroundColor: '#f97316',
      pointBorderColor: 'white',
      pointBorderWidth: 2,
      pointRadius: 5,
    }]
  };

  const complianceData = {
    labels: compLabels,
    datasets: [{
      label: 'Completion %',
      data: compValues,
      backgroundColor: 'rgba(16, 185, 129, 0.2)',
      borderColor: '#10b981',
      pointBackgroundColor: '#10b981',
      pointBorderColor: 'white',
      pointHoverBackgroundColor: 'white',
      pointHoverBorderColor: '#10b981'
    }]
  };

  const growthData = {
    labels: growthLabels,
    datasets: [{
      label: 'Avg Weight Gain (kg)',
      data: growthValues,
      backgroundColor: 'rgba(59, 130, 246, 0.8)',
      borderRadius: 6,
    }]
  };

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        labels: {
          font: { family: 'Inter', size: 13 }
        }
      },
      tooltip: {
        backgroundColor: '#1f2937',
        padding: 12,
        titleFont: { family: 'Inter', size: 14, weight: 'bold' },
        bodyFont: { family: 'Inter', size: 13 },
        cornerRadius: 8,
      }
    }
  };

  const handleDownload = () => {
    Swal.fire({
      title: 'Preparing Report',
      text: 'Gathering analytics data for download...',
      timer: 1500,
      showConfirmButton: false,
      didOpen: () => {
        Swal.showLoading();
      }
    }).then(async () => {
      await addNotification('Report Downloaded', `Analytics Pro report was downloaded/printed by ${profile?.username || 'a user'}`, 'system');
      window.print();
    });
  };

  return (
    <div style={{ maxWidth: 1280, margin: '0 auto', padding: '0 16px', paddingBottom: 40 }}>
      {loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '100px 0', color: '#6b7280' }}>
          <i className="fas fa-circle-notch fa-spin" style={{ fontSize: 40, color: '#3b82f6', marginBottom: 16 }}></i>
          <p style={{ fontSize: 18, fontWeight: 600 }}>Analyzing Farm Data...</p>
        </div>
      ) : (
        <>
          {/* Header section with explanation */}
      <div style={{ 
        background: 'linear-gradient(135deg, #1e3a8a, #3b82f6)', 
        color: 'white', 
        padding: '32px 24px', 
        borderRadius: 20, 
        marginBottom: 24, 
        boxShadow: '0 10px 25px -5px rgba(59, 130, 246, 0.4)',
        position: 'relative',
        overflow: 'hidden'
      }}>
        <div style={{ position: 'relative', zIndex: 2 }}>
          <h2 style={{ fontSize: 28, fontWeight: 900, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ background: 'rgba(255,255,255,0.2)', width: 48, height: 48, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 14 }}>
              <i className="fas fa-chart-line" style={{ fontSize: 24 }}></i>
            </div>
            Analytics Pro
          </h2>
          <p style={{ fontSize: 16, opacity: 0.9, lineHeight: 1.6, maxWidth: 800, margin: 0 }}>
            Welcome to your advanced farm analytics. This dashboard translates your complex farm data into easy-to-understand metrics. <strong>Use these insights to optimize feed costs, monitor staff performance, and improve overall farm profitability.</strong>
          </p>
        </div>
        <i className="fas fa-chart-pie" style={{ position: 'absolute', right: -20, bottom: -40, fontSize: 180, opacity: 0.1, zIndex: 1, transform: 'rotate(-15deg)' }}></i>
      </div>

      {/* Quick Stats Overview */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 220px), 1fr))', gap: 16, marginBottom: 24 }}>
        <div style={{ background: 'white', padding: 20, borderRadius: 16, border: '1px solid #e5e7eb', display: 'flex', alignItems: 'center', gap: 16, boxShadow: '0 2px 4px rgba(0,0,0,0.02)' }}>
           <div style={{ background: '#e0e7ff', padding: 14, borderRadius: 12, color: '#4f46e5', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <i className="fas fa-piggy-bank" style={{ fontSize: 24 }}></i>
           </div>
           <div>
             <div style={{ color: '#6b7280', fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>Active Pigs</div>
             <div style={{ color: '#1f2937', fontSize: 26, fontWeight: 900 }}>{quickStats.activePigs.toLocaleString()}</div>
           </div>
        </div>
        <div style={{ background: 'white', padding: 20, borderRadius: 16, border: '1px solid #e5e7eb', display: 'flex', alignItems: 'center', gap: 16, boxShadow: '0 2px 4px rgba(0,0,0,0.02)' }}>
           <div style={{ background: '#fce7f3', padding: 14, borderRadius: 12, color: '#db2777', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <i className="fas fa-heartbeat" style={{ fontSize: 24 }}></i>
           </div>
           <div>
             <div style={{ color: '#6b7280', fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>Health Score</div>
             <div style={{ color: '#1f2937', fontSize: 26, fontWeight: 900 }}>{quickStats.healthScore}%</div>
           </div>
        </div>
        <div style={{ background: 'white', padding: 20, borderRadius: 16, border: '1px solid #e5e7eb', display: 'flex', alignItems: 'center', gap: 16, boxShadow: '0 2px 4px rgba(0,0,0,0.02)' }}>
           <div style={{ background: '#dcfce7', padding: 14, borderRadius: 12, color: '#16a34a', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <i className="fas fa-seedling" style={{ fontSize: 24 }}></i>
           </div>
           <div>
             <div style={{ color: '#6b7280', fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>Feed Status</div>
             <div style={{ color: '#1f2937', fontSize: 22, fontWeight: 900 }}>{quickStats.feedStatus}</div>
           </div>
        </div>
        <div style={{ background: 'white', padding: 20, borderRadius: 16, border: '1px solid #e5e7eb', display: 'flex', alignItems: 'center', gap: 16, boxShadow: '0 2px 4px rgba(0,0,0,0.02)' }}>
           <div style={{ background: '#fef9c3', padding: 14, borderRadius: 12, color: '#ca8a04', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <i className="fas fa-exclamation-triangle" style={{ fontSize: 24 }}></i>
           </div>
           <div>
             <div style={{ color: '#6b7280', fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>Alerts</div>
             <div style={{ color: '#1f2937', fontSize: 26, fontWeight: 900 }}>{quickStats.alerts}</div>
           </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 450px), 1fr))', gap: 24, marginBottom: 24 }}>
        
        {/* FCR Chart Card */}
        <div className="card" style={{ padding: 0, borderRadius: 20, borderTop: '4px solid #f97316', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: 24, flex: 1 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
              <div>
                <h3 style={{ fontSize: 20, fontWeight: 800, color: '#1f2937', marginBottom: 4 }}>Feed Conversion Ratio (FCR)</h3>
                <p style={{ color: '#6b7280', fontSize: 14, margin: 0 }}>Measures how efficiently pigs turn feed into meat.</p>
              </div>
              <div style={{ background: '#fff7ed', color: '#c2410c', padding: '6px 14px', borderRadius: 20, fontSize: 13, fontWeight: 800, boxShadow: '0 2px 4px rgba(249,115,22,0.1)' }}>
                Current: {currentFcr}
              </div>
            </div>
            
            <div style={{ background: '#f9fafb', borderLeft: '4px solid #f97316', padding: 16, borderRadius: '0 12px 12px 0', marginBottom: 20, fontSize: 14, color: '#4b5563', lineHeight: 1.6 }}>
              <strong>💡 How to use this chart:</strong> FCR shows how many kg of feed it takes to produce 1 kg of meat. 
              A <strong>lower</strong> number is better! If the orange line goes <strong>up</strong>, your pigs are eating more but gaining less weight—check for illness, bad feed quality, or feed wastage immediately.
            </div>
            
            <div style={{ height: 280, position: 'relative' }}>
              <Line data={fcrData} options={{ ...chartOptions, plugins: { ...chartOptions.plugins, legend: { display: false } } }} />
            </div>
          </div>
        </div>

        {/* Compliance Radar Card */}
        <div className="card" style={{ padding: 0, borderRadius: 20, borderTop: '4px solid #10b981', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: 24, flex: 1 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
              <div>
                <h3 style={{ fontSize: 20, fontWeight: 800, color: '#1f2937', marginBottom: 4 }}>Staff Protocol Compliance</h3>
                <p style={{ color: '#6b7280', fontSize: 14, margin: 0 }}>Measures how reliably staff log required tasks.</p>
              </div>
              <div style={{ background: '#ecfdf5', color: '#047857', padding: '6px 14px', borderRadius: 20, fontSize: 13, fontWeight: 800, boxShadow: '0 2px 4px rgba(16,185,129,0.1)' }}>
                Overall: {overallCompliance}
              </div>
            </div>
            
            <div style={{ background: '#f9fafb', borderLeft: '4px solid #10b981', padding: 16, borderRadius: '0 12px 12px 0', marginBottom: 20, fontSize: 14, color: '#4b5563', lineHeight: 1.6 }}>
              <strong>💡 How to use this chart:</strong> This "radar" shape shows staff performance across different duties. 
              The closer the green shape is to the outer circle, the better. Look for "dents" pointing inwards (like <em>Treatments</em> at 85%) to identify where staff need more training or supervision.
            </div>
            
            <div style={{ height: 280, position: 'relative', display: 'flex', justifyContent: 'center' }}>
              <Radar data={complianceData} options={chartOptions} />
            </div>
          </div>
        </div>

        {/* Growth Bar Chart */}
        <div className="card" style={{ padding: 0, borderRadius: 20, borderTop: '4px solid #3b82f6', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: 24, flex: 1 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
              <div>
                <h3 style={{ fontSize: 20, fontWeight: 800, color: '#1f2937', marginBottom: 4 }}>Monthly Growth Trend</h3>
                <p style={{ color: '#6b7280', fontSize: 14, margin: 0 }}>Average weight gain across all active batches.</p>
              </div>
              <div style={{ background: '#eff6ff', color: '#1d4ed8', padding: '6px 14px', borderRadius: 20, fontSize: 13, fontWeight: 800, boxShadow: '0 2px 4px rgba(59,130,246,0.1)' }}>
                {growthTrendStr}
              </div>
            </div>
            
            <div style={{ background: '#f9fafb', borderLeft: '4px solid #3b82f6', padding: 16, borderRadius: '0 12px 12px 0', marginBottom: 20, fontSize: 14, color: '#4b5563', lineHeight: 1.6 }}>
              <strong>💡 How to use this chart:</strong> Consistent upward bars mean your pigs are growing on schedule. Sudden drops might indicate a problem with feed nutrition or disease outbreak in a specific batch.
            </div>
            
            <div style={{ height: 280, position: 'relative' }}>
              <Bar data={growthData} options={{ ...chartOptions, plugins: { ...chartOptions.plugins, legend: { display: false } } }} />
            </div>
          </div>
        </div>
      </div>

      {/* Actionable Insights Section */}
      <div className="card" style={{ padding: 24, borderRadius: 20, marginBottom: 24 }}>
        <h3 style={{ fontSize: 20, fontWeight: 800, color: '#1f2937', marginBottom: 20, display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ background: '#fef3c7', width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 10 }}>
            <i className="fas fa-lightbulb" style={{ color: '#d97706', fontSize: 18 }}></i>
          </div>
          AI Actionable Insights
        </h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))', gap: 16 }}>
          <div style={{ padding: 20, border: '1px solid #e5e7eb', borderRadius: 16, background: 'white', transition: 'box-shadow 0.2s' }} className="card-hover">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, color: '#059669', fontSize: 16, fontWeight: 800 }}>
              <i className="fas fa-arrow-trend-down" style={{ background: '#d1fae5', padding: 8, borderRadius: 8 }}></i> FCR is improving
            </div>
            <p style={{ fontSize: 14, color: '#4b5563', margin: 0, lineHeight: 1.5 }}>
              Your feed efficiency has improved by 11% since January. <strong>Action:</strong> Continue using the current grower feed formula, as it is yielding excellent meat-to-feed results.
            </p>
          </div>
          <div style={{ padding: 20, border: '1px solid #e5e7eb', borderRadius: 16, background: 'white', transition: 'box-shadow 0.2s' }} className="card-hover">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, color: '#dc2626', fontSize: 16, fontWeight: 800 }}>
              <i className="fas fa-exclamation-circle" style={{ background: '#fee2e2', padding: 8, borderRadius: 8 }}></i> Treatment Logs Lagging
            </div>
            <p style={{ fontSize: 14, color: '#4b5563', margin: 0, lineHeight: 1.5 }}>
              Treatment compliance is "dented" at 85%. <strong>Action:</strong> Remind your health staff to log medications immediately in the <em>Health Watch</em> module after administering to avoid missed doses.
            </p>
          </div>
          <div style={{ padding: 20, border: '1px solid #e5e7eb', borderRadius: 16, background: 'white', transition: 'box-shadow 0.2s' }} className="card-hover">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, color: '#2563eb', fontSize: 16, fontWeight: 800 }}>
              <i className="fas fa-venus-mars" style={{ background: '#dbeafe', padding: 8, borderRadius: 8 }}></i> Strong Breeding Success
            </div>
            <p style={{ fontSize: 14, color: '#4b5563', margin: 0, lineHeight: 1.5 }}>
              Current conception rate is steady at 84%. <strong>Action:</strong> Excellent work. Keep following the alerts in the <em>Breeding Manager</em> to maintain this high productivity.
            </p>
          </div>
        </div>
      </div>

      {/* Caretaker Progress Section */}
      <div style={{ marginBottom: 24 }}>
        {/* Section Header */}
        <div style={{
          background: 'linear-gradient(135deg, #4c1d95, #7c3aed)',
          borderRadius: 20,
          padding: '24px 28px',
          marginBottom: 20,
          position: 'relative',
          overflow: 'hidden',
          boxShadow: '0 10px 25px -5px rgba(124, 58, 237, 0.3)'
        }}>
          <div style={{ position: 'relative', zIndex: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
            <div>
              <h3 style={{ fontSize: 22, fontWeight: 900, color: 'white', margin: '0 0 6px 0', display: 'flex', alignItems: 'center', gap: 10 }}>
                <i className="fas fa-users-cog" style={{ fontSize: 20 }}></i>
                Staff Activity Report
              </h3>
              <p style={{ color: 'rgba(255,255,255,0.8)', fontSize: 14, margin: 0 }}>
                Real-time breakdown of activity and task completion for Caretakers and Farm Owners.
              </p>
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <div style={{ background: 'rgba(255,255,255,0.15)', borderRadius: 12, padding: '8px 16px', color: 'white', fontSize: 13, fontWeight: 700, backdropFilter: 'blur(8px)' }}>
                <i className="fas fa-users" style={{ marginRight: 6 }}></i>
                {userProgressRaw.length} Staff
              </div>
            </div>
          </div>
          <i className="fas fa-chart-bar" style={{ position: 'absolute', right: -10, bottom: -30, fontSize: 140, opacity: 0.08, zIndex: 1, transform: 'rotate(-10deg)' }}></i>
        </div>

        {userProgressRaw.length === 0 ? (
          <div style={{ padding: '60px 20px', textAlign: 'center', color: '#6b7280', background: '#f9fafb', borderRadius: 16, border: '2px dashed #d1d5db' }}>
            <i className="fas fa-user-clock" style={{ fontSize: 40, color: '#9ca3af', marginBottom: 16, display: 'block' }}></i>
            <p style={{ fontSize: 16, fontWeight: 600, margin: '0 0 6px 0', color: '#374151' }}>No Activity Logged Yet</p>
            <p style={{ fontSize: 14, margin: 0 }}>Staff actions from Feeding, Health, and Growth modules will appear here.</p>
          </div>
        ) : (() => {
          const sorted = [...userProgressRaw].sort((a, b) => b.total_actions - a.total_actions);
          const maxActions = Math.max(...sorted.map(u => u.total_actions), 1);
          
          const caretakers = sorted.filter(u => u.role.includes('Caretaker'));
          const ownersAndOthers = sorted.filter(u => !u.role.includes('Caretaker'));

          const CATEGORIES = [
            { key: 'pig_actions',    label: 'Pig Mgmt',  color: '#8b5cf6', bg: '#ede9fe', icon: 'fas fa-piggy-bank' },
            { key: 'feed_actions',   label: 'Feeding',   color: '#10b981', bg: '#d1fae5', icon: 'fas fa-seedling' },
            { key: 'health_actions', label: 'Health',    color: '#ef4444', bg: '#fee2e2', icon: 'fas fa-heartbeat' },
            { key: 'growth_actions', label: 'Growth',    color: '#3b82f6', bg: '#dbeafe', icon: 'fas fa-chart-line' },
          ];

          const getBadge = (score, max) => {
            const pct = max > 0 ? score / max : 0;
            if (pct >= 0.8) return { label: '🏆 Excellent',      bg: '#d1fae5', color: '#065f46' };
            if (pct >= 0.5) return { label: '👍 Good',           bg: '#dbeafe', color: '#1e40af' };
            if (pct >= 0.2) return { label: '⚠️ Needs Attention', bg: '#fef9c3', color: '#92400e' };
            return               { label: '🔴 Inactive',         bg: '#fee2e2', color: '#991b1b' };
          };

          const rankColors = ['#f59e0b', '#94a3b8', '#d97706'];

          const renderUserCard = (user, idx) => {
            const badge   = getBadge(user.total_actions, maxActions);
            const scorePct = Math.round((user.total_actions / maxActions) * 100);
            const isCaretaker = user.role.includes('Caretaker');

            return (
              <div key={user.username || idx} style={{
                background: 'white',
                borderRadius: 18,
                border: `1.5px solid ${isCaretaker ? '#a78bfa' : '#60a5fa'}`,
                boxShadow: isCaretaker
                  ? '0 4px 20px -4px rgba(124,58,237,0.15)'
                  : '0 4px 20px -4px rgba(59,130,246,0.15)',
                overflow: 'hidden',
                transition: 'transform 0.2s, box-shadow 0.2s',
              }}
                onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = isCaretaker ? '0 8px 24px -4px rgba(124,58,237,0.2)' : '0 8px 24px -4px rgba(59,130,246,0.2)'; }}
                onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)';  e.currentTarget.style.boxShadow = isCaretaker ? '0 4px 20px -4px rgba(124,58,237,0.15)' : '0 4px 20px -4px rgba(59,130,246,0.15)'; }}
              >
                {/* Card Top */}
                <div style={{ background: isCaretaker ? 'linear-gradient(135deg,#f5f3ff,#ede9fe)' : 'linear-gradient(135deg,#eff6ff,#dbeafe)', padding: '18px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    {/* Rank badge */}
                    <div style={{ position: 'relative' }}>
                      <div style={{
                        width: 46, height: 46, borderRadius: '50%',
                        background: idx < 3 ? rankColors[idx] : (isCaretaker ? '#8b5cf6' : '#3b82f6'),
                        color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontWeight: 900, fontSize: 18, boxShadow: '0 2px 8px rgba(0,0,0,0.2)'
                      }}>
                        {user.username ? user.username.charAt(0).toUpperCase() : '?'}
                      </div>
                      {idx < 3 && (
                        <div style={{
                          position: 'absolute', bottom: -4, right: -4,
                          background: rankColors[idx], color: 'white',
                          width: 18, height: 18, borderRadius: '50%',
                          fontSize: 9, fontWeight: 900, display: 'flex', alignItems: 'center', justifyContent: 'center',
                          border: '2px solid white'
                        }}>#{idx + 1}</div>
                      )}
                    </div>
                    <div>
                      <div style={{ fontWeight: 800, color: '#1f2937', fontSize: 15 }}>{user.username || 'Unknown'}</div>
                      <div style={{ fontSize: 12, color: '#6b7280', display: 'flex', alignItems: 'center', gap: 4 }}>
                        <i className={`fas ${isCaretaker ? 'fa-star' : 'fa-crown'}`} style={{ color: isCaretaker ? '#a78bfa' : '#60a5fa', fontSize: 10 }}></i>
                        {user.role}
                      </div>
                    </div>
                  </div>
                  <span style={{ background: badge.bg, color: badge.color, padding: '5px 12px', borderRadius: 999, fontSize: 12, fontWeight: 800 }}>
                    {badge.label}
                  </span>
                </div>

                {/* Overall Progress Bar */}
                <div style={{ padding: '14px 20px 6px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5 }}>Overall Activity Score</span>
                    <span style={{ fontSize: 14, fontWeight: 900, color: isCaretaker ? '#7c3aed' : '#2563eb' }}>{scorePct}%</span>
                  </div>
                  <div style={{ background: isCaretaker ? '#ede9fe' : '#dbeafe', borderRadius: 999, height: 10, overflow: 'hidden' }}>
                    <div style={{
                      width: `${scorePct}%`, height: '100%', borderRadius: 999,
                      background: isCaretaker ? 'linear-gradient(90deg, #8b5cf6, #6d28d9)' : 'linear-gradient(90deg, #3b82f6, #1d4ed8)',
                      transition: 'width 0.6s ease',
                      boxShadow: isCaretaker ? '0 0 8px rgba(139,92,246,0.4)' : '0 0 8px rgba(59,130,246,0.4)'
                    }} />
                  </div>
                  <div style={{ textAlign: 'right', fontSize: 12, color: '#9ca3af', marginTop: 4 }}>
                    {user.total_actions} total actions
                  </div>
                </div>

                {/* Category Pills */}
                <div style={{ padding: '10px 20px 20px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  {CATEGORIES.map(cat => {
                    const val    = Number(user[cat.key]) || 0;
                    const catMax = Math.max(...sorted.map(u => Number(u[cat.key]) || 0), 1);
                    const pct    = Math.round((val / catMax) * 100);
                    return (
                      <div key={cat.key} style={{ background: cat.bg, borderRadius: 12, padding: '10px 12px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 700, color: cat.color }}>
                            <i className={cat.icon} style={{ fontSize: 11 }}></i>
                            {cat.label}
                          </div>
                          <span style={{ fontSize: 13, fontWeight: 900, color: cat.color }}>{val}</span>
                        </div>
                        <div style={{ background: 'rgba(255,255,255,0.6)', borderRadius: 999, height: 5 }}>
                          <div style={{ width: `${pct}%`, height: '100%', borderRadius: 999, background: cat.color }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          };

          return (
            <div>
              {caretakers.length > 0 && (
                <div style={{ marginBottom: 32 }}>
                  <h4 style={{ fontSize: 16, fontWeight: 800, color: '#4b5563', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <i className="fas fa-user-friends" style={{ color: '#8b5cf6' }}></i>
                    Farm Caretakers
                  </h4>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 360px), 1fr))', gap: 16 }}>
                    {caretakers.map((user, idx) => renderUserCard(user, idx))}
                  </div>
                </div>
              )}
              
              {ownersAndOthers.length > 0 && (
                <div>
                  <h4 style={{ fontSize: 16, fontWeight: 800, color: '#4b5563', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <i className="fas fa-crown" style={{ color: '#3b82f6' }}></i>
                    Farm Owners & Management
                  </h4>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 360px), 1fr))', gap: 16 }}>
                    {ownersAndOthers.map((user, idx) => renderUserCard(user, idx + caretakers.length))}
                  </div>
                </div>
              )}
            </div>
          );
        })()}
      </div>

      {/* Export Section */}
      <div className="card" style={{ padding: '24px 32px', borderRadius: 20, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 20, background: 'linear-gradient(to right, #ffffff, #f8fafc)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{ background: '#f3f4f6', width: 48, height: 48, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 12 }}>
            <i className="fas fa-file-export" style={{ fontSize: 20, color: '#4b5563' }}></i>
          </div>
          <div>
            <h4 style={{ fontSize: 18, fontWeight: 800, margin: 0, color: '#1f2937' }}>Export Monthly Summary</h4>
            <p style={{ margin: '4px 0 0 0', color: '#6b7280', fontSize: 14 }}>Generate a comprehensive, easy-to-read PDF report of all metrics to share with investors or partners.</p>
          </div>
        </div>
        <button 
          className="btn-primary" 
          onClick={handleDownload}
          style={{ 
            display: 'flex', alignItems: 'center', gap: 8, padding: '12px 24px', 
            fontSize: 15, borderRadius: 12, 
            cursor: 'pointer' 
          }}
        >
          <i className="fas fa-download"></i> Download Full Report (PDF)
        </button>
      </div>
        </>
      )}
    </div>
  );
}