// lib/data.js
import { supabase } from './supabase';
import { db, addToQueue, isOnline, syncAll, checkConnectivity } from './sync';

let currentFarmId = localStorage.getItem('swinesync_active_farm') || null;

export const getActiveFarm = () => {
  if (currentFarmId) return currentFarmId;
  const stored = localStorage.getItem('swinesync_active_farm');
  if (stored) {
    currentFarmId = stored;
    return stored;
  }
  try {
    const prof = localStorage.getItem('swinesync_profile');
    if (prof) {
      const p = JSON.parse(prof);
      if (p.farm_id || p.id) {
        currentFarmId = p.farm_id || p.id;
        return currentFarmId;
      }
    }
  } catch (e) {}
  return 'default_farm';
};

export const setActiveFarm = (id) => {
  currentFarmId = id;
  if (id) {
    localStorage.setItem('swinesync_active_farm', id);
  }
};

function generateId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

function applyLocalOptions(records, options = {}) {
  let result = [...records];
  if (options.filters) {
    Object.entries(options.filters).forEach(([key, value]) => {
      if (key === 'farm_id') {
        // If filtering by farm_id, match records with this farm_id OR records with no farm_id set (legacy/unassigned)
        result = result.filter(r => !r.farm_id || r.farm_id === value);
        return;
      }
      if (typeof value === 'object') {
        Object.entries(value).forEach(([op, val]) => {
          if (op === 'gte') result = result.filter(r => r[key] >= val);
          else if (op === 'gt') result = result.filter(r => r[key] > val);
          else if (op === 'lte') result = result.filter(r => r[key] <= val);
          else if (op === 'lt') result = result.filter(r => r[key] < val);
          else if (op === 'eq') result = result.filter(r => r[key] === val);
          else if (op === 'neq') result = result.filter(r => r[key] !== val);
        });
      } else {
        result = result.filter(r => r[key] === value);
      }
    });
  }
  if (options.orderBy) {
    const { column, ascending } = options.orderBy;
    const asc = ascending !== false;
    result.sort((a, b) => {
      if (a[column] < b[column]) return asc ? -1 : 1;
      if (a[column] > b[column]) return asc ? 1 : -1;
      return 0;
    });
  }
  if (options.limit) {
    result = result.slice(0, options.limit);
  }
  return result;
}


// ------------------------------------------------------------------
// Fully implemented createAPI – supports offline‑first for any table
// ------------------------------------------------------------------
function createAPI(tableName) {
  // Global tables (no farm_id filtering)
  const isGlobal = ['profiles', 'farms', 'farm_members'].includes(tableName);

  return {
    async getAll(options = {}) {
      const activeFarm = getActiveFarm();

      let opts = { ...options };
      // Add farm_id filter automatically for non‑global tables if an active farm is available
      if (!isGlobal && activeFarm && activeFarm !== 'all') {
        opts.filters = { ...opts.filters, farm_id: activeFarm };
      }

      if (isOnline()) {
        try {
          let query = supabase.from(tableName).select('*');
          if (opts.filters) {
            Object.entries(opts.filters).forEach(([key, value]) => {
              if (typeof value === 'object') {
                Object.entries(value).forEach(([op, val]) => {
                  query = query.filter(key, op, val);
                });
              } else {
                query = query.eq(key, value);
              }
            });
          }
          if (opts.orderBy) {
            query = query.order(opts.orderBy.column, { ascending: opts.orderBy.ascending !== false });
          }
          if (opts.limit) {
            query = query.limit(opts.limit);
          }
          const { data, error } = await query;
          if (error) throw error;
          if (data && data.length > 0) {
            await db[tableName].bulkPut(data).catch(() => {});
          }
          
          let updatedLocalItems = await db[tableName].toArray().catch(() => []);
          return applyLocalOptions(updatedLocalItems, opts);
        } catch (err) {
          console.warn(`Online getAll failed for ${tableName}, falling back to local:`, err);
          checkConnectivity();
        }
      }

      // Offline fallback
      try {
        const localData = await db[tableName].toArray();
        return applyLocalOptions(localData, opts);
      } catch (localErr) {
        console.error(`Local read failed for ${tableName}:`, localErr);
        return [];
      }
    },

    async getById(id) {
      if (isOnline()) {
        try {
          let query = supabase.from(tableName).select('*').eq('id', id);
          const { data, error } = await query.single();
          if (error && error.code !== 'PGRST116') throw error;
          if (data) {
            await db[tableName].put(data).catch(() => {});
            return data;
          }
        } catch (err) {
          console.warn(`Online getById failed for ${tableName}/${id}, falling back to local:`, err);
          checkConnectivity();
        }
      }
      try {
        return (await db[tableName].get(id)) || null;
      } catch (localErr) {
        console.error(`Local getById failed for ${tableName}/${id}:`, localErr);
        return null;
      }
    },

    async insert(record) {
      const activeFarm = getActiveFarm();

      const id = record.id || generateId();
      let newRecord = { ...record, id, updated_at: new Date().toISOString() };
      if (!isGlobal && !newRecord.farm_id && activeFarm) {
        newRecord.farm_id = activeFarm;
      }

      // CRITICAL: Always save to local Dexie immediately so data is NEVER lost!
      try {
        await db[tableName].put(newRecord);
      } catch (e) {
        console.warn(`Local Dexie put failed for ${tableName}:`, e);
      }

      const saveOffline = async () => {
        await addToQueue(tableName, 'insert', newRecord);
        await db[tableName].put(newRecord);
        return newRecord;
      };

      if (!isOnline()) return saveOffline();

      try {
        // Remove auto‑generated fields if needed (e.g., id for notifications)
        let payload = { ...newRecord };
        if (tableName === 'notifications' && typeof payload.id === 'string') {
          delete payload.id;
        }
        if (tableName === 'health_records') {
          delete payload.notes;
        }
        const { data, error } = await supabase.from(tableName).insert([payload]).select();
        if (error) throw error;
        const saved = (data && data[0]) || newRecord;
        await db[tableName].put(saved);
        return saved;
      } catch (err) {
        console.warn(`Online insert failed for ${tableName}, falling back to local queue:`, err);
        checkConnectivity();
        return saveOffline();
      }
    },

    async update(id, updates) {
      const updatesWithTimestamp = { ...updates, updated_at: new Date().toISOString() };

      // Save to local Dexie immediately
      try {
        const local = await db[tableName].get(id);
        if (local) {
          await db[tableName].put({ ...local, ...updatesWithTimestamp });
        } else {
          await db[tableName].put({ id, ...updatesWithTimestamp });
        }
      } catch (e) {
        console.warn(`Local update failed for ${tableName}:`, e);
      }

      const saveOffline = async () => {
        await addToQueue(tableName, 'update', { id, ...updatesWithTimestamp });
        return { id, ...updatesWithTimestamp };
      };

      if (!isOnline()) return saveOffline();

      try {
        let payload = { ...updatesWithTimestamp };
        if (tableName === 'health_records') {
          delete payload.notes;
        }
        const { data, error } = await supabase.from(tableName).update(payload).eq('id', id).select();
        if (error) throw error;
        const updated = (data && data[0]) || { ...updatesWithTimestamp, id };
        await db[tableName].put(updated);
        return updated;
      } catch (err) {
        console.warn(`Online update failed for ${tableName}, falling back to local:`, err);
        checkConnectivity();
        return saveOffline();
      }
    },

    async delete(id) {
      // Remove from local Dexie immediately
      try {
        await db[tableName].delete(id);
      } catch (e) {
        console.warn(`Local delete failed for ${tableName}:`, e);
      }

      const saveOffline = async () => {
        await addToQueue(tableName, 'delete', { id });
      };

      if (!isOnline()) return saveOffline();

      try {
        const { error } = await supabase.from(tableName).delete().eq('id', id);
        if (error) throw error;
      } catch (err) {
        console.warn(`Online delete failed for ${tableName}, falling back to local:`, err);
        checkConnectivity();
        return saveOffline();
      }
    },
  };
}



