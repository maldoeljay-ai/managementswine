import { db } from './db';          // single shared Dexie instance
import { supabase } from './supabase';

// Re-export db so data.js can keep importing it from here unchanged
export { db };

let _isActuallyOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;

export function isOnline() {
  return _isActuallyOnline;
}

export function setActuallyOnline(status) {
  if (_isActuallyOnline !== status) {
    _isActuallyOnline = status;
    if (typeof window !== 'undefined') {
      const eventName = status ? 'online' : 'offline';
      window.dispatchEvent(new CustomEvent(eventName));
    }
  }
}

export async function checkConnectivity() {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    setActuallyOnline(false);
    return false;
  }
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);
    await fetch('https://www.gstatic.com/generate_204', {
      method: 'HEAD',
      mode: 'no-cors',
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    setActuallyOnline(true);
    return true;
  } catch (err) {
    setActuallyOnline(false);
    return false;
  }
}

export async function getPendingCount() {
  try {
    const count = await db.syncQueue.count();
    return count;
  } catch (_) {
    return 0;
  }
}

export async function addToQueue(table, operation, record) {
  await db.syncQueue.add({
    table,
    operation,
    record,
    timestamp: new Date().toISOString(),
  });

  if (isOnline() && typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('triggerAutoSync'));
  }
}

export async function pullAllFromSupabase(tableName) {
  try {
    const { data, error } = await supabase.from(tableName).select('*');
    if (error) throw error;
    if (data && data.length > 0) {
      await db[tableName].bulkPut(data);
    }
    return data || [];
  } catch (err) {
    console.warn(`pullAllFromSupabase(${tableName}) failed:`, err);
    checkConnectivity();
    return null;
  }
}

async function processQueueItem(item) {
  const { table, operation, record } = item;
  const tableName = table;

  // Clean payload by removing frontend-only properties like 'is_auto'
  let payload = { ...record };
  if ('is_auto' in payload) {
    delete payload.is_auto;
  }

  // Schema-cache column cleanup for Supabase
  if (tableName === 'health_records') {
    delete payload.notes;
  }

  // Legacy fix for feeding_schedules missing 'type'
  if (tableName === 'feeding_schedules' && !payload.type) {
    payload.type = 'Morning';
  }

  if (operation === 'insert') {
    const isTempNotification = tableName === 'notifications' && typeof payload.id === 'string';
    if (isTempNotification) {
      delete payload.id;
    }

    const { data, error } = await supabase.from(tableName).insert([payload]).select();
    if (error) {
      if (error.code === '23505') {
        console.warn(`Sync: Record with ID ${record.id} already exists in ${tableName}. Treating as success.`);
        return;
      }
      if (error.code === '23502') {
        console.warn(`Sync: Record has null constraint violation in ${tableName}. Discarding invalid record to unblock queue. Payload:`, payload);
        return;
      }
      if (error.code === '23514') {
        console.warn(`Sync: Record violates check constraint in ${tableName}. Discarding invalid record to unblock queue. Payload:`, payload);
        return;
      }
      throw error;
    }

    if (isTempNotification && data && data[0]) {
      await db[tableName].delete(record.id);
      await db[tableName].put(data[0]);
    }
  } else if (operation === 'update') {
    const { data: remote, error: fetchError } = await supabase
      .from(tableName)
      .select('updated_at')
      .eq('id', record.id)
      .maybeSingle();

    if (fetchError && fetchError.code !== 'PGRST116') throw fetchError;

    if (remote && remote.updated_at && remote.updated_at > record.updated_at) {
      const { data: fullRemote } = await supabase
        .from(tableName)
        .select('*')
        .eq('id', record.id)
        .single();
      if (fullRemote) {
        await db[tableName].put(fullRemote);
      }
      return;
    }

    const { id, ...rest } = payload;
    const { error } = await supabase.from(tableName).update(rest).eq('id', id);
    if (error) throw error;
  } else if (operation === 'delete') {
    const { error } = await supabase.from(tableName).delete().eq('id', record.id);
    if (error) throw error;
  }
}

let globalSyncing = false;

export async function syncAll() {
  if (globalSyncing) return;
  globalSyncing = true;
  try {
    const items = await db.syncQueue.toArray();
    for (const item of items) {
      try {
        await processQueueItem(item);
        await db.syncQueue.delete(item.id);
      } catch (err) {
        console.error('Sync failed for item:', item, err);
        const retries = (item.retries || 0) + 1;
        if (retries >= 3 || (err && (err.code === '42501' || err.code === '23503' || err.status === 403))) {
          console.warn(`Sync: Item ${item.id} failed permanently (retries: ${retries}, error: ${err?.code || err?.status}). Discarding to unblock queue.`);
          await db.syncQueue.delete(item.id);
        } else {
          await db.syncQueue.update(item.id, { retries });
        }
        checkConnectivity();
      }
    }
  } finally {
    globalSyncing = false;
  }
}

// Auto-sync is now centrally managed by the useSyncStatus hook.

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    checkConnectivity();
  });
  window.addEventListener('offline', () => {
    setActuallyOnline(false);
  });

  // Initial connectivity probe and setup background checking interval (every 10s)
  checkConnectivity();
  setInterval(checkConnectivity, 10000);
}