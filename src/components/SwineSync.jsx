import { useEffect, useState } from 'react';
import { dataAPI, getSingletonInventory } from '../lib/data';
import { addNotification as pushOwnerNotification } from '../lib/notifications';


export default function Dashboard({ profile }) {
  // View management
  const [currentView, setCurrentView] = useState('dashboard');
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

  // For mating planner
  const [pigsList, setPigsList] = useState([]); // sows only
  const [breedingsList, setBreedingsList] = useState([]);

  useEffect(() => {
    if (currentView === 'dashboard') loadDashboardData();
    if (currentView === 'matingPlanner') loadBreedingsAndPigs();
  }, [currentView]);

  // ==================== DATA FETCHING ====================
  async function loadDashboardData() {
    setLoading(true);
    try {
      const allPigs = await dataAPI.pigs.getAll();
      const pigCount = allPigs.length;

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
      farrowings = farrowings.map(f => ({ ...f, pigs: allPigs.find(p => p.id === f.pig_id) }));
      setUpcomingFarrowings(farrowings || []);

      setLastUpdated(new Date());
    } catch (error) {
      Swal.fire('Error', 'Failed to load dashboard data', 'error');
    } finally {
      setLoading(false);
    }
  }

  async function loadBreedingsAndPigs() {
    setLoading(true);
    try {
      const sows = await dataAPI.pigs.getAll({
        filters: { gender: 'female', status: 'active' }
      });
      setPigsList(sows || []);

      const allPigs = await dataAPI.pigs.getAll();
      let breedings = await dataAPI.breedings.getAll({
        orderBy: { column: 'expected_farrow', ascending: true }
      });
      breedings = breedings.map(b => ({ ...b, pigs: allPigs.find(p => p.id === b.pig_id) }));
      setBreedingsList(breedings || []);
    } catch (error) {
      Swal.fire('Error', 'Could not load breeding data', 'error');
    } finally {
      setLoading(false);
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

  const consumptionRate = 230;
  const daysLeft = Math.floor(stats.feedStock / consumptionRate);
  const stockPercent = Math.min(100, Math.round((stats.feedStock / (stats.feedStock + 500)) * 100));
  const isLowFeed = stats.feedStock < 500;

  // ==================== ADD PIG FORM ====================
  function AddPigForm() {
    const [formData, setFormData] = useState({
      tag: '', name: '', birth_date: '', gender: 'male', breed: 'Landrace', status: 'active',
    });
    const [submitting, setSubmitting] = useState(false);

    const handleSubmit = async (e) => {
      e.preventDefault();
      setSubmitting(true);
      try {
        await dataAPI.pigs.insert(formData);
        const actorName = profile?.username || 'Caretaker';
        await pushOwnerNotification('pig_added', `${actorName} added pig: Tag ${formData.tag}${formData.name ? ` (${formData.name})` : ''}, ${formData.gender}, ${formData.breed}.`, 'Owner', actorName);
        
        await Swal.fire('Success', 'Pig added successfully!', 'success');
        setCurrentView('dashboard');
        loadDashboardData();
      } catch (error) {
        Swal.fire('Error', error.message, 'error');
      } finally {
        setSubmitting(false);
      }
    };

    return (
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 20 }}>
          <h2><i className="fas fa-piggy-bank"></i> Add New Pig</h2>
          <button onClick={() => setCurrentView('dashboard')} className="btn-secondary">← Back</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div style={{ display: 'grid', gap: 16, gridTemplateColumns: '1fr 1fr' }}>
            <input type="text" placeholder="Tag *" value={formData.tag} onChange={e => setFormData({...formData, tag: e.target.value})} required className="form-input" />
            <input type="text" placeholder="Name" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} className="form-input" />
            <input type="date" placeholder="Birth Date" value={formData.birth_date} onChange={e => setFormData({...formData, birth_date: e.target.value})} className="form-input" />
            <select value={formData.gender} onChange={e => setFormData({...formData, gender: e.target.value})} className="form-input">
              <option value="male">Male</option><option value="female">Female</option>
            </select>
            <select value={formData.breed} onChange={e => setFormData({...formData, breed: e.target.value})} className="form-input">
              <option>Landrace</option><option>Large White</option><option>Duroc</option><option>Berkshire</option>
            </select>
            <select value={formData.status} onChange={e => setFormData({...formData, status: e.target.value})} className="form-input">
              <option value="active">Active</option><option value="sold">Sold</option><option value="deceased">Deceased</option>
            </select>
          </div>
          <button type="submit" disabled={submitting} className="btn-primary" style={{ marginTop: 20, width: '100%' }}>{submitting ? 'Adding...' : 'Add Pig'}</button>
        </form>
      </div>
    );
  }

  // ==================== ADD FEED FORM ====================
  function AddFeedForm() {
    const [quantity, setQuantity] = useState('');
    const [submitting, setSubmitting] = useState(false);

    const handleSubmit = async (e) => {
      e.preventDefault();
      setSubmitting(true);
      try {
        const kg = parseFloat(quantity);
        if (isNaN(kg) || kg <= 0) throw new Error('Enter a valid positive number');

        let inv = await getSingletonInventory();
        if (!inv) {
          const list = await dataAPI.inventory.getAll();
          inv = list && list.length > 0 ? list[0] : null;
        }

        if (inv) {
          await dataAPI.inventory.update(inv.id, { feed_stock_kg: inv.feed_stock_kg + kg });
        } else {
          await dataAPI.inventory.insert({ feed_stock_kg: kg, min_threshold: 500 });
        }

        const actorName = profile?.username || 'Caretaker';
        const newStock = (inv ? inv.feed_stock_kg : 0) + kg;
        await pushOwnerNotification(
          'feed_logged',
          `${actorName} restocked ${kg} kg of feed. Total stock now: ${newStock} kg.`,
          'Owner',
          actorName
        );

        await Swal.fire('Success', `Added ${kg} kg of feed`, 'success');
        setCurrentView('dashboard');
        loadDashboardData();
      } catch (error) {
        Swal.fire('Error', error.message, 'error');
      } finally {
        setSubmitting(false);
      }
    };

    return (
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 20 }}>
          <h2><i className="fas fa-warehouse"></i> Add Feed Stock</h2>
          <button onClick={() => setCurrentView('dashboard')} className="btn-secondary">← Back</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: 16 }}>Current Stock: <strong>{stats.feedStock} kg</strong></div>
          <input type="number" step="0.01" placeholder="Quantity in kg *" value={quantity} onChange={e => setQuantity(e.target.value)} required className="form-input" style={{ width: '100%', marginBottom: 16 }} />
          <button type="submit" disabled={submitting} className="btn-primary" style={{ width: '100%' }}>{submitting ? 'Adding...' : 'Add Feed'}</button>
        </form>
      </div>
    );
  }

  // ==================== ADD TRANSACTION FORM ====================
  function AddTransactionForm() {
    const [formData, setFormData] = useState({
      type: 'expense', amount: '', description: '', date: new Date().toISOString().split('T')[0],
    });
    const [submitting, setSubmitting] = useState(false);

    const handleSubmit = async (e) => {
      e.preventDefault();
      setSubmitting(true);
      try {
        const amount = parseFloat(formData.amount);
        if (isNaN(amount) || amount <= 0) throw new Error('Enter a valid positive amount');
        await dataAPI.financial_transactions.insert({
          type: formData.type, amount, description: formData.description, date: formData.date,
        });
        await Swal.fire('Success', 'Transaction recorded', 'success');
        setCurrentView('dashboard');
        loadDashboardData();
      } catch (error) {
        Swal.fire('Error', error.message, 'error');
      } finally {
        setSubmitting(false);
      }
    };

    return (
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 20 }}>
          <h2><i className="fas fa-dollar-sign"></i> Add Transaction</h2>
          <button onClick={() => setCurrentView('dashboard')} className="btn-secondary">← Back</button>
        </div>
        <form onSubmit={handleSubmit}>
          <select value={formData.type} onChange={e => setFormData({...formData, type: e.target.value})} className="form-input" style={{ width: '100%', marginBottom: 16 }}>
            <option value="expense">Expense</option><option value="revenue">Revenue</option>
          </select>
          <input type="number" step="0.01" placeholder="Amount *" value={formData.amount} onChange={e => setFormData({...formData, amount: e.target.value})} required className="form-input" style={{ width: '100%', marginBottom: 16 }} />
          <input type="text" placeholder="Description" value={formData.description} onChange={e => setFormData({...formData, description: e.target.value})} className="form-input" style={{ width: '100%', marginBottom: 16 }} />
          <input type="date" value={formData.date} onChange={e => setFormData({...formData, date: e.target.value})} className="form-input" style={{ width: '100%', marginBottom: 16 }} />
          <button type="submit" disabled={submitting} className="btn-primary" style={{ width: '100%' }}>{submitting ? 'Saving...' : 'Save Transaction'}</button>
        </form>
      </div>
    );
  }

  // ==================== MATING PLANNER ====================
  function MatingPlanner() {
    const [showAddForm, setShowAddForm] = useState(false);
    const [newBreeding, setNewBreeding] = useState({
      pig_id: '', mating_date: '', expected_farrow: '', status: 'planned', notes: '',
    });
    const [submitting, setSubmitting] = useState(false);

    const handleAddBreeding = async (e) => {
      e.preventDefault();
      setSubmitting(true);
      try {
        if (!newBreeding.pig_id || !newBreeding.mating_date || !newBreeding.expected_farrow) {
          throw new Error('Fill all required fields');
        }
        await dataAPI.breedings.insert(newBreeding);
        
        const actorName = profile?.username || 'Caretaker';
        const sowDisplay = newBreeding.pig_id; // SwineSync just uses ID here
        await pushOwnerNotification(
          'mating_added',
          `${actorName} recorded a mating date for sow ${sowDisplay} on ${newBreeding.mating_date}. Expected farrowing: ${newBreeding.expected_farrow}.`,
          'Owner',
          actorName
        );

        await Swal.fire('Success', 'Breeding record added', 'success');
        setShowAddForm(false);
        setNewBreeding({ pig_id: '', mating_date: '', expected_farrow: '', status: 'planned', notes: '' });
        loadBreedingsAndPigs();
      } catch (error) {
        Swal.fire('Error', error.message, 'error');
      } finally {
        setSubmitting(false);
      }
    };

    const handleUpdateStatus = async (id, newStatus) => {
      try {
        await dataAPI.breedings.update(id, { status: newStatus });
        Swal.fire('Updated', `Status changed to ${newStatus}`, 'success');
        loadBreedingsAndPigs();
      } catch (error) {
        Swal.fire('Error', error.message, 'error');
      }
    };

    const handleDelete = async (id) => {
      const result = await Swal.fire({
        title: 'Delete breeding record?',
        text: 'This cannot be undone',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#d33',
        confirmButtonText: 'Delete',
      });
      if (result.isConfirmed) {
        try {
          await dataAPI.breedings.delete(id);
          Swal.fire('Deleted', 'Breeding record removed', 'success');
          loadBreedingsAndPigs();
        } catch (error) {
          Swal.fire('Error', error.message, 'error');
        }
      }
    };

    if (loading) return <div className="card" style={{ textAlign: 'center', padding: 48 }}><i className="fas fa-spinner fa-pulse fa-2x"></i><p>Loading...</p></div>;

    return (
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h2><i className="fas fa-heart"></i> Mating Planner</h2>
          <div>
            <button onClick={() => setCurrentView('dashboard')} className="btn-secondary" style={{ marginRight: 12 }}>← Dashboard</button>
            <button onClick={() => setShowAddForm(!showAddForm)} className="btn-primary"><i className="fas fa-plus"></i> New Breeding</button>
          </div>
        </div>
        {showAddForm && (
          <div className="card" style={{ marginBottom: 24 }}>
            <h3>Add Breeding Record</h3>
            <form onSubmit={handleAddBreeding}>
              <div style={{ display: 'grid', gap: 16, gridTemplateColumns: '1fr 1fr' }}>
                <select value={newBreeding.pig_id} onChange={e => setNewBreeding({...newBreeding, pig_id: e.target.value})} required className="form-input">
                  <option value="">Select Sow *</option>
                  {pigsList.map(pig => <option key={pig.id} value={pig.id}>{pig.tag} - {pig.name || 'Unnamed'}</option>)}
                </select>
                <input type="date" value={newBreeding.mating_date} onChange={e => setNewBreeding({...newBreeding, mating_date: e.target.value})} required className="form-input" />
                <input type="date" value={newBreeding.expected_farrow} onChange={e => setNewBreeding({...newBreeding, expected_farrow: e.target.value})} required className="form-input" />
                <select value={newBreeding.status} onChange={e => setNewBreeding({...newBreeding, status: e.target.value})} className="form-input">
                  <option value="planned">Planned</option><option value="confirmed">Confirmed</option><option value="farrowed">Farrowed</option><option value="failed">Failed</option>
                </select>
              </div>
              <input type="text" placeholder="Notes (optional)" value={newBreeding.notes} onChange={e => setNewBreeding({...newBreeding, notes: e.target.value})} className="form-input" style={{ width: '100%', marginTop: 16 }} />
              <button type="submit" disabled={submitting} className="btn-primary" style={{ marginTop: 16, width: '100%' }}>{submitting ? 'Saving...' : 'Save Breeding'}</button>
            </form>
          </div>
        )}
        <div className="card">
          <h3>All Breeding Records</h3>
          {breedingsList.length === 0 ? <p>No breeding records found.</p> : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr style={{ borderBottom: '2px solid #e5e7eb' }}><th style={{ padding: 8 }}>Sow</th><th>Mating Date</th><th>Expected Farrow</th><th>Days Left</th><th>Status</th><th>Actions</th></tr></thead>
                <tbody>
                  {breedingsList.map(b => {
                    const days = daysUntil(b.expected_farrow);
                    return (
                      <tr key={b.id} style={{ borderBottom: '1px solid #e5e7eb' }}>
                        <td style={{ padding: 8 }}>{b.pigs?.tag} {b.pigs?.name ? `(${b.pigs.name})` : ''}</td>
                        <td style={{ padding: 8 }}>{b.mating_date}</td>
                        <td style={{ padding: 8 }}>{b.expected_farrow}</td>
                        <td style={{ padding: 8 }}>{days > 0 ? `${days} days` : 'Overdue'}</td>
                        <td style={{ padding: 8 }}>
                          <select value={b.status} onChange={e => handleUpdateStatus(b.id, e.target.value)} className="form-input" style={{ padding: '4px 8px', fontSize: 12 }}>
                            <option value="planned">Planned</option><option value="confirmed">Confirmed</option><option value="farrowed">Farrowed</option><option value="failed">Failed</option>
                          </select>
                        </td>
                        <td style={{ padding: 8 }}>
                          <button onClick={() => handleDelete(b.id)} style={{ background: '#ef4444', color: 'white', border: 'none', borderRadius: 6, padding: '4px 8px', cursor: 'pointer' }}><i className="fas fa-trash"></i> Delete</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ==================== DASHBOARD MAIN VIEW ====================
  if (currentView === 'addPig') return <AddPigForm />;
  if (currentView === 'addFeed') return <AddFeedForm />;
  if (currentView === 'addTransaction') return <AddTransactionForm />;
  if (currentView === 'matingPlanner') return <MatingPlanner />;

  if (loading) return <div className="card" style={{ textAlign: 'center', padding: 48 }}><i className="fas fa-spinner fa-pulse fa-2x"></i><p>Loading dashboard...</p></div>;

  return (
    <div>
      {/* Refresh & Timestamp */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16, gap: 12, alignItems: 'center' }}>
        <span style={{ fontSize: 12, color: '#6b7280' }}>Last updated: {lastUpdated.toLocaleTimeString()}</span>
        <button onClick={refreshData} style={{ background: '#e5e7eb', border: 'none', borderRadius: 8, padding: '4px 12px', cursor: 'pointer' }}>
          <i className="fas fa-sync-alt"></i> Refresh
        </button>
      </div>

      {/* Quick Action Buttons */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 24, flexWrap: 'wrap' }}>
        <button className="btn-primary" onClick={() => setCurrentView('addPig')} style={{ background: '#10b981' }}><i className="fas fa-plus"></i> Add Pig</button>
        <button className="btn-primary" onClick={() => setCurrentView('addFeed')} style={{ background: '#f59e0b' }}><i className="fas fa-plus"></i> Add Feed</button>
        <button className="btn-primary" onClick={() => setCurrentView('addTransaction')} style={{ background: '#22c55e' }}><i className="fas fa-dollar-sign"></i> Add Transaction</button>
        <button className="btn-primary" onClick={() => setCurrentView('matingPlanner')} style={{ background: '#a855f7' }}><i className="fas fa-heart"></i> Mating Planner</button>
      </div>

      {/* Stats Cards - Fully clickable */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 24, marginBottom: 32 }}>
        <div className="card card-hover" style={{ borderLeft: '8px solid #10b981', cursor: 'pointer' }} onClick={() => setCurrentView('addPig')}>
          <i className="fas fa-piggy-bank" style={{ fontSize: 32, color: '#10b981' }}></i>
          <p style={{ fontSize: 36, fontWeight: 900, marginTop: 8 }}>{stats.pigCount}</p>
          <p style={{ color: '#6b7280' }}>Active Pigs (click to add)</p>
        </div>

        <div className="card card-hover" style={{ borderLeft: '8px solid #f59e0b', cursor: 'pointer' }} onClick={() => setCurrentView('addFeed')}>
          <i className="fas fa-warehouse" style={{ fontSize: 32, color: '#f59e0b' }}></i>
          <p style={{ fontSize: 36, fontWeight: 900, marginTop: 8 }}>{stats.feedStock} kg</p>
          <p style={{ color: '#6b7280' }}>Feed Stock (click to add)</p>
        </div>

        <div className="card card-hover" style={{ borderLeft: '8px solid #22c55e', cursor: 'pointer' }} onClick={() => setCurrentView('addTransaction')}>
          <i className="fas fa-chart-simple" style={{ fontSize: 32, color: '#22c55e' }}></i>
          <p style={{ fontSize: 36, fontWeight: 900, marginTop: 8 }}>${stats.netProfit.toLocaleString()}</p>
          <p style={{ color: '#6b7280' }}>Net Profit (click to add transaction)</p>
        </div>

        <div className="card card-hover" style={{ borderLeft: '8px solid #a855f7', cursor: 'pointer' }} onClick={() => setCurrentView('matingPlanner')}>
          <i className="fas fa-bell" style={{ fontSize: 32, color: '#a855f7' }}></i>
          <p style={{ fontSize: 24, fontWeight: 900, marginTop: 8 }}>Alerts</p>
          <p style={{ fontSize: 14, color: '#6b7280' }}>{stats.upcomingEvents} upcoming farrowings (click to manage)</p>
        </div>
      </div>

      {/* Insights Row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 24, marginBottom: 32 }}>
        {/* Smart Insights Card */}
        <div className="card">
          <h3 style={{ fontWeight: 'bold', fontSize: 20, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
            <i className="fas fa-calendar-alt" style={{ color: '#059669' }}></i> Smart Insights
          </h3>
          <p>📈 AI predicts feed depletion in {Math.max(0, daysLeft)} days.</p>
          <div style={{ width: '100%', background: '#e5e7eb', borderRadius: 999, height: 10, marginTop: 8 }}>
            <div style={{ width: `${stockPercent}%`, background: isLowFeed ? '#ef4444' : '#059669', height: 10, borderRadius: 999 }}></div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginTop: 4 }}><span>Stock level</span><span>{stockPercent}%</span></div>
          {isLowFeed && <div style={{ marginTop: 12, background: '#fee2e2', padding: 8, borderRadius: 12, color: '#b91c1c', fontSize: 14 }}>⚠️ Low feed stock! Consider reordering soon.</div>}
          <div style={{ marginTop: 12 }}><i className="fas fa-tasks"></i> Upcoming tasks: {stats.upcomingEvents} farrowings to monitor.</div>
        </div>

        {/* Recent Transactions Card */}
        <div className="card">
          <h3 style={{ fontWeight: 'bold', fontSize: 20, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
            <i className="fas fa-receipt" style={{ color: '#22c55e' }}></i> Recent Transactions
          </h3>
          {recentTransactions.length === 0 ? <p>No transactions yet.</p> : (
            <ul style={{ listStyle: 'none', padding: 0 }}>
              {recentTransactions.map(tx => (
                <li key={tx.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #e5e7eb' }}>
                  <span>{tx.description || (tx.type === 'expense' ? 'Expense' : 'Revenue')}<br /><small style={{ fontSize: 11, color: '#6b7280' }}>{tx.date}</small></span>
                  <span style={{ fontWeight: 'bold', color: tx.type === 'expense' ? '#ef4444' : '#10b981' }}>{tx.type === 'expense' ? '-' : '+'}${tx.amount}</span>
                </li>
              ))}
            </ul>
          )}
          <button onClick={() => setCurrentView('addTransaction')} style={{ marginTop: 12, background: 'none', border: 'none', color: '#10b981', cursor: 'pointer' }}>Add transaction →</button>
        </div>

        {/* Upcoming Farrowings Card */}
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
                    <div><strong>{pig?.tag || '?'} - {pig?.name || 'Unknown'}</strong><div style={{ fontSize: 12, color: '#4b5563' }}>{f.expected_farrow} ({days > 0 ? `${days} days left` : 'overdue'})</div></div>
                    <span style={{ background: days <= 7 ? '#fef3c7' : '#e0e7ff', padding: '2px 8px', borderRadius: 999, fontSize: 12 }}>{f.status}</span>
                  </li>
                );
              })}
            </ul>
          )}
          <button onClick={() => setCurrentView('matingPlanner')} style={{ marginTop: 12, background: 'none', border: 'none', color: '#a855f7', cursor: 'pointer' }}>Manage breedings →</button>
        </div>
      </div>

      {/* Global Styles */}
      <style>{`
        .form-input { padding: 10px 12px; border: 1px solid #d1d5db; border-radius: 8px; font-size: 14px; }
        .form-input:focus { outline: none; border-color: #10b981; box-shadow: 0 0 0 3px rgba(16,185,129,0.1); }
        .btn-primary { background: #10b981; color: white; border: none; border-radius: 8px; padding: 8px 16px; cursor: pointer; font-weight: 500; transition: background 0.2s; }
        .btn-primary:hover { background: #059669; }
        .btn-secondary { background: #e5e7eb; border: none; border-radius: 8px; padding: 8px 16px; cursor: pointer; }
        .card { background: white; border-radius: 16px; padding: 20px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
        .card-hover { transition: transform 0.2s, box-shadow 0.2s; }
        .card-hover:hover { transform: translateY(-2px); box-shadow: 0 4px 12px rgba(0,0,0,0.15); }
      `}</style>
    </div>
  );
}