
import { useState, useEffect, useMemo } from 'react';
import { dataAPI } from '../lib/data';
import { computeAIInsights } from '../services/aiService';
import { checkAndNotifyVaccinations } from '../lib/notifications';

export function useHealthData() {
  const [records, setRecords] = useState([]);
  const [pigs, setPigs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [healthData, pigsData] = await Promise.all([
        dataAPI.health_records.getAll(),
        dataAPI.pigs.getAll(),
      ]);
      const safeRecords = healthData || [];
      const safePigs = (pigsData || []).filter(p => p.status === 'active');
      setRecords(safeRecords);
      setPigs(safePigs);

      // ── Auto-notify owner about vaccination alerts ──────────────
      try {
        await checkAndNotifyVaccinations(safeRecords, safePigs);
      } catch (notifErr) {
        console.warn('Failed to send vaccination notifications:', notifErr);
      }
    } catch (err) {
      setError('Failed to load health data. Please refresh.');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    window.addEventListener('refreshAllData', loadData);
    return () => {
      window.removeEventListener('refreshAllData', loadData);
    };
  }, []);

  // AI insights and risk map
  const { insights, pigRiskMap, stats } = useMemo(() => {
    const { insights, pigRiskMap } = computeAIInsights(records, pigs);

    // Compute stats
    const today = new Date();
    const upcoming = records.filter(r => r.next_due && new Date(r.next_due) >= today).length;
    const overdue = records.filter(r => r.next_due && new Date(r.next_due) < today).length;
    const atRisk = pigs.filter(p => {
      const pigRecords = records.filter(r => r.pig_id === p.id);
      return pigRecords.length === 0 || pigRecords.some(r => r.next_due && new Date(r.next_due) < today);
    }).length;

    return {
      insights,
      pigRiskMap,
      stats: {
        total: records.length,
        upcoming,
        overdue,
        atRisk,
      },
    };
  }, [records, pigs]);

  return {
    records,
    pigs,
    loading,
    error,
    loadData,
    insights,
    pigRiskMap,
    stats,
  };
}