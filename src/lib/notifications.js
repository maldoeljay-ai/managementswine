import { supabase } from './supabase';
import { dataAPI } from './data';
import { isOnline } from './sync';

const _sessionFired = new Set();

function dedupKey(type, key) {
  return `${type}::${key}`;
}

/**
 * Add a notification directly to Supabase.
 * - No 'id' is passed – the database will generate a bigint.
 */
export async function addNotification(type, message, targetRole = 'Owner', actorName = '', dedupSessionKey = null) {
  if (dedupSessionKey) {
    const key = dedupKey(type, dedupSessionKey);
    if (_sessionFired.has(key)) return null;
    _sessionFired.add(key);
  }

  const notification = {
    type,
    message,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    read: false,
    target_role: targetRole,
    actor_name: actorName,
  };

  try {
    const newNotif = await dataAPI.notifications.insert(notification);
    return newNotif;
  } catch (e) {
    console.warn('Failed to save notification:', e);
    return null;
  }
}

export async function getNotifications(targetRole = 'Owner') {
  try {
    const data = await dataAPI.notifications.getAll({
      filters: { target_role: targetRole },
      orderBy: { column: 'created_at', ascending: false },
      limit: 50
    });
    return data || [];
  } catch (e) {
    console.warn('Failed to get notifications:', e);
    return [];
  }
}

export async function getUnreadCount(targetRole = 'Owner') {
  try {
    const notifications = await getNotifications(targetRole);
    return notifications.filter(n => !n.read).length;
  } catch (e) {
    return 0;
  }
}

export async function markNotificationRead(id) {
  try {
    await dataAPI.notifications.update(id, { read: true });
  } catch (e) {
    console.warn('markNotificationRead failed:', e);
  }
}

export async function markAllRead(targetRole = 'Owner') {
  try {
    const unread = await dataAPI.notifications.getAll({ filters: { target_role: targetRole, read: false } });
    for (const n of unread) {
      await dataAPI.notifications.update(n.id, { read: true });
    }
  } catch (e) {
    console.warn('markAllRead failed:', e);
  }
}

