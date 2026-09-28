import Dexie from 'dexie';

export const db = new Dexie('SwineSyncDB');

// ---- Version 1 (original) ----
db.version(1).stores({
  pigs: 'id, tag, name, status, updated_at',
  breedings: 'id, pig_id, status, expected_farrow, updated_at',
  feeding_schedules: 'id, time, type, updated_at',
  feeding_logs: 'id, schedule_id, time, updated_at',
  inventory: 'id, feed_stock_kg, updated_at',
  financial_transactions: 'id, type, date, updated_at',
  health_records: 'id, pig_id, type, date, updated_at',
  growth_records: 'id, pig_id, date, updated_at',
  mortality_records: 'id, pig_id, date, updated_at',
  profiles: 'id, username, role, updated_at',
  sync_queue: '++id, table, operation, record_id, timestamp, retries',
});

// ---- Version 2 (adds feed_type and pig_id to feeding_schedules) ----
db.version(2).stores({
  pigs: 'id, tag, name, status, updated_at',
  breedings: 'id, pig_id, status, expected_farrow, updated_at',
  feeding_schedules: 'id, time, type, feed_type, pig_id, updated_at',
  feeding_logs: 'id, schedule_id, time, updated_at',
  inventory: 'id, feed_stock_kg, updated_at',
  financial_transactions: 'id, type, date, updated_at',
  health_records: 'id, pig_id, type, date, updated_at',
  growth_records: 'id, pig_id, date, updated_at',
  mortality_records: 'id, pig_id, date, updated_at',
  profiles: 'id, username, role, updated_at',
  sync_queue: '++id, table, operation, record_id, timestamp, retries',
});

// ---- Version 3 (adds weanings table) ----
db.version(3).stores({
  pigs: 'id, tag, name, status, updated_at',
  breedings: 'id, pig_id, status, expected_farrow, updated_at',
  feeding_schedules: 'id, time, type, feed_type, pig_id, updated_at',
  feeding_logs: 'id, schedule_id, time, updated_at',
  inventory: 'id, feed_stock_kg, updated_at',
  financial_transactions: 'id, type, date, updated_at',
  health_records: 'id, pig_id, type, date, updated_at',
  growth_records: 'id, pig_id, date, updated_at',
  mortality_records: 'id, pig_id, date, updated_at',
  profiles: 'id, username, role, updated_at',
  weanings: 'id, pig_id, breeding_id, weaning_date, updated_at',
  sync_queue: '++id, table, operation, record_id, timestamp, retries',
});

// ---- Version 4 (unified: adds syncQueue, notifications, inventory_restocks,
//                          expands index coverage for all tables used by sync.js) ----
db.version(4).stores({
  // Core tables
  pigs: 'id, tag, name, gender, status, reproductive_status, updated_at',
  breedings: 'id, pig_id, mating_date, expected_farrow, status, notes, updated_at',
  weanings: 'id, pig_id, breeding_id, weaning_date, updated_at',
  feeding_schedules: 'id, time, type, feed_type, pig_id, amount_kg, updated_at',
  feeding_logs: 'id, amount_kg, time, schedule_id, type, updated_at',
  inventory: 'id, feed_stock_kg, min_threshold, last_restock, updated_at',
  inventory_restocks: 'id, amount_kg, date, notes, updated_at',
  financial_transactions: 'id, type, amount, description, category, date, updated_at',
  health_records: 'id, pig_id, type, date, next_due, updated_at',
  growth_records: 'id, pig_id, date, weight_kg, gain, updated_at',
  mortality_records: 'id, pig_id, cause, date, updated_at',
  profiles: 'id, username, role, updated_at',
  notifications: 'id, type, message, created_at, read, target_role, actor_name',
  // Sync queues (both names for backward compat)
  sync_queue: '++id, table, operation, record_id, timestamp, retries',
  syncQueue: '++id, table, operation, timestamp',
});

