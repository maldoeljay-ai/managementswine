import { useEffect, useState } from 'react';
import { dataAPI } from '../lib/data';
import { isOnline } from '../lib/sync';
import { addNotification as pushOwnerNotification } from '../lib/notifications';
import Swal from 'sweetalert2';

// ---- Shared table styles ----
const thStyle = {
  padding: '10px 14px',
  textAlign: 'left',
  fontSize: 13,
  fontWeight: 700,
  color: '#4b5563',
  whiteSpace: 'nowrap',
  background: 'transparent',
};

const tdStyle = {
  padding: '10px 14px',
  fontSize: 14,
  color: '#374151',
  verticalAlign: 'middle',
};

// ---- Date formatter: "Jul 24, 2026" ----
function fmtDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr + 'T00:00:00');
  if (isNaN(d)) return dateStr;
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

// ---- Pill badge helper ----
const Pill = ({ label, bg, color }) => (
  <span style={{ background: bg, color, padding: '3px 10px', borderRadius: 999, fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap' }}>
    {label}
  </span>
);

export default function Fatteners({ profile }) {
  const [pigs, setPigs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [fattenerRevenue, setFattenerRevenue] = useState(0); // total revenue from sold fatteners

  // ---- Pig state ----
  const [showAddPigModal, setShowAddPigModal] = useState(false);
  const [editingPig, setEditingPig] = useState(null);
  const [pigFormData, setPigFormData] = useState({
    tag: '', name: '', birth_date: '', gender: '', breed: 'Mixed',
    status: 'active', reproductive_status: 'Fattener', weight_kg: '',
  });
  const [submittingPig, setSubmittingPig] = useState(false);

  // ---- Online / Sync ----
  const [online, setOnline] = useState(isOnline());

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
    setLoading(true);
    setError(null);
    try {
      // Load pigs
      const pigsData = await dataAPI.pigs.getAll();
      setPigs(pigsData || []);

      // Load financial transactions to compute revenue from fatteners
      const transactions = await dataAPI.financial_transactions.getAll();
      const revenue = transactions
        ?.filter(t => t.type === 'revenue' && t.category === 'Fatteners')
        .reduce((sum, t) => sum + t.amount, 0) || 0;
      setFattenerRevenue(revenue);

      // Automatic Feed Notifications for Fatteners (unchanged)
      const activeFatteners = (pigsData || []).filter(p => p.reproductive_status === 'Fattener' && p.status === 'active' && p.birth_date);
      for (const pig of activeFatteners) {
        const days = Math.floor((new Date() - new Date(pig.birth_date)) / 86400000);
        let targetFeed = null;
        let weekAge = 0;
        if (days >= 28 && days <= 30) { targetFeed = 'Starter'; weekAge = 4; }
        else if (days >= 56 && days <= 58) { targetFeed = 'Grower'; weekAge = 8; }
        else if (days >= 98 && days <= 100) { targetFeed = 'Finisher'; weekAge = 14; }

        if (targetFeed) {
          const notifKey = `fattener_feed_${pig.id}_${weekAge}w`;
          const pigLabel = `${pig.tag}${pig.name ? ` (${pig.name})` : ''}`;
          pushOwnerNotification(
            'feed_change',
            `Fattener ${pigLabel} is now ${weekAge} weeks old. Time to switch feed to ${targetFeed}.`,
            'Owner',
            'System',
            notifKey
          );
        }
      }
    } catch (err) {
      console.error('loadData error:', err);

    } finally {
      setLoading(false);
    }
  }

  const daysSince = (dateString) => {
    if (!dateString) return null;
    return Math.floor((new Date() - new Date(dateString)) / 86400000);
  };

  const openEditPigModal = (pig) => {
    setEditingPig(pig);
    setPigFormData({
      tag: pig.tag || '', name: pig.name || '', birth_date: pig.birth_date || '',
      gender: pig.gender || '', breed: pig.breed || 'Mixed',
      status: pig.status || 'active', reproductive_status: pig.reproductive_status || 'Fattener',
      weight_kg: pig.weight_kg ?? '',
    });
    setShowAddPigModal(true);
  };

  const handleSavePig = async (e) => {
    e.preventDefault();
    setSubmittingPig(true);
    try {
      if (!pigFormData.tag.trim()) throw new Error('Tag is required');
      const weight = pigFormData.weight_kg !== '' ? parseFloat(pigFormData.weight_kg) : null;
      if (pigFormData.weight_kg !== '' && isNaN(weight)) throw new Error('Weight must be a number');
      const payload = {
        ...pigFormData,
        tag: pigFormData.tag.trim(),
        name: pigFormData.name.trim() || null,
        weight_kg: weight,
        reproductive_status: pigFormData.reproductive_status || null,
      };
      if (editingPig) {
        await dataAPI.pigs.update(editingPig.id, payload);
        await Swal.fire({ icon: 'success', title: 'Updated!', text: 'Pig updated' + (!online ? ' (syncs when online)' : ''), timer: 1500, showConfirmButton: false });
      } else {
        await dataAPI.pigs.insert(payload);
        const actorName = profile?.username || 'Caretaker';
        await pushOwnerNotification('pig_added', `${actorName} added fattener: Tag ${payload.tag}${payload.name ? ` (${payload.name})` : ''}, ${payload.breed}.`, 'Owner', actorName);
        await Swal.fire({ icon: 'success', title: 'Added!', text: 'Fattener added' + (!online ? ' (syncs when online)' : ''), timer: 1500, showConfirmButton: false });
      }
      setShowAddPigModal(false);
      await loadData();
    } catch (err) {
      Swal.fire('Error', err.message, 'error');
    } finally {
      setSubmittingPig(false);
    }
  };

  const handleDeletePig = async (pig) => {
    const result = await Swal.fire({
      title: `Delete fattener ${pig.tag}?`,
      text: 'This will also remove related records.',
      icon: 'warning', showCancelButton: true,
      confirmButtonColor: '#ef4444', confirmButtonText: 'Delete',
    });
    if (!result.isConfirmed) return;
    try {
      await dataAPI.pigs.delete(pig.id);
      await Swal.fire({ icon: 'success', title: 'Deleted', timer: 1200, showConfirmButton: false });
      await loadData();
    } catch (err) {
      Swal.fire('Error', err.message, 'error');
    }
  };

  // ---- NEW: Mark pig as sold and record revenue ----
  const handleMarkSold = async (pig) => {
    // Step 1: Confirm they want to mark as sold
    const confirmResult = await Swal.fire({
      title: `Mark ${pig.tag} as Sold?`,
      text: `This will change the status of ${pig.tag} to "sold". Do you want to record the sale revenue?`,
      icon: 'question',
      showCancelButton: true,
      confirmButtonColor: '#f59e0b',
      cancelButtonColor: '#6b7280',
      confirmButtonText: 'Yes, record revenue',
      cancelButtonText: 'Skip revenue',
      showDenyButton: true,
      denyButtonText: 'Cancel',
    });

    if (confirmResult.isDenied) return; // user cancelled

    let saleAmount = 0;
    if (confirmResult.isConfirmed) {
      // User wants to record revenue – ask for amount
      const { value: amount } = await Swal.fire({
        title: '💰 Enter Sale Amount',
        input: 'number',
        inputLabel: 'How much was this fattener sold for? (₱)',
        inputPlaceholder: 'e.g. 12000',
        inputAttributes: { min: '0.01', step: '0.01' },
        showCancelButton: true,
        confirmButtonColor: '#10b981',
        cancelButtonColor: '#6b7280',
        confirmButtonText: 'Record Revenue',
        inputValidator: (value) => {
          if (!value || isNaN(value) || parseFloat(value) <= 0) {
            return 'Please enter a valid positive amount.';
          }
          return null;
        }
      });
      if (amount === undefined) return; // user cancelled
      saleAmount = parseFloat(amount);
    }

    try {
      // Update pig status to sold
      await dataAPI.pigs.update(pig.id, { status: 'sold' });

      // If there's a sale amount, record transaction
      if (saleAmount > 0) {
        const activeFarmId = localStorage.getItem('swinesync_active_farm');
        await dataAPI.financial_transactions.insert({
          farm_id: activeFarmId,
          type: 'revenue',
          category: 'Fatteners',
          amount: saleAmount,
          description: `Sale of fattener ${pig.tag}${pig.name ? ` (${pig.name})` : ''}`,
          date: new Date().toISOString().split('T')[0],
        });
        // Notify owner
        const actorName = profile?.username || 'Caretaker';
        await pushOwnerNotification(
          'feed_logged', // reuse or create new type? we'll use feed_logged as generic
          `${actorName} recorded sale of fattener ${pig.tag} for ₱${saleAmount}.`,
          'Owner',
          actorName
        );
      }

      await Swal.fire({
        icon: 'success',
        title: 'Marked as Sold',
        text: saleAmount > 0 ? `Revenue of ₱${saleAmount} recorded.` : 'Pig marked as sold without revenue.',
        timer: 2000,
        showConfirmButton: false,
      });
      await loadData(); // refresh list and revenue total
    } catch (err) {
      Swal.fire('Error', 'Failed to mark as sold: ' + err.message, 'error');
    }
  };

  const inputStyle = { width: '100%', padding: '9px 12px', borderRadius: 8, border: '1.5px solid #d1d5db', fontSize: 14, outline: 'none', boxSizing: 'border-box' };
  const labelStyle = { display: 'block', marginBottom: 5, fontWeight: 600, fontSize: 13, color: '#374151' };

  return (
    <div className="card" style={{ padding: 24, position: 'relative' }}>

      {/* ---- Revenue Summary Card (NEW) ---- */}
      <div style={{
        background: 'linear-gradient(135deg, #fef3c7, #fde68a)',
        borderRadius: 16,
        padding: '16px 20px',
        marginBottom: 24,
        borderLeft: '8px solid #f59e0b',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: 12,
      }}>
        <div>
          <h4 style={{ margin: 0, fontWeight: 700, color: '#92400e', fontSize: 16 }}>
            <i className="fas fa-coins" style={{ marginRight: 8 }} />
            Total Revenue from Sold Fatteners
          </h4>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: '#78350f' }}>
            This includes all revenue recorded when marking pigs as sold.
          </p>
        </div>
        <div style={{ fontSize: 32, fontWeight: 900, color: '#065f46' }}>
          ₱{fattenerRevenue.toLocaleString(undefined, { minimumFractionDigits: 2 })}
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h3 style={{ fontSize: 22, fontWeight: 800, color: '#1f2937', display: 'flex', alignItems: 'center', gap: 10, margin: 0 }}>
            <i className="fas fa-weight" style={{ color: '#10b981' }} /> Fatteners
          </h3>
          <p style={{ color: '#6b7280', fontSize: 13, margin: '4px 0 0' }}>
            Feed stages are automatically calculated based on age (Birth Date).
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <button onClick={() => {
            setEditingPig(null);
            setPigFormData({ tag: '', name: '', birth_date: '', gender: '', breed: 'Mixed', status: 'active', reproductive_status: 'Fattener', weight_kg: '' });
            setShowAddPigModal(true);
          }} style={{ background: 'linear-gradient(135deg,#10b981,#059669)', color: 'white', border: 'none', borderRadius: 8, padding: '7px 16px', cursor: 'pointer', fontWeight: 700, fontSize: 14, display: 'flex', alignItems: 'center', gap: 6, boxShadow: '0 4px 12px rgba(16,185,129,0.3)' }}>
            <i className="fas fa-plus" /> Add Fattener
          </button>
          <button onClick={loadData} disabled={loading} style={{ background: '#f3f4f6', border: 'none', borderRadius: 8, padding: '7px 14px', cursor: loading ? 'not-allowed' : 'pointer', fontSize: 13 }}>
            <i className={`fas fa-sync-alt ${loading ? 'fa-spin' : ''}`} style={{ marginRight: 6 }} /> Refresh
          </button>
        </div>
      </div>

      {error && (
        <div style={{ background: '#fff7ed', border: '1px solid #fed7aa', padding: '10px 14px', borderRadius: 10, marginBottom: 16, color: '#c2410c', fontSize: 14, display: 'flex', alignItems: 'center', gap: 10 }}>
          <i className="fas fa-exclamation-triangle" />
          <span>{error}</span>
          <button onClick={loadData} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: '#c2410c', textDecoration: 'underline', cursor: 'pointer', fontSize: 13 }}>Retry</button>
        </div>
      )}

      {loading ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 60, gap: 14, color: '#6b7280' }}>
          <i className="fas fa-spinner fa-spin" style={{ fontSize: 28, color: '#10b981' }} />
          <span style={{ fontSize: 16 }}>Loading fatteners data…</span>
        </div>
      ) : (
        <div style={{ overflowX: 'auto', border: '1px solid #e5e7eb', borderRadius: 12 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead style={{ background: 'linear-gradient(135deg,#f0fdf4,#dcfce7)' }}>
              <tr>
                {['Tag / Name', 'Birth Date', 'Age', 'Feed Phase', 'Status', 'Actions'].map(h => (
                  <th key={h} style={{ ...thStyle, textAlign: h === 'Actions' ? 'center' : 'left' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pigs.filter(p => p.reproductive_status === 'Fattener' && p.status === 'active').length === 0 ? (
                <tr><td colSpan={7} style={{ textAlign: 'center', padding: 32, color: '#9ca3af' }}>No active fatteners recorded. Click "Add Fattener" above to register one.</td></tr>
              ) : (
                pigs.filter(p => p.reproductive_status === 'Fattener' && p.status === 'active')
                  .sort((a, b) => new Date(b.birth_date || 0) - new Date(a.birth_date || 0))
                  .map(pig => {
                    let ageWeeks = null;
                    let feedPhase = 'Unknown (No Birth Date)';
                    let feedColor = '#6b7280';
                    if (pig.birth_date) {
                      const dSince = daysSince(pig.birth_date);
                      ageWeeks = Math.floor(dSince / 7);
                      if (ageWeeks < 4) { feedPhase = 'Pre-starter'; feedColor = '#8b5cf6'; }
                      else if (ageWeeks < 8) { feedPhase = 'Starter'; feedColor = '#3b82f6'; }
                      else if (ageWeeks < 14) { feedPhase = 'Grower'; feedColor = '#eab308'; }
                      else { feedPhase = 'Finisher'; feedColor = '#ef4444'; }
                    }
                    return (
                      <tr key={pig.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                        <td style={tdStyle}><strong>{pig.tag}</strong> {pig.name ? `– ${pig.name}` : ''}</td>
                        <td style={tdStyle}>{fmtDate(pig.birth_date)}</td>
                        <td style={tdStyle}>{ageWeeks !== null ? `${ageWeeks} weeks` : '—'}</td>
                        <td style={tdStyle}>
                          {pig.birth_date ? (
                            <span style={{ fontWeight: 700, color: feedColor, background: `${feedColor}20`, padding: '4px 10px', borderRadius: 999, fontSize: 12 }}>
                              {feedPhase}
                            </span>
                          ) : '—'}
                        </td>
                        <td style={tdStyle}>
                          <Pill
                            label={pig.status.charAt(0).toUpperCase() + pig.status.slice(1)}
                            bg={pig.status === 'active' ? '#d1fae5' : pig.status === 'sold' ? '#fef3c7' : '#fee2e2'}
                            color={pig.status === 'active' ? '#065f46' : pig.status === 'sold' ? '#92400e' : '#991b1b'}
                          />
                        </td>

                        <td style={{ ...tdStyle, textAlign: 'center' }}>
                          <div style={{ display: 'flex', gap: 6, justifyContent: 'center' }}>
                            <button onClick={() => openEditPigModal(pig)} style={{ background: '#f3f4f6', border: 'none', padding: '5px 9px', borderRadius: 8, cursor: 'pointer', color: '#4b5563' }} title="Edit Fattener">
                              <i className="fas fa-edit" style={{ fontSize: 12 }} />
                            </button>
                            {/* ---- UPDATED "Mark as Sold" button ---- */}
                            <button
                              onClick={() => handleMarkSold(pig)}
                              style={{ background: '#fef3c7', border: 'none', padding: '5px 9px', borderRadius: 8, cursor: 'pointer', color: '#d97706' }}
                              title="Mark as Sold and record revenue"
                            >
                              <i className="fas fa-dollar-sign" style={{ fontSize: 12 }} />
                            </button>
                            <button onClick={() => handleDeletePig(pig)} style={{ background: '#fee2e2', border: 'none', padding: '5px 9px', borderRadius: 8, cursor: 'pointer', color: '#dc2626' }} title="Delete">
                              <i className="fas fa-trash-alt" style={{ fontSize: 12 }} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
              )}
            </tbody>
          </table>
        </div>
      )}

      {showAddPigModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20 }} onClick={() => setShowAddPigModal(false)}>
          <div style={{ background: 'white', padding: 32, borderRadius: 24, width: '100%', maxWidth: 680, maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 25px 50px rgba(0,0,0,0.3)', position: 'relative' }} onClick={e => e.stopPropagation()}>
            <button onClick={() => setShowAddPigModal(false)} style={{ position: 'absolute', top: 16, right: 18, background: 'none', border: 'none', fontSize: 22, color: '#9ca3af', cursor: 'pointer' }}>
              <i className="fas fa-times" />
            </button>
            <h3 style={{ marginBottom: 24, fontSize: 22, fontWeight: 800, color: '#1f2937', display: 'flex', alignItems: 'center', gap: 10 }}>
              <i className="fas fa-weight" style={{ color: '#10b981' }} />
              {editingPig ? 'Edit Fattener' : 'Add New Fattener'}
            </h3>
            <form onSubmit={handleSavePig}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 16, marginBottom: 24 }}>
                <div>
                  <label style={labelStyle}><i className="fas fa-tag" style={{ marginRight: 5, color: '#6b7280' }} />Tag <span style={{ color: '#ef4444' }}>*</span></label>
                  <input type="text" value={pigFormData.tag} onChange={e => setPigFormData({ ...pigFormData, tag: e.target.value })} required placeholder="e.g., FATT-001" style={inputStyle} />
                </div>
                <div>
                  <label style={labelStyle}><i className="fas fa-pen" style={{ marginRight: 5, color: '#6b7280' }} />Name</label>
                  <input type="text" value={pigFormData.name} onChange={e => setPigFormData({ ...pigFormData, name: e.target.value })} placeholder="e.g., Piggy" style={inputStyle} />
                </div>
                <div>
                  <label style={labelStyle}><i className="fas fa-calendar-alt" style={{ marginRight: 5, color: '#6b7280' }} />Birth Date</label>
                  <input type="date" value={pigFormData.birth_date} onChange={e => setPigFormData({ ...pigFormData, birth_date: e.target.value })} style={inputStyle} />
                </div>
                <div>
                  <label style={labelStyle}><i className="fas fa-dna" style={{ marginRight: 5, color: '#6b7280' }} />Breed</label>
                  <select value={pigFormData.breed} onChange={e => setPigFormData({ ...pigFormData, breed: e.target.value })} style={inputStyle}>
                    <option>Mixed</option>
                    <option>Landrace</option>
                    <option>Large White</option>
                    <option>Duroc</option>
                    <option>Berkshire</option>
                    <option>Hampshire</option>
                    <option>Yorkshire</option>
                    <option>Pietrain</option>
                  </select>
                </div>
                <div>
                  <label style={labelStyle}><i className="fas fa-circle" style={{ marginRight: 5, color: '#6b7280' }} />Status</label>
                  <select value={pigFormData.status} onChange={e => setPigFormData({ ...pigFormData, status: e.target.value })} style={inputStyle}>
                    <option value="active">Active</option>
                    <option value="deceased">Deceased</option>
                  </select>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', paddingTop: 16, borderTop: '1px solid #e5e7eb' }}>
                <button type="button" onClick={() => setShowAddPigModal(false)} style={{ padding: '9px 22px', background: '#f3f4f6', border: 'none', borderRadius: 10, color: '#374151', fontWeight: 600, cursor: 'pointer' }}>Cancel</button>
                <button type="submit" disabled={submittingPig} style={{ padding: '9px 28px', background: submittingPig ? '#9ca3af' : 'linear-gradient(135deg,#10b981,#059669)', border: 'none', borderRadius: 10, color: 'white', fontWeight: 700, cursor: submittingPig ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: 7, boxShadow: '0 4px 12px rgba(16,185,129,0.3)' }}>
                  {submittingPig ? <><i className="fas fa-spinner fa-spin" />Saving…</> : <><i className="fas fa-save" />{editingPig ? 'Update Fattener' : 'Add Fattener'}</>}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}