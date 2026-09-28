import React from 'react';
import { useSyncStatus } from '../hooks/useSyncStatus';
import Swal from 'sweetalert2';

export const REFRESH_DATA_EVENT = 'refreshAllData';

export default function SyncStatus() {
  const { online, pendingCount: pending, syncing: isSyncing, triggerSync } = useSyncStatus();

  // Manual sync handler (user clicks "Sync Now")
  const handleManualSync = async () => {
    await triggerSync();
    Swal.fire({
      toast: true,
      position: 'top-end',
      icon: 'success',
      title: 'Sync complete',
      showConfirmButton: false,
      timer: 3000,
    });
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 14 }}>
      <span>
        <i
          className={`fas fa-${online ? 'wifi' : 'exclamation-triangle'}`}
          style={{ color: online ? '#10b981' : '#ef4444' }}
        />
        {online ? ' Online' : ' Offline'}
      </span>
      {!online && pending > 0 && (
        <span style={{ background: '#fef3c7', padding: '2px 10px', borderRadius: 999 }}>
          {pending} pending {pending === 1 ? 'change' : 'changes'}
        </span>
      )}
      {isSyncing && (
        <span style={{ color: '#2563eb' }}>
          <i className="fas fa-spinner fa-spin" /> Syncing…
        </span>
      )}
      <button
        onClick={handleManualSync}
        disabled={!online || isSyncing}
        className="btn-secondary"
        style={{
          padding: '4px 12px',
          opacity: !online || isSyncing ? 0.5 : 1,
          cursor: !online || isSyncing ? 'not-allowed' : 'pointer',
        }}
      >
        <i className="fas fa-sync-alt" /> Sync Now
      </button>
    </div>
  );
}