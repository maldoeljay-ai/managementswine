import { useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { db } from '../lib/db';
import { isOnline } from '../lib/sync';

/**
 * useRealtimeSync
 *
 * Subscribes to Supabase Realtime for all core tables.
 * When a change arrives from the server (from any device/user),
 * it patches the local Dexie cache and fires `refreshAllData`
 * so every component re-renders immediately — no manual sync needed.
 *
 * Call this once, high in the component tree (e.g. in App.jsx).
 */

const REALTIME_TABLES = [
  'pigs',
  'breedings',
  'farrowings',
  'weanings',
  'feeding_schedules',
  'feeding_logs',
  'inventory',
  'inventory_restocks',
  'financial_transactions',
  'health_records',
  'growth_records',
  'mortality_records',
  'notifications',
  'profiles',
];

// Debounce the refreshAllData dispatch so rapid bursts (e.g. bulk inserts)
// only trigger one re-render cycle.
function debounce(fn, ms) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

export function useRealtimeSync(activeFarmId) {
  const channelRef = useRef(null);

  useEffect(() => {
    // Only set up realtime when online
    if (!isOnline()) return;

    const fireRefresh = debounce(() => {
      window.dispatchEvent(new CustomEvent('refreshAllData'));
    }, 300);

    // Single channel with one postgres_changes subscription per table.
    const channel = supabase.channel('swinesync-realtime');

    const currentFarmId = activeFarmId || localStorage.getItem('swinesync_active_farm');

    REALTIME_TABLES.forEach((table) => {
      let filterObj = { event: '*', schema: 'public', table };
      
      // Filter non-global tables by the active farm ID
      const isGlobal = ['profiles', 'farms', 'farm_members'].includes(table);
      if (!isGlobal && currentFarmId) {
        filterObj.filter = `farm_id=eq.${currentFarmId}`;
      }

      channel.on(
        'postgres_changes',
        filterObj,
        async (payload) => {
          const { eventType, new: newRecord, old: oldRecord } = payload;

          try {
            if (eventType === 'INSERT' || eventType === 'UPDATE') {
              if (newRecord && newRecord.id) {
                await db[table].put(newRecord);
              }
            } else if (eventType === 'DELETE') {
              const id = oldRecord?.id;
              if (id) {
                await db[table].delete(id);
              }
            }
          } catch (_) {
            // Local cache update is best-effort; ignore Dexie errors
          }

          // Trigger UI refresh (debounced)
          fireRefresh();
        }
      );
    });

    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        console.log('[RealtimeSync] Connected — listening for live changes');
      } else if (status === 'CHANNEL_ERROR') {
        console.warn('[RealtimeSync] Channel error — realtime unavailable');
      }
    });

    channelRef.current = channel;

    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [activeFarmId]); // React to activeFarmId changes
}