/**
 * Query any table with an explicit farmId override.
 * Does NOT change the global currentFarmId — safe for the Owner
 * to use when inspecting a caretaker's isolated data workspace.
 */
export async function getWithFarmId(farmId, tableName, options = {}) {
  if (!farmId) return [];
  const opts = { ...options, filters: { ...options.filters, farm_id: farmId } };

  try {
    let query = supabase.from(tableName).select('*');
    if (opts.filters) {
      Object.entries(opts.filters).forEach(([key, value]) => {
        if (typeof value === 'object') {
          Object.entries(value).forEach(([op, val]) => {
            query = query.filter(key, op, val);
          });
        } else {
          query = query.eq(key, value);
        }
      });
    }
    if (opts.orderBy) {
      query = query.order(opts.orderBy.column, { ascending: opts.orderBy.ascending !== false });
    }
    if (opts.limit) {
      query = query.limit(opts.limit);
    }
    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  } catch (err) {
    console.warn(`getWithFarmId failed for ${tableName} (farm ${farmId}):`, err);
    return [];
  }
}

export const dataAPI = {
  pigs: createAPI('pigs'),
  breedings: createAPI('breedings'),
  farrowings: createAPI('farrowings'),
  weanings: createAPI('weanings'),
  feeding_schedules: createAPI('feeding_schedules'),
  feeding_logs: createAPI('feeding_logs'),
  inventory: createAPI('inventory'),
  inventory_restocks: createAPI('inventory_restocks'),
  feed_inventory: createAPI('feed_inventory'),
  feed_restocks: createAPI('feed_restocks'),
  financial_transactions: createAPI('financial_transactions'),
  growth_records: createAPI('growth_records'),
  mortality_records: createAPI('mortality_records'),
  health_records: createAPI('health_records'),
  profiles: createAPI('profiles'),
  notifications: createAPI('notifications'),
  farms: createAPI('farms'),
  farm_members: createAPI('farm_members'),
  audit_logs: createAPI('audit_logs'),
};
export async function getSingletonInventory() {
  const list = await dataAPI.inventory.getAll({ limit: 1 });
  if (list && list.length > 0) return list[0];
  
  // Create it dynamically if missing
  try {
    return await dataAPI.inventory.insert({
      feed_stock_kg: 0,
      min_threshold: 500,
      last_restock: new Date().toISOString().split('T')[0]
    });
  } catch(e) {
    return { feed_stock_kg: 0, min_threshold: 500, is_temporary: true };
  }
}
