import { useEffect, useState, useRef, useCallback } from 'react';
import { dataAPI } from '../lib/data';
import { syncAll, isOnline } from '../lib/sync';
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

export default function Breeding({ profile }) {
  const [pigs, setPigs] = useState([]);
  const [breedings, setBreedings] = useState([]);
  const [weanings, setWeanings] = useState([]);
  const [activeTab, setActiveTab] = useState('herd');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // ---- Pig state ----
  const [showAddPigModal, setShowAddPigModal] = useState(false);
  const [editingPig, setEditingPig] = useState(null);
  const [pigFormData, setPigFormData] = useState({
    tag: '', name: '', birth_date: '', gender: 'female', breed: 'Landrace',
    status: 'active', reproductive_status: 'Open', weight_kg: '',
  });
  const [submittingPig, setSubmittingPig] = useState(false);

  // ---- Mating state ----
  const [showMatingForm, setShowMatingForm] = useState(false);
  const [editingMating, setEditingMating] = useState(null);
  const [matingForm, setMatingForm] = useState({ pig_id: '', mating_date: '', notes: '' });
  const [submittingMating, setSubmittingMating] = useState(false);
  const [updatingStatusId, setUpdatingStatusId] = useState(null);

  // ---- Farrowing state ----
  const [showFarrowModal, setShowFarrowModal] = useState(false);
  const [farrowBreeding, setFarrowBreeding] = useState(null);
  const [farrowForm, setFarrowForm] = useState({
    actual_farrow_date: new Date().toISOString().split('T')[0],
    litter_size: '', stillborn: 0, notes: '',
  });
  const [submittingFarrow, setSubmittingFarrow] = useState(false);

  // ---- Weaning state ----
  const [showWeanModal, setShowWeanModal] = useState(false);
  const [weanBreeding, setWeanBreeding] = useState(null);
  const [weanForm, setWeanForm] = useState({
    weaning_date: new Date().toISOString().split('T')[0],
    piglets_weaned: '', avg_weight_kg: '', notes: '',
  });
  const [submittingWean, setSubmittingWean] = useState(false);

  // ---- Quick sow add (inside mating form) ----
  const [showQuickSow, setShowQuickSow] = useState(false);
  const [quickSow, setQuickSow] = useState({ tag: '', name: '', weight_kg: '' });
  const [addingQuickSow, setAddingQuickSow] = useState(false);

  // ---- Filters for Pig Herd ----
  const [filterTag, setFilterTag] = useState('');
  const [filterGender, setFilterGender] = useState('all');
  const [filterStatus, setFilterStatus] = useState('active'); // default to active
  const [filterReproStatus, setFilterReproStatus] = useState('all');

  // ---- Online / Sync ----
  const [online, setOnline] = useState(isOnline());
  const [syncing, setSyncing] = useState(false);
  const [toasts, setToasts] = useState([]);
  const toastTimer = useRef(null);

  const addToast = useCallback((message, type = 'info') => {
    const id = Date.now();
    setToasts(prev => [...prev, { id, message, type }]);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => {
      setToasts(prev => prev.filter(n => n.id !== id));
    }, 4000);
  }, []);

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

  const handleSync = async () => {
    setSyncing(true);
    try {
      await syncAll();
      addToast('✅ Sync completed successfully', 'success');
      await loadData();
    } catch (err) {
      addToast(' Sync failed: ' + err.message, 'error');
    } finally {
      setSyncing(false);
    }
  };

  useEffect(() => {
    loadData();
    window.addEventListener('refreshAllData', loadData);
    return () => {
      window.removeEventListener('refreshAllData', loadData);
    };
  }, []);

  // Load each table independently so one failure doesn't block the rest
  async function loadData() {
    setLoading(true);
    setError(null);
    try {
      const [pigsData, breedingData, weaningData] = await Promise.allSettled([
        dataAPI.pigs.getAll(),
        dataAPI.breedings.getAll(),
        dataAPI.weanings.getAll(),
      ]);

      if (pigsData.status === 'fulfilled') setPigs(pigsData.value || []);
      else console.warn('pigs load failed:', pigsData.reason);

      if (breedingData.status === 'fulfilled') setBreedings(breedingData.value || []);
      else console.warn('breedings load failed:', breedingData.reason);

      if (weaningData.status === 'fulfilled') setWeanings(weaningData.value || []);
      else console.warn('weanings load failed:', weaningData.reason);

      const anyFailed = [pigsData, breedingData, weaningData].some(r => r.status === 'rejected');
      if (anyFailed) setError('Some data failed to load. Showing available data.');
    } catch (err) {
      console.error('loadData error:', err);
      setError('Failed to load data: ' + err.message);
    } finally {
      setLoading(false);
    }
  }

  // ---- Helpers ----
  const calculateExpectedFarrow = (matingDate) => {
    if (!matingDate) return '';
    const d = new Date(matingDate);
    d.setDate(d.getDate() + 115);
    return d.toISOString().split('T')[0];
  };

  const calculateExpectedWeaning = (farrowDate) => {
    if (!farrowDate) return '';
    const d = new Date(farrowDate);
    d.setDate(d.getDate() + 28);
    return d.toISOString().split('T')[0];
  };

  const daysUntil = (dateString) => {
    if (!dateString) return null;
    return Math.ceil((new Date(dateString) - new Date()) / 86400000);
  };

  const daysSince = (dateString) => {
    if (!dateString) return null;
    return Math.floor((new Date() - new Date(dateString)) / 86400000);
  };

  const getPigInfo = (pigId) => {
    const pig = pigs.find(p => p.id === pigId);
    if (!pig) return String(pigId ?? '—');
    return `${pig.tag ?? '?'} – ${pig.name ?? '(no name)'}`;
  };

  const sowOptions = pigs.filter(p => p.gender === 'female' && p.status === 'active');

  // ---- Pig CRUD ----
  const openAddPigModal = () => {
    setEditingPig(null);
    setPigFormData({ tag: '', name: '', birth_date: '', gender: 'female', breed: 'Landrace', status: 'active', reproductive_status: 'Open', weight_kg: '' });
    setShowAddPigModal(true);
  };

  const openEditPigModal = (pig) => {
    setEditingPig(pig);
    setPigFormData({
      tag: pig.tag || '', name: pig.name || '', birth_date: pig.birth_date || '',
      gender: pig.gender || 'female', breed: pig.breed || 'Landrace',
      status: pig.status || 'active', reproductive_status: pig.reproductive_status || 'Open',
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
        await pushOwnerNotification('pig_added', `${actorName} added pig: Tag ${payload.tag}${payload.name ? ` (${payload.name})` : ''}, ${payload.gender}, ${payload.breed}.`, 'Owner', actorName);
        await Swal.fire({ icon: 'success', title: 'Added!', text: 'Pig added' + (!online ? ' (syncs when online)' : ''), timer: 1500, showConfirmButton: false });
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
      title: `Delete pig ${pig.tag}?`,
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

  // ---- Mating CRUD ----
  const openMatingForm = (breeding = null) => {
    if (breeding) {
      setEditingMating(breeding);
      setMatingForm({ pig_id: breeding.pig_id, mating_date: breeding.mating_date, notes: breeding.notes || '' });
    } else {
      setEditingMating(null);
      setMatingForm({ pig_id: '', mating_date: '', notes: '' });
    }
    setShowQuickSow(false);
    setShowMatingForm(true);
  };

  const closeMatingForm = () => {
    setShowMatingForm(false);
    setEditingMating(null);
    setMatingForm({ pig_id: '', mating_date: '', notes: '' });
    setShowQuickSow(false);
  };

  const handleMatingSubmit = async (e) => {
    e.preventDefault();
    if (!matingForm.pig_id || !matingForm.mating_date) {
      Swal.fire('Error', 'Please select a sow and enter a mating date.', 'error');
      return;
    }
    if (!editingMating) {
      const alreadyBred = breedings.some(b =>
        b.pig_id === matingForm.pig_id &&
        (b.status === 'Scheduled' || b.status === 'Confirmed')
      );
      if (alreadyBred) {
        Swal.fire('Error', 'This sow already has an active breeding record.', 'error');
        return;
      }
    }
    setSubmittingMating(true);
    const expectedFarrow = calculateExpectedFarrow(matingForm.mating_date);
    try {
      if (editingMating) {
        await dataAPI.breedings.update(editingMating.id, {
          pig_id: matingForm.pig_id,
          mating_date: matingForm.mating_date,
          expected_farrow: expectedFarrow,
          notes: matingForm.notes || null,
        });
        await Swal.fire({ icon: 'success', title: 'Updated!', text: 'Mating record updated' + (!online ? ' (syncs when online)' : ''), timer: 1500, showConfirmButton: false });
      } else {
        await dataAPI.breedings.insert({
          pig_id: matingForm.pig_id,
          mating_date: matingForm.mating_date,
          expected_farrow: expectedFarrow,
          status: 'Scheduled',
          notes: matingForm.notes || null,
        });
        // Notify owner about new mating record
        const actorName = profile?.username || 'Caretaker';
        const sow = pigs.find(p => p.id === matingForm.pig_id);
        const sowDisplay = sow ? `${sow.tag}${sow.name ? ` (${sow.name})` : ''}` : matingForm.pig_id;
        await pushOwnerNotification(
          'mating_added',
          `${actorName} recorded a mating date for sow ${sowDisplay} on ${matingForm.mating_date}. Expected farrowing: ${expectedFarrow}.`,
          'Owner',
          actorName
        );
        await Swal.fire({ icon: 'success', title: 'Saved!', text: 'Mating record added' + (!online ? ' (syncs when online)' : ''), timer: 1500, showConfirmButton: false });
      }
      closeMatingForm();
      await loadData();
    } catch (err) {
      Swal.fire('Error', err.message, 'error');
    } finally {
      setSubmittingMating(false);
    }
  };

  const updateMatingStatus = async (id, newStatus) => {
    setUpdatingStatusId(id);
    try {
      await dataAPI.breedings.update(id, { status: newStatus });
      await loadData();
    } catch (err) {
      Swal.fire('Error', 'Status update failed: ' + err.message, 'error');
    } finally {
      setUpdatingStatusId(null);
    }
  };

  const deleteMating = async (id) => {
    const result = await Swal.fire({
      title: 'Delete mating record?', text: 'This cannot be undone.',
      icon: 'warning', showCancelButton: true,
      confirmButtonColor: '#ef4444', confirmButtonText: 'Delete',
    });
    if (!result.isConfirmed) return;
    try {
      await dataAPI.breedings.delete(id);
      await loadData();
    } catch (err) {
      Swal.fire('Error', err.message, 'error');
    }
  };

  // ---- Quick Sow ----
  const handleQuickSow = async (e) => {
    e.preventDefault();
    if (!quickSow.tag.trim()) { Swal.fire('Error', 'Tag is required', 'error'); return; }
    setAddingQuickSow(true);
    try {
      const payload = {
        tag: quickSow.tag.trim(),
        name: quickSow.name.trim() || null,
        gender: 'female', status: 'active', reproductive_status: 'Open',
        weight_kg: quickSow.weight_kg ? parseFloat(quickSow.weight_kg) : null,
      };
      const newPig = await dataAPI.pigs.insert(payload);
      await loadData();
      setMatingForm(prev => ({ ...prev, pig_id: newPig.id }));
      setQuickSow({ tag: '', name: '', weight_kg: '' });
      setShowQuickSow(false);
      const actorName = profile?.username || 'Caretaker';
      await pushOwnerNotification('pig_added', `${actorName} added a new sow: Tag ${payload.tag}${payload.name ? ` (${payload.name})` : ''}.`, 'Owner', actorName);
    } catch (err) {
      Swal.fire('Error', 'Error adding sow: ' + err.message, 'error');
    } finally {
      setAddingQuickSow(false);
    }
  };

  // ---- Farrowing ----
  const openFarrowModal = (breeding) => {
    setFarrowBreeding(breeding);
    setFarrowForm({ actual_farrow_date: new Date().toISOString().split('T')[0], litter_size: '', stillborn: 0, notes: '' });
    setShowFarrowModal(true);
  };

  const handleFarrowSubmit = async (e) => {
    e.preventDefault();
    const { actual_farrow_date, litter_size, stillborn, notes } = farrowForm;
    if (!actual_farrow_date) { Swal.fire('Error', 'Please select the actual farrow date.', 'error'); return; }
    const litter = parseInt(litter_size);
    if (isNaN(litter) || litter < 0) { Swal.fire('Error', 'Please enter a valid litter size.', 'error'); return; }
    const still = parseInt(stillborn) || 0;
    if (still > litter) { Swal.fire('Error', 'Stillborn count cannot exceed litter size.', 'error'); return; }

    setSubmittingFarrow(true);
    try {
      await dataAPI.breedings.update(farrowBreeding.id, {
        status: 'Farrowed',
        actual_farrowing_date: actual_farrow_date,
        litter_size: litter,
        stillborn: still,
        notes: farrowBreeding.notes
          ? farrowBreeding.notes + (notes ? `\nFarrow notes: ${notes}` : '')
          : (notes || null),
      });
      const sow = pigs.find(p => p.id === farrowBreeding.pig_id);
      if (sow) await dataAPI.pigs.update(sow.id, { reproductive_status: 'Lactating' });
      // Notify owner about farrowing
      const actorName = profile?.username || 'Caretaker';
      const sowDisplay = sow ? `${sow.tag}${sow.name ? ` (${sow.name})` : ''}` : farrowBreeding.pig_id;
      await pushOwnerNotification(
        'farrowing_recorded',
        `${actorName} recorded farrowing for sow ${sowDisplay}: ${litter} piglets born (${still} stillborn) on ${actual_farrow_date}.`,
        'Owner',
        actorName
      );
      await Swal.fire({ icon: 'success', title: 'Farrowing Recorded!', text: `${litter} piglets (${still} stillborn)`, timer: 2000, showConfirmButton: false });
      setShowFarrowModal(false);
      await loadData();
    } catch (err) {
      Swal.fire('Error', 'Failed to record farrowing: ' + err.message, 'error');
    } finally {
      setSubmittingFarrow(false);
    }
  };

  // ---- Weaning ----
  const openWeanModal = (breeding) => {
    setWeanBreeding(breeding);
    setWeanForm({
      weaning_date: calculateExpectedWeaning(breeding.actual_farrowing_date) || new Date().toISOString().split('T')[0],
      piglets_weaned: breeding.litter_size != null ? String(breeding.litter_size - (breeding.stillborn || 0)) : '',
      avg_weight_kg: '', notes: '',
    });
    setShowWeanModal(true);
  };

  const handleWeanSubmit = async (e) => {
    e.preventDefault();
    const { weaning_date, piglets_weaned, avg_weight_kg, notes } = weanForm;
    if (!weaning_date) { Swal.fire('Error', 'Please select the weaning date.', 'error'); return; }
    const weaned = parseInt(piglets_weaned);
    if (isNaN(weaned) || weaned < 0) { Swal.fire('Error', 'Please enter a valid number of piglets weaned.', 'error'); return; }

    setSubmittingWean(true);
    try {
      await dataAPI.weanings.insert({
        pig_id: weanBreeding.pig_id,
        breeding_id: weanBreeding.id,
        weaning_date,
        piglets_weaned: weaned,
        avg_weight_kg: avg_weight_kg ? parseFloat(avg_weight_kg) : null,
        notes: notes || null,
      });
      await dataAPI.breedings.update(weanBreeding.id, { status: 'Weaned' });
      const sow = pigs.find(p => p.id === weanBreeding.pig_id);
      if (sow) await dataAPI.pigs.update(sow.id, { reproductive_status: 'Open' });
      // Notify owner about weaning
      const actorName = profile?.username || 'Caretaker';
      const sowDisplay = sow ? `${sow.tag}${sow.name ? ` (${sow.name})` : ''}` : weanBreeding.pig_id;
      await pushOwnerNotification(
        'weaning_recorded',
        `${actorName} recorded weaning for sow ${sowDisplay}: ${weaned} piglets weaned on ${weaning_date}${avg_weight_kg ? ` (avg ${parseFloat(avg_weight_kg)} kg)` : ''}.`,
        'Owner',
        actorName
      );
      await Swal.fire({ icon: 'success', title: 'Weaning Recorded!', text: `${weaned} piglets weaned. Sow is now Open.`, timer: 2000, showConfirmButton: false });
      setShowWeanModal(false);
      await loadData();
    } catch (err) {
      Swal.fire('Error', 'Failed to record weaning: ' + err.message, 'error');
    } finally {
      setSubmittingWean(false);
    }
  };

  const deleteWeaning = async (id) => {
    const result = await Swal.fire({
      title: 'Delete weaning record?', text: 'This cannot be undone.',
      icon: 'warning', showCancelButton: true,
      confirmButtonColor: '#ef4444', confirmButtonText: 'Delete',
    });
    if (!result.isConfirmed) return;
    try {
      await dataAPI.weanings.delete(id);
      await loadData();
    } catch (err) {
      Swal.fire('Error', err.message, 'error');
    }
  };

  // ---- Computed lists ----
  const activePigsCount = pigs.filter(p => p.status === 'active').length;

  const upcomingFarrowings = breedings.filter(b =>
    b.status !== 'Farrowed' && b.status !== 'Aborted' && b.status !== 'Weaned' && b.expected_farrow
  ).sort((a, b) => new Date(a.expected_farrow) - new Date(b.expected_farrow));

  const recentFarrowings = breedings.filter(b =>
    b.status === 'Farrowed' || b.status === 'Weaned'
  ).sort((a, b) => new Date(b.actual_farrowing_date || 0) - new Date(b.actual_farrowing_date || 0)).slice(0, 20);

  const farrowingsDueSoon = upcomingFarrowings.filter(b => {
    const d = daysUntil(b.expected_farrow);
    return d !== null && d >= 0 && d <= 7;
  });

  const lactatingBreedings = breedings.filter(b =>
    b.status === 'Farrowed' && b.actual_farrowing_date
  ).sort((a, b) => new Date(a.actual_farrowing_date) - new Date(b.actual_farrowing_date));

  const weaningsDueSoon = lactatingBreedings.filter(b => {
    const d = daysUntil(calculateExpectedWeaning(b.actual_farrowing_date));
    return d !== null && d <= 3;
  });

  const statusColors = {
    Scheduled: { bg: '#fef3c7', color: '#92400e' },
    Confirmed: { bg: '#d1fae5', color: '#065f46' },
    Farrowed: { bg: '#bfdbfe', color: '#1e40af' },
    Aborted: { bg: '#fee2e2', color: '#991b1b' },
    Weaned: { bg: '#e9d5ff', color: '#6b21a8' },
  };

  // ---- Filtered pigs ----
  const filteredPigs = pigs.filter(pig => {
    // Hide ALL fatteners from the Breeding view completely (managed in Fatteners tab)
    if (pig.reproductive_status === 'Fattener') {
      return false;
    }

    const tag = (pig.tag ?? '').toLowerCase();
    const name = (pig.name ?? '').toLowerCase();
    const search = filterTag.toLowerCase();
    return (tag.includes(search) || name.includes(search))
      && (filterGender === 'all' || pig.gender === filterGender)
      && (filterStatus === 'all' || pig.status === filterStatus)
      && (filterReproStatus === 'all' || pig.reproductive_status === filterReproStatus);
  });

  // ---- Shared input style ----
  const inputStyle = { width: '100%', padding: '9px 12px', borderRadius: 8, border: '1.5px solid #d1d5db', fontSize: 14, outline: 'none', boxSizing: 'border-box' };
  const labelStyle = { display: 'block', marginBottom: 5, fontWeight: 600, fontSize: 13, color: '#374151' };

  // ---- Render ----
  return (
    <div className="card" style={{ padding: 24, position: 'relative' }}>

      {/* Toast notifications */}
      {toasts.length > 0 && (
        <div style={{ position: 'fixed', top: 20, right: 20, zIndex: 9999, display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 380 }}>
          {toasts.map(n => (
            <div key={n.id} style={{
              background: n.type === 'error' ? '#fee2e2' : '#d1fae5',
              color: n.type === 'error' ? '#b91c1c' : '#065f46',
              padding: '12px 16px', borderRadius: 12,
              boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
              borderLeft: `4px solid ${n.type === 'error' ? '#ef4444' : '#10b981'}`,
              fontSize: 14, fontWeight: 500, animation: 'slideIn 0.3s ease-out',
            }}>
              <i className={`fas ${n.type === 'error' ? 'fa-exclamation-circle' : 'fa-check-circle'}`} style={{ marginRight: 8 }} />
              {n.message}
            </div>
          ))}
        </div>
      )}

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h3 style={{ fontSize: 22, fontWeight: 800, color: '#1f2937', display: 'flex', alignItems: 'center', gap: 10, margin: 0 }}>
            <i className="fas fa-heart" style={{ color: '#ef4444' }} /> Breeding & Farrowing Manager
          </h3>
          <p style={{ color: '#6b7280', fontSize: 13, margin: '4px 0 0' }}>
            {activePigsCount} active pigs · {breedings.length} mating records · {weanings.length} weanings
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <button onClick={openAddPigModal} style={{ background: 'linear-gradient(135deg,#10b981,#059669)', color: 'white', border: 'none', borderRadius: 8, padding: '7px 16px', cursor: 'pointer', fontWeight: 700, fontSize: 14, display: 'flex', alignItems: 'center', gap: 6, boxShadow: '0 4px 12px rgba(16,185,129,0.3)' }}>
            <i className="fas fa-plus" /> Add Pig
          </button>
          <button onClick={loadData} disabled={loading} style={{ background: '#f3f4f6', border: 'none', borderRadius: 8, padding: '7px 14px', cursor: loading ? 'not-allowed' : 'pointer', fontSize: 13 }}>
            <i className={`fas fa-sync-alt ${loading ? 'fa-spin' : ''}`} style={{ marginRight: 6 }} /> Refresh
          </button>
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div style={{ background: '#fff7ed', border: '1px solid #fed7aa', padding: '10px 14px', borderRadius: 10, marginBottom: 16, color: '#c2410c', fontSize: 14, display: 'flex', alignItems: 'center', gap: 10 }}>
          <i className="fas fa-exclamation-triangle" />
          <span>{error}</span>
          <button onClick={loadData} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: '#c2410c', textDecoration: 'underline', cursor: 'pointer', fontSize: 13 }}>Retry</button>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 60, gap: 14, color: '#6b7280' }}>
          <i className="fas fa-spinner fa-spin" style={{ fontSize: 28, color: '#10b981' }} />
          <span style={{ fontSize: 16 }}>Loading breeding data…</span>
        </div>
      )}

      {!loading && (
        <>
          {/* Tabs */}
          <div style={{ display: 'flex', gap: 4, marginBottom: 24, borderBottom: '2px solid #e5e7eb', flexWrap: 'wrap' }}>
            {[
              { key: 'herd', icon: 'fa-piggy-bank', label: 'Pig Herd', badge: activePigsCount },
              { key: 'mating', icon: 'fa-venus-mars', label: 'Mating Planner', badge: breedings.filter(b => b.status === 'Scheduled' || b.status === 'Confirmed').length },
              { key: 'farrowing', icon: 'fa-baby', label: 'Farrowing', badge: farrowingsDueSoon.length },
              { key: 'weaning', icon: 'fa-seedling', label: 'Weaning', badge: weaningsDueSoon.length },

            ].map(tab => (
              <button key={tab.key} onClick={() => setActiveTab(tab.key)} style={{
                padding: '9px 18px', fontSize: 14,
                background: activeTab === tab.key ? '#10b981' : 'transparent',
                color: activeTab === tab.key ? 'white' : '#4b5563',
                border: 'none', borderRadius: '8px 8px 0 0', cursor: 'pointer',
                fontWeight: activeTab === tab.key ? 700 : 500, transition: 'all 0.2s',
                display: 'flex', alignItems: 'center', gap: 7,
              }}>
                <i className={`fas ${tab.icon}`} /> {tab.label}
                {tab.badge > 0 && (
                  <span style={{ background: activeTab === tab.key ? 'rgba(255,255,255,0.3)' : '#ef4444', color: 'white', borderRadius: 999, padding: '1px 7px', fontSize: 11, fontWeight: 700 }}>
                    {tab.badge}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* ===== TAB: PIG HERD ===== */}
          {activeTab === 'herd' && (
            <div>
              {/* Filter Bar */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 16, alignItems: 'center', background: '#f9fafb', padding: 12, borderRadius: 10, border: '1px solid #e5e7eb' }}>
                <input type="text" placeholder="🔍 Search tag or name…" value={filterTag} onChange={e => setFilterTag(e.target.value)} style={{ padding: '7px 12px', borderRadius: 8, border: '1px solid #d1d5db', fontSize: 14, minWidth: 180 }} />
                <select value={filterGender} onChange={e => setFilterGender(e.target.value)} style={{ padding: '7px 10px', borderRadius: 8, border: '1px solid #d1d5db', fontSize: 14 }}>
                  <option value="all">All genders</option>
                  <option value="male">♂ Male</option>
                  <option value="female">♀ Female</option>
                </select>
                <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} style={{ padding: '7px 10px', borderRadius: 8, border: '1px solid #d1d5db', fontSize: 14 }}>
                  <option value="all">All status</option>
                  <option value="active">Active</option>
                  <option value="sold">Sold</option>
                  <option value="deceased">Deceased</option>
                </select>
                <select value={filterReproStatus} onChange={e => setFilterReproStatus(e.target.value)} style={{ padding: '7px 10px', borderRadius: 8, border: '1px solid #d1d5db', fontSize: 14 }}>
                  <option value="all">All roles / status</option>
                  <option value="Open">Sow (Open)</option>
                  <option value="Pregnant">Sow (Pregnant)</option>
                  <option value="Lactating">Sow (Lactating)</option>
                  <option value="Dry">Sow (Dry)</option>
                  <option value="Boar">Boar</option>
                  <option value="Fattener">Fattener</option>
                  <option value="Piglet">Piglet</option>
                </select>
                <button onClick={() => { setFilterTag(''); setFilterGender('all'); setFilterStatus('all'); setFilterReproStatus('all'); }} style={{ background: '#e5e7eb', border: 'none', padding: '7px 12px', borderRadius: 8, cursor: 'pointer', fontSize: 13 }}>
                  <i className="fas fa-times" style={{ marginRight: 4 }} />Clear
                </button>
                <span style={{ fontSize: 13, color: '#6b7280', marginLeft: 'auto' }}>{filteredPigs.length} pig{filteredPigs.length !== 1 ? 's' : ''}</span>
              </div>

              <div style={{ overflowX: 'auto', border: '1px solid #e5e7eb', borderRadius: 12 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead style={{ background: 'linear-gradient(135deg,#f8fafc,#f1f5f9)' }}>
                    <tr>
                      {['Tag', 'Name', 'Gender', 'Breed', ' Status', 'Weight', 'Availability', 'Actions'].map(h => (
                        <th key={h} style={{ ...thStyle, textAlign: h === 'Actions' ? 'center' : 'left' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredPigs.map(p => (
                      <tr key={p.id} style={{ borderBottom: '1px solid #f3f4f6' }}
                        onMouseEnter={e => e.currentTarget.style.background = '#f9fafb'}
                        onMouseLeave={e => e.currentTarget.style.background = 'white'}
                      >
                        <td style={tdStyle}><strong style={{ color: '#1f2937' }}>{p.tag}</strong></td>
                        <td style={tdStyle}>{p.name || <span style={{ color: '#9ca3af' }}>—</span>}</td>
                        <td style={tdStyle}>
                          <Pill label={p.gender === 'female' ? '♀ Female' : '♂ Male'}
                            bg={p.gender === 'female' ? '#fce7f3' : '#eff6ff'}
                            color={p.gender === 'female' ? '#be185d' : '#1e40af'} />
                        </td>
                        <td style={tdStyle}>{p.breed || '—'}</td>
                        <td style={tdStyle}>
                          {p.reproductive_status
                            ? <Pill label={p.reproductive_status} bg="#fce7f3" color="#9d174d" />
                            : <span style={{ color: '#9ca3af' }}>—</span>}
                        </td>
                        <td style={tdStyle}>{p.weight_kg != null ? `${p.weight_kg} kg` : '—'}</td>
                        <td style={tdStyle}>
                          <Pill label={p.status}
                            bg={p.status === 'active' ? '#d1fae5' : p.status === 'sold' ? '#fef3c7' : '#fee2e2'}
                            color={p.status === 'active' ? '#065f46' : p.status === 'sold' ? '#92400e' : '#991b1b'} />
                        </td>
                        <td style={{ ...tdStyle, textAlign: 'center' }}>
                          <div style={{ display: 'flex', gap: 6, justifyContent: 'center' }}>
                            <button onClick={() => openEditPigModal(p)} style={{ background: '#e0e7ff', border: 'none', padding: '5px 9px', borderRadius: 8, cursor: 'pointer' }} title="Edit">
                              <i className="fas fa-pen" style={{ color: '#4f46e5', fontSize: 12 }} />
                            </button>
                            <button onClick={() => handleDeletePig(p)} style={{ background: '#fee2e2', border: 'none', padding: '5px 9px', borderRadius: 8, cursor: 'pointer' }} title="Delete">
                              <i className="fas fa-trash-alt" style={{ color: '#dc2626', fontSize: 12 }} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                    {filteredPigs.length === 0 && (
                      <tr><td colSpan={8} style={{ textAlign: 'center', padding: 32, color: '#9ca3af' }}>
                        <i className="fas fa-piggy-bank" style={{ fontSize: 32, display: 'block', marginBottom: 8 }} />
                        {pigs.length === 0 ? 'No pigs yet. Click "Add Pig" to start.' : 'No pigs match the current filters.'}
                      </td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ===== TAB: MATING PLANNER ===== */}
          {activeTab === 'mating' && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <div>
                  <h4 style={{ fontWeight: 800, fontSize: 18, color: '#374151', margin: 0 }}>
                    <i className="fas fa-venus-mars" style={{ color: '#a855f7', marginRight: 8 }} />Mating Records
                  </h4>
                  <p style={{ color: '#6b7280', fontSize: 13, margin: '4px 0 0' }}>Expected farrow date is automatically calculated (115 days after mating).</p>
                </div>
                <button onClick={() => openMatingForm()} style={{ background: 'linear-gradient(135deg,#a855f7,#9333ea)', color: 'white', border: 'none', borderRadius: 10, padding: '8px 18px', cursor: 'pointer', fontWeight: 700, fontSize: 14, display: 'flex', alignItems: 'center', gap: 7, boxShadow: '0 4px 12px rgba(168,85,247,0.3)' }}>
                  <i className="fas fa-plus" /> New Mating
                </button>
              </div>

              {/* Mating Form */}
              {showMatingForm && (
                <div style={{ background: 'linear-gradient(135deg,#f0fdf4,#f5f3ff)', padding: 20, borderRadius: 16, marginBottom: 20, border: '1.5px solid #bbf7d0', boxShadow: '0 4px 12px rgba(0,0,0,0.06)' }}>
                  <h4 style={{ marginBottom: 16, fontSize: 16, fontWeight: 700, color: '#1f2937' }}>
                    {editingMating ? '✏️ Edit Mating Record' : '➕ New Mating Record'}
                  </h4>
                  <form onSubmit={handleMatingSubmit}>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px,1fr))', gap: 16, marginBottom: 12 }}>
                      <div>
                        <label style={labelStyle}>Select Sow <span style={{ color: '#ef4444' }}>*</span></label>
                        <div style={{ display: 'flex', gap: 8 }}>
                          <select value={matingForm.pig_id} onChange={e => setMatingForm({ ...matingForm, pig_id: e.target.value })} style={{ ...inputStyle, flex: 1 }} required>
                            <option value="">— Choose a sow —</option>
                            {sowOptions.map(pig => (
                              <option key={pig.id} value={pig.id}>
                                {pig.tag}{pig.name ? ` – ${pig.name}` : ''} ({pig.reproductive_status || 'Open'})
                              </option>
                            ))}
                          </select>
                          <button type="button" onClick={() => setShowQuickSow(v => !v)} style={{ background: '#3b82f6', color: 'white', border: 'none', borderRadius: 8, padding: '0 12px', cursor: 'pointer', whiteSpace: 'nowrap', fontSize: 13 }}>
                            <i className="fas fa-plus" style={{ marginRight: 4 }} />New Sow
                          </button>
                        </div>
                        {sowOptions.length === 0 && <small style={{ color: '#9ca3af', fontSize: 12 }}>No active sows. Click "New Sow" to add one.</small>}
                      </div>
                      <div>
                        <label style={labelStyle}>Mating Date <span style={{ color: '#ef4444' }}>*</span></label>
                        <input type="date" value={matingForm.mating_date} onChange={e => setMatingForm({ ...matingForm, mating_date: e.target.value })} style={inputStyle} required />
                      </div>
                    </div>

                    {/* Quick Sow sub-form */}
                    {showQuickSow && (
                      <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 12, padding: 16, marginBottom: 14 }}>
                        <h5 style={{ fontWeight: 700, marginBottom: 10, color: '#1e40af' }}><i className="fas fa-piggy-bank" style={{ marginRight: 6 }} />Quick Add Sow</h5>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))', gap: 10 }}>
                          <div>
                            <label style={labelStyle}>Tag <span style={{ color: '#ef4444' }}>*</span></label>
                            <input type="text" placeholder="e.g., SOW-01" value={quickSow.tag} onChange={e => setQuickSow({ ...quickSow, tag: e.target.value })} style={inputStyle} />
                          </div>
                          <div>
                            <label style={labelStyle}>Name</label>
                            <input type="text" placeholder="Optional" value={quickSow.name} onChange={e => setQuickSow({ ...quickSow, name: e.target.value })} style={inputStyle} />
                          </div>
                          <div>
                            <label style={labelStyle}>Weight (kg)</label>
                            <input type="number" step="0.1" placeholder="e.g., 90" value={quickSow.weight_kg} onChange={e => setQuickSow({ ...quickSow, weight_kg: e.target.value })} style={inputStyle} />
                          </div>
                        </div>
                        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
                          <button type="button" onClick={() => setShowQuickSow(false)} style={{ background: '#9ca3af', padding: '5px 14px', borderRadius: 8, border: 'none', color: 'white', cursor: 'pointer' }}>Cancel</button>
                          <button type="button" onClick={handleQuickSow} disabled={addingQuickSow} style={{ background: '#3b82f6', padding: '5px 14px', borderRadius: 8, border: 'none', color: 'white', cursor: 'pointer' }}>
                            {addingQuickSow ? <><i className="fas fa-spinner fa-spin" style={{ marginRight: 6 }} />Adding…</> : 'Add Sow'}
                          </button>
                        </div>
                      </div>
                    )}

                    {matingForm.mating_date && (
                      <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, padding: '8px 14px', marginBottom: 12, fontSize: 13, color: '#065f46' }}>
                        <i className="fas fa-calendar-check" style={{ marginRight: 6 }} />
                        Expected farrow date: <strong>{fmtDate(calculateExpectedFarrow(matingForm.mating_date))}</strong> (115 days)
                      </div>
                    )}

                    <div style={{ marginBottom: 16 }}>
                      <label style={labelStyle}>Notes (optional)</label>
                      <textarea value={matingForm.notes} onChange={e => setMatingForm({ ...matingForm, notes: e.target.value })} placeholder="e.g., Boar used, method (AI/natural), observations…" rows={2} style={{ ...inputStyle, resize: 'vertical' }} />
                    </div>

                    <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                      <button type="button" onClick={closeMatingForm} disabled={submittingMating} style={{ background: '#e5e7eb', padding: '8px 20px', borderRadius: 8, border: 'none', color: '#374151', fontWeight: 600, cursor: 'pointer' }}>Cancel</button>
                      <button type="submit" disabled={submittingMating} style={{ background: submittingMating ? '#9ca3af' : 'linear-gradient(135deg,#a855f7,#9333ea)', padding: '8px 24px', borderRadius: 8, border: 'none', color: 'white', fontWeight: 700, cursor: submittingMating ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: 7 }}>
                        {submittingMating ? <><i className="fas fa-spinner fa-spin" />Saving…</> : <><i className="fas fa-save" />{editingMating ? 'Update' : 'Save Mating'}</>}
                      </button>
                    </div>
                  </form>
                </div>
              )}

              {/* Mating Records Table */}
              {breedings.length === 0 ? (
                <div style={{ textAlign: 'center', color: '#9ca3af', padding: 48, border: '2px dashed #e5e7eb', borderRadius: 16 }}>
                  <i className="fas fa-venus-mars" style={{ fontSize: 40, display: 'block', marginBottom: 12 }} />
                  No mating records yet. Click <strong>"New Mating"</strong> to add one.
                </div>
              ) : (
                <div style={{ overflowX: 'auto', border: '1px solid #e5e7eb', borderRadius: 12 }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
                    <thead style={{ background: 'linear-gradient(135deg,#faf5ff,#f5f3ff)' }}>
                      <tr>
                        {['Sow', 'Mating Date', 'Exp. Farrow', 'Days Until', 'Status', 'Litter', 'Notes', 'Actions'].map(h => (
                          <th key={h} style={{ ...thStyle, textAlign: h === 'Actions' ? 'center' : 'left' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {breedings.slice().sort((a, b) => new Date(b.mating_date) - new Date(a.mating_date)).map(b => {
                        const daysLeft = daysUntil(b.expected_farrow);
                        const sc = statusColors[b.status] || { bg: '#f3f4f6', color: '#374151' };
                        const isDueSoon = daysLeft !== null && daysLeft >= 0 && daysLeft <= 7 && b.status !== 'Farrowed' && b.status !== 'Weaned' && b.status !== 'Aborted';
                        return (
                          <tr key={b.id}
                            style={{ borderBottom: '1px solid #f3f4f6', background: isDueSoon ? '#fffbeb' : 'white', transition: 'background 0.15s' }}
                            onMouseEnter={e => e.currentTarget.style.background = isDueSoon ? '#fef3c7' : '#fafafa'}
                            onMouseLeave={e => e.currentTarget.style.background = isDueSoon ? '#fffbeb' : 'white'}
                          >
                            <td style={tdStyle}><strong>{getPigInfo(b.pig_id)}</strong></td>
                            <td style={tdStyle}>{fmtDate(b.mating_date)}</td>
                            <td style={tdStyle}>{fmtDate(b.expected_farrow)}</td>
                            <td style={tdStyle}>
                              {b.status === 'Farrowed' || b.status === 'Weaned' || b.status === 'Aborted'
                                ? <span style={{ color: '#9ca3af', fontSize: 12 }}>—</span>
                                : daysLeft !== null
                                  ? <span style={{ fontWeight: 700, color: daysLeft <= 0 ? '#dc2626' : daysLeft <= 7 ? '#d97706' : daysLeft <= 14 ? '#f59e0b' : '#059669' }}>
                                    {daysLeft <= 0 ? '⚠️ Overdue' : `${daysLeft}d`}
                                  </span>
                                  : '—'}
                            </td>
                            <td style={tdStyle}>
                              <select
                                value={b.status}
                                onChange={e => updateMatingStatus(b.id, e.target.value)}
                                disabled={updatingStatusId === b.id}
                                style={{ background: sc.bg, color: sc.color, padding: '4px 10px', borderRadius: 999, border: 'none', fontSize: 12, fontWeight: 700, cursor: 'pointer', minWidth: 105, opacity: updatingStatusId === b.id ? 0.6 : 1 }}
                              >
                                <option value="Scheduled">Scheduled</option>
                                <option value="Confirmed">Confirmed</option>
                                <option value="Farrowed">Farrowed</option>
                                <option value="Weaned">Weaned</option>
                                <option value="Aborted">Aborted</option>
                              </select>
                            </td>
                            <td style={tdStyle}>
                              {b.litter_size != null
                                ? <span>{b.litter_size} <span style={{ color: '#9ca3af', fontSize: 11 }}>(sb:{b.stillborn ?? 0})</span></span>
                                : <span style={{ color: '#9ca3af' }}>—</span>}
                            </td>
                            <td style={{ ...tdStyle, maxWidth: 160 }}>
                              <span style={{ fontSize: 12, color: '#6b7280', wordBreak: 'break-word' }}>{b.notes || '—'}</span>
                            </td>
                            <td style={{ ...tdStyle, textAlign: 'center' }}>
                              <div style={{ display: 'flex', gap: 5, justifyContent: 'center' }}>
                                <button onClick={() => openMatingForm(b)} style={{ background: '#e0e7ff', border: 'none', padding: '5px 8px', borderRadius: 7, cursor: 'pointer' }} title="Edit">
                                  <i className="fas fa-pen" style={{ color: '#4f46e5', fontSize: 12 }} />
                                </button>
                                {(b.status === 'Confirmed' || b.status === 'Scheduled') && (
                                  <button onClick={() => openFarrowModal(b)} style={{ background: '#dcfce7', border: 'none', padding: '5px 8px', borderRadius: 7, cursor: 'pointer' }} title="Record Farrow">
                                    <i className="fas fa-baby" style={{ color: '#16a34a', fontSize: 12 }} />
                                  </button>
                                )}
                                {b.status === 'Farrowed' && (
                                  <button onClick={() => openWeanModal(b)} style={{ background: '#f5f3ff', border: 'none', padding: '5px 8px', borderRadius: 7, cursor: 'pointer' }} title="Record Weaning">
                                    <i className="fas fa-seedling" style={{ color: '#7c3aed', fontSize: 12 }} />
                                  </button>
                                )}
                                <button onClick={() => deleteMating(b.id)} style={{ background: '#fee2e2', border: 'none', padding: '5px 8px', borderRadius: 7, cursor: 'pointer' }} title="Delete">
                                  <i className="fas fa-trash-alt" style={{ color: '#dc2626', fontSize: 12 }} />
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* ===== TAB: FARROWING ===== */}
          {activeTab === 'farrowing' && (
            <div>
              {/* Due soon alert */}
              {farrowingsDueSoon.length > 0 && (
                <div style={{ background: '#fffbeb', border: '1px solid #f59e0b', borderRadius: 12, padding: 16, marginBottom: 20 }}>
                  <h4 style={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8, color: '#92400e', marginBottom: 10 }}>
                    <i className="fas fa-exclamation-triangle" style={{ color: '#d97706' }} /> Due in next 7 days
                  </h4>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {farrowingsDueSoon.map(b => {
                      const days = daysUntil(b.expected_farrow);
                      const pig = pigs.find(p => p.id === b.pig_id);
                      return (
                        <div key={b.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'white', padding: '8px 14px', borderRadius: 8, border: '1px solid #fde68a' }}>
                          <span><strong>{pig?.tag ?? '?'}</strong> {pig?.name ? `– ${pig.name}` : ''} · Expected: <strong>{fmtDate(b.expected_farrow)}</strong> ({days}d)</span>
                          <button onClick={() => openFarrowModal(b)} style={{ background: '#10b981', color: 'white', border: 'none', borderRadius: 8, padding: '5px 14px', cursor: 'pointer', fontWeight: 700, fontSize: 13 }}>
                            <i className="fas fa-check" style={{ marginRight: 5 }} />Record
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              <h4 style={{ fontWeight: 700, fontSize: 17, marginBottom: 12 }}><i className="fas fa-clock" style={{ marginRight: 8, color: '#f59e0b' }} />Upcoming Farrowings ({upcomingFarrowings.length})</h4>
              {upcomingFarrowings.length === 0 ? (
                <p style={{ color: '#6b7280', marginBottom: 24 }}>No upcoming farrowings scheduled.</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 24 }}>
                  {upcomingFarrowings.map(b => {
                    const pig = pigs.find(p => p.id === b.pig_id);
                    const days = daysUntil(b.expected_farrow);
                    return (
                      <div key={b.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#f9fafb', padding: '12px 16px', borderRadius: 12, border: '1px solid #e5e7eb', flexWrap: 'wrap', gap: 8 }}>
                        <div>
                          <strong>{pig?.tag ?? '?'} {pig?.name ? `– ${pig.name}` : ''}</strong>
                          <div style={{ fontSize: 13, color: '#4b5563', marginTop: 2 }}>
                            Expected: <strong>{fmtDate(b.expected_farrow)}</strong>
                            {' · '}
                            <span style={{ color: days != null && days <= 0 ? '#dc2626' : days != null && days <= 7 ? '#d97706' : '#059669', fontWeight: 700 }}>
                              {days != null ? (days <= 0 ? '⚠️ Overdue' : `${days} days left`) : '—'}
                            </span>
                            {b.notes && <span style={{ marginLeft: 10, fontSize: 12, color: '#9ca3af' }}>{b.notes}</span>}
                          </div>
                        </div>
                        <button onClick={() => openFarrowModal(b)} style={{ background: '#10b981', color: 'white', border: 'none', borderRadius: 8, padding: '7px 16px', cursor: 'pointer', fontWeight: 700, fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
                          <i className="fas fa-baby" />Record Farrow
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}

              <h4 style={{ fontWeight: 700, fontSize: 17, marginBottom: 12 }}><i className="fas fa-history" style={{ marginRight: 8, color: '#6366f1' }} />Recent Farrowings ({recentFarrowings.length})</h4>
              {recentFarrowings.length === 0 ? (
                <p style={{ color: '#6b7280' }}>No farrowings recorded yet.</p>
              ) : (
                <div style={{ overflowX: 'auto', border: '1px solid #e5e7eb', borderRadius: 12 }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
                    <thead style={{ background: 'linear-gradient(135deg,#f0fdf4,#dcfce7)' }}>
                      <tr>
                        {['Sow', 'Farrowed', 'Litter', 'Live', 'Status', 'Actions'].map(h => (
                          <th key={h} style={{ ...thStyle, textAlign: h === 'Actions' ? 'center' : 'left' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {recentFarrowings.map(b => {
                        const pig = pigs.find(p => p.id === b.pig_id);
                        const sc = statusColors[b.status] || { bg: '#f3f4f6', color: '#374151' };
                        return (
                          <tr key={b.id} style={{ borderBottom: '1px solid #f3f4f6' }}
                            onMouseEnter={e => e.currentTarget.style.background = '#f9fafb'}
                            onMouseLeave={e => e.currentTarget.style.background = 'white'}
                          >
                            <td style={tdStyle}><strong>{pig?.tag ?? '?'} {pig?.name ? `– ${pig.name}` : ''}</strong></td>
                            <td style={tdStyle}>{fmtDate(b.actual_farrowing_date)}</td>
                            <td style={tdStyle}>{b.litter_size ?? '—'} <span style={{ color: '#9ca3af', fontSize: 11 }}>(sb:{b.stillborn ?? 0})</span></td>
                            <td style={tdStyle}>{b.litter_size != null ? b.litter_size - (b.stillborn || 0) : '—'}</td>
                            <td style={tdStyle}><Pill label={b.status} bg={sc.bg} color={sc.color} /></td>
                            <td style={{ ...tdStyle, textAlign: 'center' }}>
                              {b.status === 'Farrowed' && (
                                <button onClick={() => openWeanModal(b)} style={{ background: 'linear-gradient(135deg,#8b5cf6,#7c3aed)', color: 'white', border: 'none', borderRadius: 8, padding: '5px 14px', cursor: 'pointer', fontWeight: 700, fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                                  <i className="fas fa-seedling" />Wean
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* ===== TAB: WEANING ===== */}
          {activeTab === 'weaning' && (
            <div>
              {/* Due soon alert */}
              {weaningsDueSoon.length > 0 && (
                <div style={{ background: '#faf5ff', border: '1px solid #c4b5fd', borderRadius: 12, padding: 16, marginBottom: 20 }}>
                  <h4 style={{ fontWeight: 700, color: '#6d28d9', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <i className="fas fa-bell" />Weaning Due Soon
                  </h4>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {weaningsDueSoon.map(b => {
                      const pig = pigs.find(p => p.id === b.pig_id);
                      const expWean = calculateExpectedWeaning(b.actual_farrowing_date);
                      const days = daysUntil(expWean);
                      return (
                        <div key={b.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'white', padding: '8px 14px', borderRadius: 8, border: '1px solid #e9d5ff' }}>
                          <div>
                            <strong>{pig?.tag ?? '?'} {pig?.name ? `– ${pig.name}` : ''}</strong>
                            <span style={{ marginLeft: 10, fontSize: 13, color: days != null && days <= 0 ? '#dc2626' : '#7c3aed', fontWeight: 600 }}>
                              {days != null && days <= 0 ? '⚠️ Overdue' : `Due in ${days}d`} · Expected: {fmtDate(expWean)}
                            </span>
                          </div>
                          <button onClick={() => openWeanModal(b)} style={{ background: '#8b5cf6', color: 'white', border: 'none', borderRadius: 8, padding: '5px 14px', cursor: 'pointer', fontWeight: 700, fontSize: 13 }}>
                            <i className="fas fa-seedling" style={{ marginRight: 5 }} />Wean Now
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Lactating sows table */}
              <h4 style={{ fontWeight: 700, fontSize: 17, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
                <i className="fas fa-baby" style={{ color: '#8b5cf6' }} />Lactating Sows ({lactatingBreedings.length})
              </h4>
              {lactatingBreedings.length === 0 ? (
                <div style={{ textAlign: 'center', color: '#9ca3af', padding: 32, border: '2px dashed #e5e7eb', borderRadius: 12, marginBottom: 24 }}>
                  <i className="fas fa-seedling" style={{ fontSize: 32, display: 'block', marginBottom: 8 }} />
                  No lactating sows. Sows appear here after farrowing is recorded.
                </div>
              ) : (
                <div style={{ overflowX: 'auto', border: '1px solid #e5e7eb', borderRadius: 12, marginBottom: 24 }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
                    <thead style={{ background: 'linear-gradient(135deg,#faf5ff,#f5f3ff)' }}>
                      <tr>
                        {['Sow', 'Farrowed', 'Litter', 'Live', 'Exp. Weaning', 'Days Lactating', 'Action'].map(h => (
                          <th key={h} style={{ ...thStyle, textAlign: h === 'Action' ? 'center' : 'left' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {lactatingBreedings.map(b => {
                        const pig = pigs.find(p => p.id === b.pig_id);
                        const expWean = calculateExpectedWeaning(b.actual_farrowing_date);
                        const daysLeft = daysUntil(expWean);
                        const daysLact = daysSince(b.actual_farrowing_date);
                        const isOverdue = daysLeft !== null && daysLeft < 0;
                        return (
                          <tr key={b.id} style={{ borderBottom: '1px solid #f3f4f6', background: isOverdue ? '#fdf4ff' : 'white' }}
                            onMouseEnter={e => e.currentTarget.style.background = '#f5f3ff'}
                            onMouseLeave={e => e.currentTarget.style.background = isOverdue ? '#fdf4ff' : 'white'}
                          >
                            <td style={tdStyle}><strong>{pig?.tag ?? '?'} {pig?.name ? `– ${pig.name}` : ''}</strong></td>
                            <td style={tdStyle}>{fmtDate(b.actual_farrowing_date)}</td>
                            <td style={tdStyle}>{b.litter_size ?? '—'}</td>
                            <td style={tdStyle}>{b.litter_size != null ? b.litter_size - (b.stillborn || 0) : '—'}</td>
                            <td style={tdStyle}>
                              <span style={{ color: isOverdue ? '#dc2626' : daysLeft != null && daysLeft <= 3 ? '#d97706' : '#059669', fontWeight: 700 }}>
                                {fmtDate(expWean)}
                              </span>
                            </td>
                            <td style={tdStyle}>
                              <span style={{ fontWeight: 700, color: daysLact != null && daysLact > 28 ? '#dc2626' : '#374151' }}>
                                {daysLact != null ? `${daysLact}d` : '—'}
                              </span>
                            </td>
                            <td style={{ ...tdStyle, textAlign: 'center' }}>
                              <button onClick={() => openWeanModal(b)} style={{ background: 'linear-gradient(135deg,#8b5cf6,#7c3aed)', color: 'white', border: 'none', padding: '6px 14px', borderRadius: 8, cursor: 'pointer', fontWeight: 700, fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                                <i className="fas fa-seedling" />Wean
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Weaning history */}
              <h4 style={{ fontWeight: 700, fontSize: 17, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
                <i className="fas fa-history" style={{ color: '#8b5cf6' }} />Weaning Records
                <span style={{ fontSize: 13, color: '#6b7280', fontWeight: 400 }}>({weanings.length} total)</span>
              </h4>
              {weanings.length === 0 ? (
                <div style={{ textAlign: 'center', color: '#9ca3af', padding: 24, border: '2px dashed #e5e7eb', borderRadius: 12 }}>No weaning records yet.</div>
              ) : (
                <div style={{ overflowX: 'auto', border: '1px solid #e5e7eb', borderRadius: 12 }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
                    <thead style={{ background: 'linear-gradient(135deg,#faf5ff,#f5f3ff)' }}>
                      <tr>
                        {['Sow', 'Weaning Date', 'Piglets Weaned', 'Avg Weight', 'Notes', 'Actions'].map(h => (
                          <th key={h} style={{ ...thStyle, textAlign: h === 'Actions' ? 'center' : 'left' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {weanings.slice().sort((a, b) => new Date(b.weaning_date) - new Date(a.weaning_date)).map(w => (
                        <tr key={w.id} style={{ borderBottom: '1px solid #f3f4f6' }}
                          onMouseEnter={e => e.currentTarget.style.background = '#faf5ff'}
                          onMouseLeave={e => e.currentTarget.style.background = 'white'}
                        >
                          <td style={tdStyle}><strong>{getPigInfo(w.pig_id)}</strong></td>
                          <td style={tdStyle}>{fmtDate(w.weaning_date)}</td>
                          <td style={tdStyle}><Pill label={w.piglets_weaned} bg="#e9d5ff" color="#6b21a8" /></td>
                          <td style={tdStyle}>{w.avg_weight_kg != null ? `${w.avg_weight_kg} kg` : '—'}</td>
                          <td style={{ ...tdStyle, maxWidth: 180 }}><span style={{ fontSize: 12, color: '#6b7280' }}>{w.notes || '—'}</span></td>
                          <td style={{ ...tdStyle, textAlign: 'center' }}>
                            <button onClick={() => deleteWeaning(w.id)} style={{ background: '#fee2e2', border: 'none', padding: '5px 9px', borderRadius: 8, cursor: 'pointer' }} title="Delete">
                              <i className="fas fa-trash-alt" style={{ color: '#dc2626', fontSize: 12 }} />
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

        </>
      )}

      {/* ===== ADD/EDIT PIG MODAL ===== */}
      {showAddPigModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20 }} onClick={() => setShowAddPigModal(false)}>
          <div style={{ background: 'white', padding: 32, borderRadius: 24, width: '100%', maxWidth: 680, maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 25px 50px rgba(0,0,0,0.3)', position: 'relative' }} onClick={e => e.stopPropagation()}>
            <button onClick={() => setShowAddPigModal(false)} style={{ position: 'absolute', top: 16, right: 18, background: 'none', border: 'none', fontSize: 22, color: '#9ca3af', cursor: 'pointer' }}>
              <i className="fas fa-times" />
            </button>
            <h3 style={{ marginBottom: 24, fontSize: 22, fontWeight: 800, color: '#1f2937', display: 'flex', alignItems: 'center', gap: 10 }}>
              <i className="fas fa-piggy-bank" style={{ color: '#10b981' }} />
              {editingPig ? 'Edit Pig' : 'Add New Pig'}
            </h3>
            <form onSubmit={handleSavePig}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px,1fr))', gap: 16, marginBottom: 24 }}>
                <div>
                  <label style={labelStyle}><i className="fas fa-tag" style={{ marginRight: 5, color: '#6b7280' }} />Tag <span style={{ color: '#ef4444' }}>*</span></label>
                  <input type="text" value={pigFormData.tag} onChange={e => setPigFormData({ ...pigFormData, tag: e.target.value })} required placeholder="e.g., SOW-001" style={inputStyle} />
                </div>
                <div>
                  <label style={labelStyle}><i className="fas fa-pen" style={{ marginRight: 5, color: '#6b7280' }} />Name</label>
                  <input type="text" value={pigFormData.name} onChange={e => setPigFormData({ ...pigFormData, name: e.target.value })} placeholder="e.g., Bella" style={inputStyle} />
                </div>
                <div>
                  <label style={labelStyle}><i className="fas fa-calendar-alt" style={{ marginRight: 5, color: '#6b7280' }} />Birth Date</label>
                  <input type="date" value={pigFormData.birth_date} onChange={e => setPigFormData({ ...pigFormData, birth_date: e.target.value })} style={inputStyle} />
                </div>
                <div>
                  <label style={labelStyle}><i className="fas fa-venus-mars" style={{ marginRight: 5, color: '#6b7280' }} />Gender <span style={{ color: '#ef4444' }}>*</span></label>
                  <select value="female" disabled style={{ ...inputStyle, background: '#f3f4f6', cursor: 'not-allowed' }}>
                    <option value="female">♀ Female</option>
                  </select>
                </div>
                <div>
                  <label style={labelStyle}><i className="fas fa-dna" style={{ marginRight: 5, color: '#6b7280' }} />Breed</label>
                  <select value={pigFormData.breed} onChange={e => setPigFormData({ ...pigFormData, breed: e.target.value })} style={inputStyle}>
                    <option>Landrace</option>
                    <option>Large White</option>
                    <option>Duroc</option>
                    <option>Berkshire</option>
                    <option>Hampshire</option>
                    <option>Yorkshire</option>
                    <option>Pietrain</option>
                    <option>Mixed</option>
                  </select>
                </div>
                <div>
                  <label style={labelStyle}><i className="fas fa-weight" style={{ marginRight: 5, color: '#6b7280' }} />Weight (kg)</label>
                  <input type="number" step="0.1" min="0" value={pigFormData.weight_kg} onChange={e => setPigFormData({ ...pigFormData, weight_kg: e.target.value })} placeholder="e.g., 85.5" style={inputStyle} />
                </div>
                <div>
                  <label style={labelStyle}><i className="fas fa-circle" style={{ marginRight: 5, color: '#6b7280' }} />Status</label>
                  <select value={pigFormData.status} onChange={e => setPigFormData({ ...pigFormData, status: e.target.value })} style={inputStyle}>
                    <option value="active">Active</option>
                    <option value="sold">Sold</option>
                    <option value="deceased">Deceased</option>
                  </select>
                </div>
                <div>
                  <label style={labelStyle}><i className="fas fa-heartbeat" style={{ marginRight: 5, color: '#ec4899' }} />Role / Status</label>
                  <select value={pigFormData.reproductive_status} onChange={e => setPigFormData({ ...pigFormData, reproductive_status: e.target.value })} style={inputStyle}>
                    <option value="Open">Sow (Open)</option>
                    <option value="Pregnant">Sow (Pregnant)</option>
                    <option value="Lactating">Sow (Lactating)</option>
                    <option value="Dry">Sow (Dry)</option>

                    <option value="Fattener">Fattener</option>
                    <option value="Piglet">Piglet</option>
                  </select>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', paddingTop: 16, borderTop: '1px solid #e5e7eb' }}>
                <button type="button" onClick={() => setShowAddPigModal(false)} style={{ padding: '9px 22px', background: '#f3f4f6', border: 'none', borderRadius: 10, color: '#374151', fontWeight: 600, cursor: 'pointer' }}>Cancel</button>
                <button type="submit" disabled={submittingPig} style={{ padding: '9px 28px', background: submittingPig ? '#9ca3af' : 'linear-gradient(135deg,#10b981,#059669)', border: 'none', borderRadius: 10, color: 'white', fontWeight: 700, cursor: submittingPig ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: 7, boxShadow: '0 4px 12px rgba(16,185,129,0.3)' }}>
                  {submittingPig ? <><i className="fas fa-spinner fa-spin" />Saving…</> : <><i className="fas fa-save" />{editingPig ? 'Update Pig' : 'Add Pig'}</>}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ===== FARROW MODAL ===== */}
      {showFarrowModal && farrowBreeding && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20 }} onClick={() => setShowFarrowModal(false)}>
          <div style={{ background: 'white', padding: 32, borderRadius: 24, width: '100%', maxWidth: 480, maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 25px 50px rgba(0,0,0,0.3)', position: 'relative' }} onClick={e => e.stopPropagation()}>
            <button onClick={() => setShowFarrowModal(false)} style={{ position: 'absolute', top: 14, right: 18, background: 'none', border: 'none', fontSize: 22, color: '#9ca3af', cursor: 'pointer' }}>
              <i className="fas fa-times" />
            </button>
            <h3 style={{ marginBottom: 6, fontSize: 22, fontWeight: 800, display: 'flex', alignItems: 'center', gap: 10 }}>
              <i className="fas fa-baby" style={{ color: '#10b981' }} />Record Farrowing
            </h3>
            <div style={{ background: '#f0fdf4', borderRadius: 10, padding: '10px 14px', marginBottom: 20, fontSize: 13, color: '#065f46' }}>
              <strong>Sow:</strong> {getPigInfo(farrowBreeding.pig_id)}<br />
              <strong>Expected farrow:</strong> {farrowBreeding.expected_farrow || '—'}
            </div>
            <form onSubmit={handleFarrowSubmit}>
              {[
                { label: 'Actual Farrow Date *', type: 'date', key: 'actual_farrow_date', required: true },
                { label: 'Total Piglets Born *', type: 'number', key: 'litter_size', placeholder: 'e.g., 10', required: true },
                { label: 'Stillborn', type: 'number', key: 'stillborn', placeholder: '0' },
              ].map(f => (
                <div key={f.key} style={{ marginBottom: 16 }}>
                  <label style={labelStyle}>{f.label}</label>
                  <input type={f.type} min="0" step="1" value={farrowForm[f.key]} onChange={e => setFarrowForm({ ...farrowForm, [f.key]: e.target.value })} placeholder={f.placeholder || ''} required={f.required || false} style={inputStyle} />
                </div>
              ))}
              {farrowForm.litter_size && farrowForm.stillborn !== '' && (
                <div style={{ background: '#f0fdf4', borderRadius: 8, padding: '8px 12px', fontSize: 13, color: '#065f46', marginBottom: 16 }}>
                  Live piglets: <strong>{Math.max(0, parseInt(farrowForm.litter_size) - parseInt(farrowForm.stillborn || 0))}</strong>
                </div>
              )}
              <div style={{ marginBottom: 20 }}>
                <label style={labelStyle}>Notes (optional)</label>
                <textarea rows={2} value={farrowForm.notes} onChange={e => setFarrowForm({ ...farrowForm, notes: e.target.value })} placeholder="Any observations or complications…" style={{ ...inputStyle, resize: 'vertical' }} />
              </div>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button type="button" onClick={() => setShowFarrowModal(false)} style={{ background: '#e5e7eb', padding: '8px 20px', borderRadius: 10, border: 'none', color: '#374151', fontWeight: 600, cursor: 'pointer' }}>Cancel</button>
                <button type="submit" disabled={submittingFarrow} style={{ background: submittingFarrow ? '#9ca3af' : 'linear-gradient(135deg,#10b981,#059669)', padding: '8px 24px', borderRadius: 10, border: 'none', color: 'white', fontWeight: 700, cursor: submittingFarrow ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: 7 }}>
                  {submittingFarrow ? <><i className="fas fa-spinner fa-spin" />Saving…</> : <><i className="fas fa-check" />Record Farrow</>}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ===== WEANING MODAL ===== */}
      {showWeanModal && weanBreeding && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20 }} onClick={() => setShowWeanModal(false)}>
          <div style={{ background: 'white', padding: 32, borderRadius: 24, width: '100%', maxWidth: 480, maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 25px 50px rgba(0,0,0,0.3)', position: 'relative' }} onClick={e => e.stopPropagation()}>
            <button onClick={() => setShowWeanModal(false)} style={{ position: 'absolute', top: 14, right: 18, background: 'none', border: 'none', fontSize: 22, color: '#9ca3af', cursor: 'pointer' }}>
              <i className="fas fa-times" />
            </button>
            <h3 style={{ marginBottom: 6, fontSize: 22, fontWeight: 800, display: 'flex', alignItems: 'center', gap: 10 }}>
              <i className="fas fa-seedling" style={{ color: '#8b5cf6' }} />Record Weaning
            </h3>
            <div style={{ background: '#faf5ff', borderRadius: 10, padding: '10px 14px', marginBottom: 20, fontSize: 13, color: '#6d28d9', border: '1px solid #e9d5ff' }}>
              <strong>Sow:</strong> {getPigInfo(weanBreeding.pig_id)}<br />
              <strong>Farrowed:</strong> {weanBreeding.actual_farrowing_date || '—'}<br />
              <strong>Litter:</strong> {weanBreeding.litter_size ?? '?'} total ({(weanBreeding.litter_size ?? 0) - (weanBreeding.stillborn ?? 0)} live)<br />
              <strong>Expected weaning:</strong> {calculateExpectedWeaning(weanBreeding.actual_farrowing_date) || '—'}
            </div>
            <form onSubmit={handleWeanSubmit}>
              <div style={{ marginBottom: 16 }}>
                <label style={labelStyle}>Weaning Date <span style={{ color: '#ef4444' }}>*</span></label>
                <input type="date" value={weanForm.weaning_date} onChange={e => setWeanForm({ ...weanForm, weaning_date: e.target.value })} required style={{ ...inputStyle, borderColor: '#c4b5fd' }} />
              </div>
              <div style={{ marginBottom: 16 }}>
                <label style={labelStyle}>Piglets Weaned <span style={{ color: '#ef4444' }}>*</span></label>
                <input type="number" min="0" step="1" value={weanForm.piglets_weaned} onChange={e => setWeanForm({ ...weanForm, piglets_weaned: e.target.value })} required placeholder={`Max: ${(weanBreeding.litter_size ?? 0) - (weanBreeding.stillborn ?? 0)}`} style={{ ...inputStyle, borderColor: '#c4b5fd' }} />
              </div>
              <div style={{ marginBottom: 16 }}>
                <label style={labelStyle}>Avg Piglet Weight (kg)</label>
                <input type="number" min="0" step="0.1" value={weanForm.avg_weight_kg} onChange={e => setWeanForm({ ...weanForm, avg_weight_kg: e.target.value })} placeholder="e.g., 6.5" style={{ ...inputStyle, borderColor: '#c4b5fd' }} />
              </div>
              <div style={{ marginBottom: 16 }}>
                <label style={labelStyle}>Notes (optional)</label>
                <textarea rows={2} value={weanForm.notes} onChange={e => setWeanForm({ ...weanForm, notes: e.target.value })} placeholder="Any observations…" style={{ ...inputStyle, borderColor: '#c4b5fd', resize: 'vertical' }} />
              </div>
              <div style={{ background: '#faf5ff', borderRadius: 8, padding: '8px 12px', fontSize: 12, color: '#7c3aed', marginBottom: 16 }}>
                <i className="fas fa-info-circle" style={{ marginRight: 5 }} />After saving, the sow's reproductive status will be set to <strong>Open</strong>.
              </div>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button type="button" onClick={() => setShowWeanModal(false)} style={{ background: '#e5e7eb', padding: '8px 20px', borderRadius: 10, border: 'none', color: '#374151', fontWeight: 600, cursor: 'pointer' }}>Cancel</button>
                <button type="submit" disabled={submittingWean} style={{ background: submittingWean ? '#9ca3af' : 'linear-gradient(135deg,#8b5cf6,#7c3aed)', padding: '8px 24px', borderRadius: 10, border: 'none', color: 'white', fontWeight: 700, cursor: submittingWean ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: 7, boxShadow: '0 4px 12px rgba(139,92,246,0.3)' }}>
                  {submittingWean ? <><i className="fas fa-spinner fa-spin" />Saving…</> : <><i className="fas fa-seedling" />Record Weaning</>}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <style>{`
        @keyframes slideIn { from { opacity:0; transform:translateX(30px); } to { opacity:1; transform:translateX(0); } }
        @keyframes fadeIn  { from { opacity:0; } to { opacity:1; } }
      `}</style>
    </div>
  );
}