// ---- Version 5 (Mating Planner: expands breedings index to include
//                 actual_farrowing_date, litter_size, and stillborn for
//                 farrowing/weaning lookups and offline sorting) ----
db.version(5).stores({
  // Core tables (unchanged)
  pigs: 'id, tag, name, gender, status, reproductive_status, updated_at',
  // Mating Planner full index: all fields used by Breeding.jsx for
  // filtering upcoming farrowings, lactating sows, and weaning records
  breedings: 'id, pig_id, mating_date, expected_farrow, actual_farrowing_date, litter_size, stillborn, status, notes, updated_at',
  weanings: 'id, pig_id, breeding_id, weaning_date, piglets_weaned, avg_weight_kg, updated_at',
  feeding_schedules: 'id, time, type, feed_type, pig_id, amount_kg, updated_at',
  feeding_logs: 'id, amount_kg, time, schedule_id, type, updated_at',
  inventory: 'id, feed_stock_kg, min_threshold, last_restock, updated_at',
  inventory_restocks: 'id, amount_kg, date, notes, updated_at',
  financial_transactions: 'id, type, amount, description, category, date, updated_at',
  health_records: 'id, pig_id, type, date, next_due, updated_at',
  growth_records: 'id, pig_id, date, weight_kg, gain, updated_at',
  mortality_records: 'id, pig_id, cause, date, updated_at',
  profiles: 'id, username, role, updated_at',
  notifications: 'id, type, message, created_at, read, target_role, actor_name',
  // Sync queues
  sync_queue: '++id, table, operation, record_id, timestamp, retries',
  syncQueue: '++id, table, operation, timestamp',
});

// ---- Version 6 (adds farrowings table) ----
db.version(6).stores({
  // Core tables
  pigs: 'id, tag, name, gender, status, reproductive_status, updated_at',
  breedings: 'id, pig_id, mating_date, expected_farrow, actual_farrowing_date, litter_size, stillborn, status, notes, updated_at',
  weanings: 'id, pig_id, breeding_id, weaning_date, piglets_weaned, avg_weight_kg, updated_at',
  farrowings: 'id, pig_id, breeding_id, farrow_date, alive, stillborn, mummified, updated_at',
  feeding_schedules: 'id, time, type, feed_type, pig_id, amount_kg, updated_at',
  feeding_logs: 'id, amount_kg, time, schedule_id, type, updated_at',
  inventory: 'id, feed_stock_kg, min_threshold, last_restock, updated_at',
  inventory_restocks: 'id, amount_kg, date, notes, updated_at',
  financial_transactions: 'id, type, amount, description, category, date, updated_at',
  health_records: 'id, pig_id, type, date, next_due, updated_at',
  growth_records: 'id, pig_id, date, weight_kg, gain, updated_at',
  mortality_records: 'id, pig_id, cause, date, updated_at',
  profiles: 'id, username, role, updated_at',
  notifications: 'id, type, message, created_at, read, target_role, actor_name',
  // Sync queues
  sync_queue: '++id, table, operation, record_id, timestamp, retries',
  syncQueue: '++id, table, operation, timestamp',
});

// ---- Version 7 (Multi-farm support: adds farms, farm_members and farm_id indexes) ----
db.version(7).stores({
  // New Farm Tables
  farms: 'id, name, created_at, updated_at',
  farm_members: 'id, farm_id, user_id, role, created_at, updated_at',
  // Core tables with farm_id added to index
  pigs: 'id, farm_id, tag, name, gender, status, reproductive_status, updated_at',
  breedings: 'id, farm_id, pig_id, mating_date, expected_farrow, actual_farrowing_date, litter_size, stillborn, status, notes, updated_at',
  weanings: 'id, farm_id, pig_id, breeding_id, weaning_date, piglets_weaned, avg_weight_kg, updated_at',
  farrowings: 'id, farm_id, pig_id, breeding_id, farrow_date, alive, stillborn, mummified, updated_at',
  feeding_schedules: 'id, farm_id, time, type, feed_type, pig_id, amount_kg, updated_at',
  feeding_logs: 'id, farm_id, amount_kg, time, schedule_id, type, updated_at',
  inventory: 'id, farm_id, feed_stock_kg, min_threshold, last_restock, updated_at',
  inventory_restocks: 'id, farm_id, amount_kg, date, notes, updated_at',
  financial_transactions: 'id, farm_id, type, amount, description, category, date, updated_at',
  health_records: 'id, farm_id, pig_id, type, date, next_due, updated_at',
  growth_records: 'id, farm_id, pig_id, date, weight_kg, gain, updated_at',
  mortality_records: 'id, farm_id, pig_id, cause, date, updated_at',
  profiles: 'id, username, role, updated_at',
  notifications: 'id, farm_id, type, message, created_at, read, target_role, actor_name',
  // Sync queues
  sync_queue: '++id, table, operation, record_id, timestamp, retries',
  syncQueue: '++id, table, operation, timestamp',
});

