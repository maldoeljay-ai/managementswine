import { useState, useEffect } from 'react';
import { isOnline, getPendingCount, syncAll } from '../lib/sync';

// --- GLOBAL STATE ---
let globalState = {
  online: isOnline(),
  pendingCount: 0,
  syncing: false,
  lastSynced: null,
};
const listeners = new Set();
let intervalsStarted = false;

function notify() {
  for (const listener of listeners) {
    listener(globalState);
  }
}

async function refreshPendingGlobal() {
  try {
    const count = await getPendingCount();
    if (globalState.pendingCount !== count) {
      globalState = { ...globalState, pendingCount: count };
      notify();
    }
  } catch (_) { /* ignore */ }
}

async function triggerSyncGlobal() {
  // Use native navigator.onLine to avoid being blocked by slow checkConnectivity() probes
  if (typeof navigator !== 'undefined' && !navigator.onLine) return;
  if (globalState.syncing) return;
  
  globalState = { ...globalState, syncing: true };
  notify();

  try {
    await syncAll();
    globalState = { ...globalState, lastSynced: new Date() };
    window.dispatchEvent(new CustomEvent('refreshAllData'));
  } catch (err) {
    console.error('Sync failed:', err);
  } finally {
    await refreshPendingGlobal();
    globalState = { ...globalState, syncing: false };
    notify();
  }
}

function startGlobalIntervals() {
  if (intervalsStarted) return;
  intervalsStarted = true;

  // Initial pending count and auto-sync on load if online
  refreshPendingGlobal().then(() => {
    if (isOnline()) {
      getPendingCount().then(count => {
        if (count > 0) triggerSyncGlobal();
      }).catch(() => {});
    }
  });

  const handleOnline = () => {
    globalState = { ...globalState, online: true };
    notify();
    // Small delay so the network stack is ready, then auto-sync
    setTimeout(triggerSyncGlobal, 800);
  };

  const handleOffline = () => {
    globalState = { ...globalState, online: false };
    notify();
  };

  const handleTriggerAutoSync = () => {
    if (typeof navigator !== 'undefined' && navigator.onLine) {
      triggerSyncGlobal();
    } else {
      refreshPendingGlobal();
    }
  };

  window.addEventListener('online', handleOnline);
  window.addEventListener('offline', handleOffline);
  window.addEventListener('triggerAutoSync', handleTriggerAutoSync);

  // Poll pending count every 10 s so the badge stays accurate
  setInterval(refreshPendingGlobal, 10_000);

  // Periodic sync check every 30 s – auto-sync any accumulated pending changes
  setInterval(() => {
    if (typeof navigator !== 'undefined' && navigator.onLine) {
      getPendingCount().then(count => {
        if (count > 0) triggerSyncGlobal();
      }).catch(() => {});
    }
  }, 30_000);
}

/**
 * useSyncStatus – tracks online/offline state and the number of
 * pending offline changes.  Automatically triggers syncAll() when
 * the browser comes back online and exposes helpers for the UI.
 *
 * Returns:
 *   online        – boolean, current connectivity
 *   pendingCount  – number of queued operations not yet synced
 *   syncing       – true while syncAll() is running
 *   lastSynced    – Date | null, timestamp of last successful sync
 *   triggerSync   – () => void, manually kick off a sync
 */
export function useSyncStatus() {
  const [state, setState] = useState(globalState);

  useEffect(() => {
    startGlobalIntervals();
    listeners.add(setState);
    // Sync current state immediately in case it changed before effect ran
    setState(globalState);
    return () => {
      listeners.delete(setState);
    };
  }, []);

  return { 
    ...state, 
    triggerSync: triggerSyncGlobal 
  };
}
