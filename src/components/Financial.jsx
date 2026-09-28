import { useEffect, useState } from 'react';
import { dataAPI, getSingletonInventory } from '../lib/data';
import { Doughnut, Bar } from 'react-chartjs-2';
import { Chart as ChartJS, ArcElement, Tooltip, Legend, CategoryScale, LinearScale, BarElement } from 'chart.js';
import Swal from 'sweetalert2';
import { isOnline, syncAll, getPendingCount } from '../lib/sync';

ChartJS.register(ArcElement, Tooltip, Legend, CategoryScale, LinearScale, BarElement);

export default function Financial() {
  const [transactions, setTransactions] = useState([]);
  const [totalExp, setTotalExp] = useState(0);
  const [totalRev, setTotalRev] = useState(0);
  
  // Extra metrics
  const [feedInventory, setFeedInventory] = useState(0);
  const [production, setProduction] = useState({ bornAlive: 0, deadFarrowed: 0, weaned: 0, mortality: 0, avgGain: 0 });

  const [online, setOnline] = useState(isOnline());
  const [syncing, setSyncing] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);

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
    try { setPendingCount(await getPendingCount()); } catch (e) { /* ignore */ }
  }

  useEffect(() => {
    loadData();
    window.addEventListener('refreshAllData', loadData);
    return () => {
      window.removeEventListener('refreshAllData', loadData);
    };
  }, []);

  async function loadData() {
    try {
      const data = await dataAPI.financial_transactions.getAll();
      setTransactions(data || []);
      const exp = data?.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0) || 0;
      const rev = data?.filter(t => t.type === 'revenue').reduce((s, t) => s + t.amount, 0) || 0;
      setTotalExp(exp);
      setTotalRev(rev);

      // Inventory
      let inventory = await getSingletonInventory();
      if (!inventory) {
        const invData = await dataAPI.inventory.getAll();
        inventory = invData && invData.length > 0 ? invData[0] : null;
      }
      setFeedInventory(inventory?.feed_stock_kg || 0);

      // Production Metrics
      const farrData = await dataAPI.farrowings.getAll() || [];
      const bornAlive = farrData.reduce((s, f) => s + (parseInt(f.alive_piglets) || 0), 0);
      const deadFarr = farrData.reduce((s, f) => s + (parseInt(f.stillborn) || 0) + (parseInt(f.mummies) || 0), 0);

      const weanData = await dataAPI.weanings.getAll() || [];
      const weaned = weanData.reduce((s, w) => s + (parseInt(w.weaned_count) || 0), 0);

      const mortData = await dataAPI.mortality_records.getAll() || [];
      const mortality = mortData.length;

      const growthData = await dataAPI.growth_records.getAll() || [];
      let avgGain = 0;
      if (growthData.length > 0) {
        avgGain = growthData.reduce((s, g) => s + (parseFloat(g.weight_kg) || 0), 0) / growthData.length; // Simplified avg
      }

      setProduction({ bornAlive, deadFarrowed: deadFarr, weaned, mortality, avgGain });
    } catch (err) {
      console.error("Error loading financial dashboard data", err);
    }
  }

  async function addTransaction() {
    const { value: formValues } = await Swal.fire({
      title: 'Add Transaction',
      html: `
        <style>
          .tx-form { text-align: left; max-width: 400px; margin: 0 auto; }
          .tx-form .field { margin-bottom: 16px; }
          .tx-form .field label { display: block; font-weight: 600; color: #374151; font-size: 14px; margin-bottom: 4px; }
          .tx-form .field input, .tx-form .field select, .tx-form .field textarea { width: 100%; padding: 10px; border: 1px solid #d1d5db; border-radius: 8px; }
        </style>
        <div class="tx-form">
          <div class="field">
            <label>Type *</label>
            <select id="tx-type" onchange="
              const cat = document.getElementById('tx-category');
              if(this.value === 'expense') {
                cat.innerHTML = '<option value=\\'Feed Costs\\'>Feed Costs</option><option value=\\'Stock Purchases\\'>Stock Purchases</option><option value=\\'Veterinary & Health\\'>Veterinary & Health</option><option value=\\'Utilities & Maintenance\\'>Utilities & Maintenance</option><option value=\\'Labor & Transport\\'>Labor & Transport</option>';
              } else {
                cat.innerHTML = '<option value=\\'Fatteners\\'>Fatteners</option><option value=\\'Breeding Stock\\'>Breeding Stock</option><option value=\\'Byproducts\\'>Byproducts</option>';
              }
            ">
              <option value="expense">Expense</option>
              <option value="revenue">Revenue</option>
            </select>
          </div>
          <div class="field">
            <label>Category *</label>
            <select id="tx-category">
              <option value="Feed Costs">Feed Costs</option>
              <option value="Stock Purchases">Stock Purchases</option>
              <option value="Veterinary & Health">Veterinary & Health</option>
              <option value="Utilities & Maintenance">Utilities & Maintenance</option>
              <option value="Labor & Transport">Labor & Transport</option>
            </select>
          </div>
          <div class="field">
            <label>Amount (₱) *</label>
            <input id="tx-amount" type="number" step="0.01" min="0.01" placeholder="0.00" />
          </div>
          <div class="field">
            <label>Date</label>
            <input id="tx-date" type="date" value="${new Date().toISOString().split('T')[0]}" />
          </div>
          <div class="field">
            <label>Description</label>
            <textarea id="tx-description" rows="2" placeholder="Optional notes..."></textarea>
          </div>
        </div>
      `,
      focusConfirm: false,
      showCancelButton: true,
      confirmButtonText: 'Save',
      preConfirm: () => {
        const type = document.getElementById('tx-type').value;
        const category = document.getElementById('tx-category').value;
        const amount = document.getElementById('tx-amount').value.trim();
        const date = document.getElementById('tx-date').value;
        const description = document.getElementById('tx-description').value.trim();
        if (!amount || isNaN(amount) || amount <= 0) return Swal.showValidationMessage('Valid amount required');
        return { type, category, amount: parseFloat(amount), date, description };
      }
    });

    if (!formValues) return;
    try {
      await dataAPI.financial_transactions.insert(formValues);
      Swal.fire('Success', 'Transaction added', 'success');
      loadData();
    } catch (err) {
      Swal.fire('Error', err.message, 'error');
    }
  }

  const net = totalRev - totalExp;

  const expensesByCategory = transactions.filter(t => t.type === 'expense').reduce((acc, t) => {
    acc[t.category] = (acc[t.category] || 0) + t.amount;
    return acc;
  }, {});
  
  const revenueByCategory = transactions.filter(t => t.type === 'revenue').reduce((acc, t) => {
    acc[t.category] = (acc[t.category] || 0) + t.amount;
    return acc;
  }, {});

  const expChartData = {
    labels: Object.keys(expensesByCategory),
    datasets: [{ data: Object.values(expensesByCategory), backgroundColor: ['#f87171', '#fb923c', '#facc15', '#a3e635', '#2dd4bf'] }]
  };

  const revChartData = {
    labels: Object.keys(revenueByCategory),
    datasets: [{ data: Object.values(revenueByCategory), backgroundColor: ['#34d399', '#3b82f6', '#818cf8'] }]
  };

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 24, paddingBottom: 40 }}>
      {/* Offline/Syncing Banners */}
      {!online && (
        <div style={{ background: '#fef3c7', border: '1px solid #f59e0b', borderRadius: 12, padding: '12px 16px', display: 'flex', gap: 12 }}>
          <i className="fas fa-wifi-slash" style={{ color: '#b45309', marginTop: 3 }}></i>
          <div><strong style={{ color: '#78350f' }}>Offline Mode</strong><p style={{ margin: 0, fontSize: 13 }}>Changes saved locally.</p></div>
        </div>
      )}

      {/* 5. Profit/Loss Summary */}
      <div className="card" style={{ background: 'linear-gradient(135deg, #1e3a8a, #312e81)', color: 'white' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 16 }}>
          <div>
            <h2 style={{ margin: '0 0 8px 0', fontSize: 24, fontWeight: 700 }}><i className="fas fa-chart-line" style={{ marginRight: 8 }}></i> Financial Overview</h2>
            <p style={{ margin: 0, color: '#93c5fd' }}>Net Profit = Total Sales - Total Expenses</p>
          </div>
          <button onClick={addTransaction} style={{ background: '#10b981', color: 'white', border: 'none', padding: '10px 20px', borderRadius: 8, fontWeight: 'bold', cursor: 'pointer', boxShadow: '0 4px 6px rgba(0,0,0,0.1)' }}>
            + Add Transaction
          </button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16, marginTop: 24 }}>
          <div style={{ background: 'rgba(255,255,255,0.1)', padding: 20, borderRadius: 12 }}>
            <div style={{ fontSize: 14, color: '#93c5fd', marginBottom: 4 }}>Total Revenue (Sales)</div>
            <div style={{ fontSize: 28, fontWeight: 'bold', color: '#6ee7b7' }}>₱{totalRev.toLocaleString(undefined, { minimumFractionDigits: 2 })}</div>
          </div>
          <div style={{ background: 'rgba(255,255,255,0.1)', padding: 20, borderRadius: 12 }}>
            <div style={{ fontSize: 14, color: '#93c5fd', marginBottom: 4 }}>Total Expenses</div>
            <div style={{ fontSize: 28, fontWeight: 'bold', color: '#fca5a5' }}>₱{totalExp.toLocaleString(undefined, { minimumFractionDigits: 2 })}</div>
          </div>
          <div style={{ background: 'rgba(255,255,255,0.15)', padding: 20, borderRadius: 12, borderLeft: `4px solid ${net >= 0 ? '#10b981' : '#ef4444'}` }}>
            <div style={{ fontSize: 14, color: '#93c5fd', marginBottom: 4 }}>Net Profit</div>
            <div style={{ fontSize: 32, fontWeight: 'bold', color: net >= 0 ? '#34d399' : '#f87171' }}>
              {net >= 0 ? '+' : ''}₱{net.toLocaleString(undefined, { minimumFractionDigits: 2 })}
            </div>
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 24 }}>
        {/* 1. Daily & Monthly Expenses */}
        <div className="card">
          <h3 style={{ borderBottom: '2px solid #f3f4f6', paddingBottom: 12, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
            <i className="fas fa-money-bill-wave" style={{ color: '#ef4444' }}></i> 1. Expenses Breakdown
          </h3>
          {Object.keys(expensesByCategory).length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
              <div style={{ width: '220px' }}>
                <Doughnut data={expChartData} options={{ plugins: { legend: { display: false } } }} />
              </div>
              <div style={{ width: '100%' }}>
                {Object.entries(expensesByCategory).map(([cat, amt], i) => (
                  <div key={cat} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #f3f4f6' }}>
                    <span style={{ color: '#4b5563' }}>{cat}</span>
                    <strong style={{ color: '#b91c1c' }}>₱{amt.toLocaleString(undefined, { minimumFractionDigits: 2 })}</strong>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <p style={{ color: '#9ca3af', textAlign: 'center', padding: '20px 0' }}>No expenses recorded.</p>
          )}
        </div>

        {/* 2. Revenue & Sales */}
        <div className="card">
          <h3 style={{ borderBottom: '2px solid #f3f4f6', paddingBottom: 12, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
            <i className="fas fa-hand-holding-usd" style={{ color: '#10b981' }}></i> 2. Revenue & Sales
          </h3>
          {Object.keys(revenueByCategory).length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
              <div style={{ width: '220px' }}>
                <Doughnut data={revChartData} options={{ plugins: { legend: { display: false } } }} />
              </div>
              <div style={{ width: '100%' }}>
                {Object.entries(revenueByCategory).map(([cat, amt], i) => (
                  <div key={cat} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #f3f4f6' }}>
                    <span style={{ color: '#4b5563' }}>{cat}</span>
                    <strong style={{ color: '#065f46' }}>₱{amt.toLocaleString(undefined, { minimumFractionDigits: 2 })}</strong>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <p style={{ color: '#9ca3af', textAlign: 'center', padding: '20px 0' }}>No revenue recorded.</p>
          )}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 24 }}>
        {/* 3. Inventory & Assets */}
        <div className="card">
          <h3 style={{ borderBottom: '2px solid #f3f4f6', paddingBottom: 12, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
            <i className="fas fa-boxes" style={{ color: '#8b5cf6' }}></i> 3. Inventory & Assets
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ background: '#f5f3ff', padding: 16, borderRadius: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontWeight: 'bold', color: '#5b21b6' }}>Feed Inventory</div>
                <div style={{ fontSize: 12, color: '#7c3aed' }}>Current stock level</div>
              </div>
              <div style={{ fontSize: 24, fontWeight: 'bold', color: '#6d28d9' }}>{feedInventory} kg</div>
            </div>
            <div style={{ background: '#f8fafc', padding: 16, borderRadius: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center', border: '1px dashed #cbd5e1' }}>
              <div>
                <div style={{ fontWeight: 'bold', color: '#475569' }}>Supplies & Meds</div>
                <div style={{ fontSize: 12, color: '#64748b' }}>Tracked in Inventory tab</div>
              </div>
              <i className="fas fa-pills" style={{ color: '#94a3b8', fontSize: 20 }}></i>
            </div>
          </div>
        </div>

        {/* 4. Production Metrics */}
        <div className="card">
          <h3 style={{ borderBottom: '2px solid #f3f4f6', paddingBottom: 12, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
            <i className="fas fa-piggy-bank" style={{ color: '#ec4899' }}></i> 4. Production Metrics
          </h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div style={{ background: '#fdf2f8', padding: 12, borderRadius: 8, textAlign: 'center' }}>
              <div style={{ fontSize: 12, color: '#db2777', fontWeight: 600 }}>Born Alive</div>
              <div style={{ fontSize: 24, fontWeight: 'bold', color: '#be185d' }}>{production.bornAlive}</div>
            </div>
            <div style={{ background: '#fdf2f8', padding: 12, borderRadius: 8, textAlign: 'center' }}>
              <div style={{ fontSize: 12, color: '#db2777', fontWeight: 600 }}>Dead/Mummies</div>
              <div style={{ fontSize: 24, fontWeight: 'bold', color: '#9d174d' }}>{production.deadFarrowed}</div>
            </div>
            <div style={{ background: '#fdf2f8', padding: 12, borderRadius: 8, textAlign: 'center' }}>
              <div style={{ fontSize: 12, color: '#db2777', fontWeight: 600 }}>Weaned</div>
              <div style={{ fontSize: 24, fontWeight: 'bold', color: '#be185d' }}>{production.weaned}</div>
            </div>
            <div style={{ background: '#fef2f2', padding: 12, borderRadius: 8, textAlign: 'center' }}>
              <div style={{ fontSize: 12, color: '#dc2626', fontWeight: 600 }}>Total Mortality</div>
              <div style={{ fontSize: 24, fontWeight: 'bold', color: '#b91c1c' }}>{production.mortality}</div>
            </div>
          </div>
        </div>
      </div>

      {/* 5. Recent Transactions */}
      <div className="card">
        <h3 style={{ borderBottom: '2px solid #f3f4f6', paddingBottom: 12, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
          <i className="fas fa-list" style={{ color: '#6b7280' }}></i> Recent Transactions
        </h3>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #e5e7eb', color: '#6b7280' }}>
                <th style={{ padding: '12px 8px' }}>Date</th>
                <th style={{ padding: '12px 8px' }}>Type</th>
                <th style={{ padding: '12px 8px' }}>Category</th>
                <th style={{ padding: '12px 8px' }}>Description</th>
                <th style={{ padding: '12px 8px', textAlign: 'right' }}>Amount</th>
              </tr>
            </thead>
            <tbody>
              {[...transactions].sort((a, b) => new Date(b.date || b.created_at || 0) - new Date(a.date || a.created_at || 0)).slice(0, 10).map((tx, idx) => (
                <tr key={tx.id || idx} style={{ borderBottom: '1px solid #f3f4f6' }}>
                  <td style={{ padding: '12px 8px' }}>{new Date(tx.date || tx.created_at).toLocaleDateString()}</td>
                  <td style={{ padding: '12px 8px' }}>
                    <span style={{
                      padding: '4px 8px', borderRadius: 999, fontSize: 12, fontWeight: 600,
                      backgroundColor: tx.type === 'revenue' ? '#d1fae5' : '#fee2e2',
                      color: tx.type === 'revenue' ? '#065f46' : '#991b1b'
                    }}>
                      {tx.type.charAt(0).toUpperCase() + tx.type.slice(1)}
                    </span>
                  </td>
                  <td style={{ padding: '12px 8px', color: '#374151' }}>{tx.category}</td>
                  <td style={{ padding: '12px 8px', color: '#6b7280' }}>{tx.description || '-'}</td>
                  <td style={{ padding: '12px 8px', textAlign: 'right', fontWeight: 'bold', color: tx.type === 'revenue' ? '#10b981' : '#ef4444' }}>
                    {tx.type === 'revenue' ? '+' : '-'}₱{tx.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </td>
                </tr>
              ))}
              {transactions.length === 0 && (
                <tr>
                  <td colSpan="5" style={{ padding: '24px', textAlign: 'center', color: '#9ca3af' }}>No transactions recorded yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <style>{`
        .card { background: white; border-radius: 16px; padding: 24px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1), 0 2px 4px -1px rgba(0,0,0,0.06); }
        h3 { margin-top: 0; }
      `}</style>
    </div>
  );
}