export function subscribeToNotifications(targetRole, onNewNotification) {
  // Real-time subscription using unique suffix to avoid overwriting existing channel
  const channel = supabase
    .channel(`notifications-${targetRole}-${Math.random().toString(36).substring(2, 9)}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'notifications', filter: `target_role=eq.${targetRole}` },
      (payload) => {
        if (payload.new) {
          onNewNotification(payload.new);
        }
      }
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}

// ─── Auto-check helpers ─────────────────────────────────────────────────────

export async function checkAndNotifyLowStock(feedStockKg, minThreshold, actorName = 'System') {
  if (feedStockKg < minThreshold) {
    const todayKey = new Date().toISOString().split('T')[0];
    await addNotification(
      'low_stock',
      `🔴 CRITICAL: Feed stock is critically low! Only ${feedStockKg} kg remaining (minimum threshold: ${minThreshold} kg). Immediate restocking is required to avoid feeding disruptions.`,
      'Owner',
      actorName,
      `low_stock_${todayKey}`
    );
  }
}

export async function checkAndNotifyLowStockWarning(feedStockKg, minThreshold, daysLeft = 0, actorName = 'System') {
  const warningLevel = minThreshold * 2;
  if (feedStockKg >= minThreshold && feedStockKg < warningLevel) {
    const todayKey = new Date().toISOString().split('T')[0];
    await addNotification(
      'low_stock',
      `🟡 WARNING: Feed stock is running low — ${feedStockKg} kg remaining${daysLeft > 0 ? ` (~${daysLeft} days left)` : ''}. Consider restocking soon (minimum threshold: ${minThreshold} kg).`,
      'Owner',
      actorName,
      `low_stock_warning_${todayKey}`
    );
  }
}

export async function checkAndNotifyFeedTypeLow(typeForecasts, actorName = 'System') {
  if (!typeForecasts || typeForecasts.length === 0) return;
  const todayKey = new Date().toISOString().split('T')[0];

  for (const forecast of typeForecasts) {
    if (forecast.urgency === 'critical') {
      await addNotification(
        'low_stock',
        `🔴 RESTOCK NEEDED: "${forecast.type}" feed is critically low — only ${forecast.daysLeft} day${forecast.daysLeft !== 1 ? 's' : ''} remaining (${forecast.estimatedStock} kg). Order ${forecast.recommendedRestock} kg before ${forecast.depletionDate}.`,
        'Owner',
        actorName,
        `feed_type_critical_${forecast.type}_${todayKey}`
      );
    } else if (forecast.urgency === 'warning') {
      await addNotification(
        'low_stock',
        `🟡 LOW FEED ALERT: "${forecast.type}" feed is running low — ${forecast.daysLeft} days remaining (${forecast.estimatedStock} kg). Consider ordering ${forecast.recommendedRestock} kg soon.`,
        'Owner',
        actorName,
        `feed_type_warning_${forecast.type}_${todayKey}`
      );
    }
  }
}

export async function sendManualLowStockAlert(feedStockKg, minThreshold, actorName = 'Staff') {
  await addNotification(
    'low_stock',
    `🚨 URGENT RESTOCK REQUEST: ${actorName} has flagged that feed stock is low — only ${feedStockKg} kg remaining (threshold: ${minThreshold} kg). Please arrange a restock immediately.`,
    'Owner',
    actorName,
    null
  );
}

export async function checkAndNotifyVaccinations(records, pigs) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const sevenDaysLater = new Date(today);
  sevenDaysLater.setDate(sevenDaysLater.getDate() + 7);

  const todayKey = today.toISOString().split('T')[0];

  const overdueRecords = [];
  const upcomingRecords = [];

  records.forEach(r => {
    if (!r.next_due) return;
    const dueDate = new Date(r.next_due);
    dueDate.setHours(0, 0, 0, 0);

    if (dueDate < today) {
      overdueRecords.push(r);
    } else if (dueDate <= sevenDaysLater) {
      upcomingRecords.push(r);
    }
  });

  if (overdueRecords.length > 0) {
    const pigNames = overdueRecords.map(r => {
      const pig = pigs.find(p => p.id === r.pig_id);
      return pig ? pig.tag : r.pig_id;
    });
    const uniquePigs = [...new Set(pigNames)];
    await addNotification(
      'vaccination_overdue',
      `🚨 ${overdueRecords.length} health record(s) are OVERDUE for pig(s): ${uniquePigs.join(', ')}. Immediate attention required!`,
      'Owner',
      'System',
      `vaccination_overdue_${todayKey}`
    );
  }

  if (upcomingRecords.length > 0) {
    const pigNames = upcomingRecords.map(r => {
      const pig = pigs.find(p => p.id === r.pig_id);
      return pig ? pig.tag : r.pig_id;
    });
    const uniquePigs = [...new Set(pigNames)];
    await addNotification(
      'vaccination_due',
      `💉 ${upcomingRecords.length} vaccination(s) due in the next 7 days for pig(s): ${uniquePigs.join(', ')}.`,
      'Owner',
      'System',
      `vaccination_due_${todayKey}`
    );
  }
}

export async function checkAndNotifyMissedFeedings(missedCount) {
  if (missedCount > 0) {
    const todayKey = new Date().toISOString().split('T')[0];
    const message = `🍽️ ${missedCount} feeding schedule(s) were missed today. Please check the feeding logs!`;
    await addNotification(
      'missed_feeding',
      message,
      'Owner',
      'System',
      `missed_feeding_owner_${todayKey}_${missedCount}`
    );
    await addNotification(
      'missed_feeding',
      message,
      'Farm Caretaker',
      'System',
      `missed_feeding_caretaker_${todayKey}_${missedCount}`
    );
  }
}