// ---- Version 8 (adds invite_code index to farms for invite system) ----
db.version(8).stores({
  // Farm table now includes invite_code for lookup
  farms: 'id, name, invite_code, created_at, updated_at',
  farm_members: 'id, farm_id, user_id, role, created_at, updated_at',
  // Core tables (unchanged)
  pigs: 'id, farm_id, tag, name, gender, status, reproductive_status, updated_at',
  breedings: 'id, farm_id, pig_id, mating_date, expected_farrow, actual_farrowing_date, litter_size, stillborn, status, notes, updated_at',
  weanings: 'id, farm_id, pig_id, breeding_id, weaning_date, piglets_weaned, avg_weight_kg, updated_at',
  farrowings: 'id, farm_id, pig_id, breeding_id, farrow_date, alive, stillborn, mummified, updated_at',
  feeding_schedules: 'id, farm_id, time, type, feed_type, pig_id, amount_kg, updated_at',
  feeding_logs: 'id, farm_id, amount_kg, time, schedule_id, type, updated_at',
  inventory: 'id, farm_id, feed_stock_kg, min_threshold, last_restock, updated_at',
  inventory_restocks: 'id, farm_id, amount_kg, date, notes, updated_at',
  financial_transactions: 'id, farm_id, type, amount, description, category, date, updated_at',
  health_records: 'id, farm_id, pig_id, type, date, next_due, updated_at',
  growth_records: 'id, farm_id, pig_id, date, weight_kg, gain, updated_at',
  mortality_records: 'id, farm_id, pig_id, cause, date, updated_at',
  profiles: 'id, username, role, updated_at',
  notifications: 'id, farm_id, type, message, created_at, read, target_role, actor_name',
  // Sync queues
  sync_queue: '++id, table, operation, record_id, timestamp, retries',
  syncQueue: '++id, table, operation, timestamp',
});

// ---- Version 9 (adds feed_inventory and feed_restocks) ----
db.version(9).stores({
  // Farm table now includes invite_code for lookup
  farms: 'id, name, invite_code, created_at, updated_at',
  farm_members: 'id, farm_id, user_id, role, created_at, updated_at',
  // Core tables
  pigs: 'id, farm_id, tag, name, gender, status, reproductive_status, updated_at',
  breedings: 'id, farm_id, pig_id, mating_date, expected_farrow, actual_farrowing_date, litter_size, stillborn, status, notes, updated_at',
  weanings: 'id, farm_id, pig_id, breeding_id, weaning_date, piglets_weaned, avg_weight_kg, updated_at',
  farrowings: 'id, farm_id, pig_id, breeding_id, farrow_date, alive, stillborn, mummified, updated_at',
  feeding_schedules: 'id, farm_id, time, type, feed_type, pig_id, amount_kg, updated_at',
  feeding_logs: 'id, farm_id, amount_kg, time, schedule_id, type, updated_at',
  inventory: 'id, farm_id, feed_stock_kg, min_threshold, last_restock, updated_at',
  inventory_restocks: 'id, farm_id, amount_kg, date, notes, updated_at',
  feed_inventory: 'id, farm_id, type, name, quantity_kg, min_threshold, updated_at',
  feed_restocks: 'id, farm_id, type, amount_kg, date, updated_at',
  financial_transactions: 'id, farm_id, type, amount, description, category, date, updated_at',
  health_records: 'id, farm_id, pig_id, type, date, next_due, updated_at',
  growth_records: 'id, farm_id, pig_id, date, weight_kg, gain, updated_at',
  mortality_records: 'id, farm_id, pig_id, cause, date, updated_at',
  profiles: 'id, username, role, updated_at',
  notifications: 'id, farm_id, type, message, created_at, read, target_role, actor_name',
  // Sync queues
  sync_queue: '++id, table, operation, record_id, timestamp, retries',
  syncQueue: '++id, table, operation, timestamp',
});

export const withTimestamp = (data) => ({
  ...data,
  updated_at: new Date().toISOString(),
});

export default db;