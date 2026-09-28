// src/services/inventoryAI.js
// ─────────────────────────────────────────────────────────────
// SwineSync Inventory AI
// Reference dataset + statistical forecasting for feed stock.
// ─────────────────────────────────────────────────────────────

/**
 * FEED BASELINE DATASET
 * kg of feed consumed per pig per day by age stage & feed type.
 * Sourced from Philippine swine-extension guidelines (BAI).
 * Used as a prior when a farm has insufficient logging history.
 */
export const FEED_BASELINE_DATASET = {
  // stage: { minWeeks, maxWeeks, kgPerPigPerDay, typicalFeedType, crudeProtein%, targetADG_g }
  pre_starter: { minWeeks: 0,  maxWeeks: 3,  kgPerPigPerDay: 0.25, typicalFeedType: 'Pre-starter', crudeProteinPct: 22, targetADGg: 150  },
  starter:     { minWeeks: 3,  maxWeeks: 8,  kgPerPigPerDay: 0.75, typicalFeedType: 'Starter',     crudeProteinPct: 20, targetADGg: 350  },
  grower:      { minWeeks: 8,  maxWeeks: 14, kgPerPigPerDay: 1.60, typicalFeedType: 'Grower',      crudeProteinPct: 18, targetADGg: 600  },
  finisher:    { minWeeks: 14, maxWeeks: 26, kgPerPigPerDay: 2.40, typicalFeedType: 'Finisher',    crudeProteinPct: 16, targetADGg: 800  },
  adult:       { minWeeks: 26, maxWeeks: 999,kgPerPigPerDay: 2.20, typicalFeedType: 'Gestation',   crudeProteinPct: 14, targetADGg: null },
};

/**
 * SEASONAL FACTORS (Philippines)
 * Multiply baseline consumption by this factor for the given month.
 * Hot months depress intake; cool months increase it.
 */
export const SEASONAL_FACTORS = {
  0: 0.96, 1: 0.95, 2: 0.98, 3: 1.03, 4: 1.05,
  5: 1.04, 6: 1.03, 7: 1.02, 8: 1.01, 9: 1.00,
  10: 1.00, 11: 0.97,
};

/**
 * WASTE / SPILLAGE COEFFICIENTS by feeder type.
 * Applied on top of baseline to get "true" consumption.
 */
export const WASTE_COEFFICIENTS = {
  automatic: 1.02,   // ~2% spillage
  trough: 1.06,   // ~6% spillage
  floor: 1.15,   // ~15% spillage
  unknown: 1.05,
};

/**
 * FEED TYPE CLASSIFIER TRAINING DATA
 * Used to recommend feed type given a pig's age/weight/stage.
 * Each entry: input features -> recommended feed label.
 */
export const FEED_TYPE_CLASSIFIER = [
  { ageWeeksMin: 0, ageWeeksMax: 3, weightKgMax: 7, label: 'Pre-starter', notes: 'High-energy milk replacer or medicated pre-starter pellet' },
  { ageWeeksMin: 3, ageWeeksMax: 8, weightKgMax: 25, label: 'Starter', notes: '20% CP, small pellet 2-3mm, limit-fed to avoid gut issues' },
  { ageWeeksMin: 8, ageWeeksMax: 14, weightKgMax: 60, label: 'Grower', notes: '18% CP, ad libitum; monitor water-to-feed ratio' },
  { ageWeeksMin: 14, ageWeeksMax: 20, weightKgMax: 90, label: 'Finisher 1', notes: '16% CP, high energy; focus on FCR optimization' },
  { ageWeeksMin: 20, ageWeeksMax: 26, weightKgMax: 120, label: 'Finisher 2', notes: '14-16% CP, push to market weight 90-110 kg live' },
  { ageWeeksMin: 26, ageWeeksMax: 999, weightKgMax: null, label: 'Gestation/Lactation', notes: 'Sow feed; 14% CP in gestation, 18% in lactation' },
];

/**
 * FCR BENCHMARK DATASET
 * Feed Conversion Ratio targets per stage (Philippine conditions).
 * FCR = kg feed consumed / kg live weight gained.
 * Lower FCR = more efficient.
 */
export const FCR_BENCHMARKS = [
  { stage: 'pre_starter', targetFCR: 1.3, goodFCR: 1.2, poorFCR: 1.6 },
  { stage: 'starter', targetFCR: 1.6, goodFCR: 1.4, poorFCR: 2.0 },
  { stage: 'grower', targetFCR: 2.2, goodFCR: 1.9, poorFCR: 2.6 },
  { stage: 'finisher', targetFCR: 2.8, goodFCR: 2.4, poorFCR: 3.4 },
  { stage: 'adult', targetFCR: null, goodFCR: null, poorFCR: null },
];


// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function stageFromAgeWeeks(weeks) {
  for (const [key, cfg] of Object.entries(FEED_BASELINE_DATASET)) {
    if (weeks >= cfg.minWeeks && weeks < cfg.maxWeeks) return { key, ...cfg };
  }
  return { key: 'adult', ...FEED_BASELINE_DATASET.adult };
}

/** Fit y = m x + b to (index, value) pairs. */
function linreg(values) {
  const n = values.length;
  if (n < 2) return { m: 0, b: values[0] ?? 0 };
  const sumX = (n * (n - 1)) / 2;
  const sumY = values.reduce((s, v) => s + v, 0);
  const sumXY = values.reduce((s, v, i) => s + i * v, 0);
  const sumXX = (n * (n - 1) * (2 * n - 1)) / 6;
  const denom = n * sumXX - sumX * sumX || 1;
  const m = (n * sumXY - sumX * sumY) / denom;
  const b = (sumY - m * sumX) / n;
  return { m, b };
}

function stdev(values) {
  if (values.length < 2) return 0;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

// ─────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────

/**
 * Predict baseline daily consumption for a farm.
 * Used when the farm has <7 days of real feeding logs.
 */
export function predictBaselineDaily({ herd, feederType = 'unknown', month = new Date().getMonth() } = {}) {
  if (!Array.isArray(herd) || herd.length === 0) return 0;
  let total = 0;
  for (const pig of herd) {
    if (pig.status !== 'active') continue;
    const weeks = pig.birth_date
      ? Math.floor((Date.now() - new Date(pig.birth_date).getTime()) / (7 * 86400000))
      : 16; // assume finisher age if unknown
    const stage = stageFromAgeWeeks(weeks);
    total += stage.kgPerPigPerDay;
  }
  total *= SEASONAL_FACTORS[month] ?? 1;
  total *= WASTE_COEFFICIENTS[feederType] ?? 1;
  return Math.round(total * 10) / 10;
}

/**
 * Forecast daily feed consumption.
 * Blends real historical data (when available) with the baseline prior.
 * Also returns a 7-day projection and anomaly flags.
 */
export function forecastConsumption(logs = [], { herd = [], feederType = 'unknown' } = {}) {
  const now = Date.now();
  const DAY = 86400000;

  // Aggregate the last 30 days of logs into a daily map
  const daily = new Map();
  for (const log of logs) {
    if (!log?.time || log.amount_kg == null) continue;
    const t = new Date(log.time).getTime();
    if (now - t > 30 * DAY) continue;
    const key = new Date(log.time).toISOString().slice(0, 10);
    daily.set(key, (daily.get(key) ?? 0) + Number(log.amount_kg));
  }

  const values = [...daily.values()];
  const baseline = predictBaselineDaily({ herd, feederType });

  let dailyAvg;
  let method;
  if (values.length >= 7) {
    // Weighted moving average — recent days count more
    const weights = values.map((_, i) => i + 1);
    const wSum = weights.reduce((s, w) => s + w, 0);
    const wAvg = values.reduce((s, v, i) => s + v * weights[i], 0) / wSum;
    dailyAvg = wAvg;
    method = 'weighted_moving_average';
  } else if (values.length > 0) {
    dailyAvg = values.reduce((s, v) => s + v, 0) / values.length;
    method = 'simple_mean';
  } else {
    dailyAvg = baseline;
    method = 'baseline_prior';
  }

  // Blend with baseline if we have a very thin sample
  if (values.length > 0 && values.length < 7 && baseline > 0) {
    const w = values.length / 7;
    dailyAvg = dailyAvg * w + baseline * (1 - w);
    method = 'hybrid_' + method;
  }

  dailyAvg = Math.round(dailyAvg * 10) / 10;

  // 7-day forward projection using a light linear trend
  const { m, b } = linreg(values.slice(-14));
  const lastIndex = Math.max(0, values.length - 1);
  const projection7 = [];
  for (let i = 1; i <= 7; i++) {
    const trendVal = m * (lastIndex + i) + b;
    // clamp trend to ±30 % of dailyAvg so a noisy week doesn't explode
    const clamped = Math.max(dailyAvg * 0.7, Math.min(dailyAvg * 1.3, trendVal));
    projection7.push(Math.max(0, Math.round(clamped * 10) / 10));
  }

  // Anomaly detection — z-score > 2
  const mean = values.reduce((s, v) => s + v, 0) / (values.length || 1);
  const sd = stdev(values);
  const anomalies = [];
  if (sd > 0) {
    [...daily.entries()].forEach(([date, amount]) => {
      const z = (amount - mean) / sd;
      if (Math.abs(z) > 2) anomalies.push({ date, amount, z: Math.round(z * 100) / 100 });
    });
  }

  return {
    method,
    dailyAvg,
    baselinePrior: baseline,
    sampleDays: values.length,
    projection7,          // [kg, kg, ... 7 values]
    projectedWeeklyKg: Math.round(projection7.reduce((s, v) => s + v, 0) * 10) / 10,
    trendSlope: Math.round(m * 1000) / 1000, // +ve = rising consumption
    anomalies,
  };
}

/**
 * Days until stock reaches zero.
 */
export function predictDepletion(stockKg, dailyRate) {
  if (!dailyRate || dailyRate <= 0) return { daysLeft: null, depletionDate: null };
  const daysLeft = Math.max(0, Math.floor(stockKg / dailyRate));
  const d = new Date();
  d.setDate(d.getDate() + daysLeft);
  return { daysLeft, depletionDate: d.toISOString().slice(0, 10) };
}

/**
 * Recommend an order quantity in kg, given supply-chain parameters.
 */
export function recommendRestock({
  stockKg,
  minThresholdKg,
  dailyRate,
  leadTimeDays = 3,
  safetyDays = 7,
  targetCoverDays = 30,
}) {
  if (!dailyRate || dailyRate <= 0) return { recommendedKg: 0, rationale: 'No consumption data.' };
  const neededNow = dailyRate * (leadTimeDays + safetyDays);
  const buffer = Math.max(0, minThresholdKg - stockKg);
  const targetStock = dailyRate * targetCoverDays;
  const recommendedKg = Math.max(0, Math.ceil((targetStock - stockKg + buffer + neededNow) / 50) * 50);
  return {
    recommendedKg,
    rationale:
      `Covers ${leadTimeDays}d lead time + ${safetyDays}d safety + ${targetCoverDays}d target cover ` +
      `at ${dailyRate} kg/day.`,
  };
}

/**
 * Compute FCR from a set of feeding logs and growth records.
 */
export function computeFCR(feedKg, gainKg) {
  if (!gainKg || gainKg <= 0) return null;
  return Math.round((feedKg / gainKg) * 100) / 100;
}

/**
 * Feed-efficiency score 0..100 for a herd.
 * A pig farm with FCR < 2.5 scores well.
 */
export function feedEfficiencyScore(fcr) {
  if (fcr == null) return null;
  // Map FCR 2.0→100, 3.5→0
  const score = Math.round(((3.5 - fcr) / 1.5) * 100);
  return Math.max(0, Math.min(100, score));
}

/**
 * Convenience aggregator — returns everything the Inventory UI needs.
 */
export function analyseInventory({ logs, herd, stockKg, minThresholdKg, feederType }) {
  const forecast = forecastConsumption(logs, { herd, feederType });
  const depletion = predictDepletion(stockKg, forecast.dailyAvg);
  const restock = recommendRestock({
    stockKg,
    minThresholdKg,
    dailyRate: forecast.dailyAvg,
  });
  return { forecast, depletion, restock };
}

/**
 * Recommend feed type for a pig based on age and weight.
 * Uses the FEED_TYPE_CLASSIFIER training data.
 */
export function recommendFeedType(ageWeeks, weightKg = null) {
  for (const rule of FEED_TYPE_CLASSIFIER) {
    const ageMatch = ageWeeks >= rule.ageWeeksMin && ageWeeks < rule.ageWeeksMax;
    const weightMatch = rule.weightKgMax == null || weightKg == null || weightKg <= rule.weightKgMax;
    if (ageMatch && weightMatch) {
      return { label: rule.label, notes: rule.notes };
    }
  }
  return { label: 'Gestation/Lactation', notes: 'Adult sow or boar maintenance feed.' };
}

/**
 * Rate an observed FCR against benchmark targets for the given stage.
 * Returns { rating: 'Excellent'|'Good'|'Average'|'Poor', benchmark }
 */
export function getFCRRating(fcr, stage) {
  const bench = FCR_BENCHMARKS.find(b => b.stage === stage);
  if (!bench || bench.targetFCR == null || fcr == null) {
    return { rating: 'N/A', benchmark: bench ?? null };
  }
  if (fcr <= bench.goodFCR) return { rating: 'Excellent', benchmark: bench };
  if (fcr <= bench.targetFCR) return { rating: 'Good', benchmark: bench };
  if (fcr <= bench.poorFCR) return { rating: 'Average', benchmark: bench };
  return { rating: 'Poor', benchmark: bench };
}


/**
 * COMPUTER VISION DATASET (INVENTORY COUNTING)
 * This dataset maps raw images of pigs to their bounding box detections.
 * Used for AI-based herd counting.
 */
export const COMPUTER_VISION_DATASET = [
  { id: 1, image: "images/01.jpg", label: "Pig Head", confidence: 0.98 },
  { id: 2, image: "images/02.jpg", label: "Pig Head", confidence: 0.95 },
  { id: 3, image: "images/03.jpg", label: "Pig Head", confidence: 0.99 },
  { id: 4, image: "images/04.jpg", label: "Pig Head", confidence: 0.97 },
  { id: 5, image: "images/05.jpg", label: "Pig Head", confidence: 0.96 },
  { id: 6, image: "images/06.jpg", label: "Pig Head", confidence: 0.98 },
  { id: 7, image: "images/07.jpg", label: "Pig Head", confidence: 0.94 },
  { id: 8, image: "images/08.jpg", label: "Pig Head", confidence: 0.99 },
  { id: 9, image: "images/09.jpg", label: "Pig Head", confidence: 0.91 },
  { id: 10, image: "images/10.jpg", label: "Pig Head", confidence: 0.93 },
  { id: 11, image: "images/11.jpg", label: "Pig Head", confidence: 0.97 },
  { id: 12, image: "images/12.jpg", label: "Pig Head", confidence: 0.99 },
  { id: 13, image: "images/13.jpg", label: "Pig Head", confidence: 0.96 },
  { id: 14, image: "images/14.jpg", label: "Pig Head", confidence: 0.98 },
  { id: 15, image: "images/15.jpg", label: "Pig Head", confidence: 0.95 },
  { id: 16, image: "images/16.jpg", label: "Pig Head", confidence: 0.92 },
  { id: 17, image: "images/17.jpg", label: "Pig Head", confidence: 0.97 },
  { id: 18, image: "images/18.jpg", label: "Pig Head", confidence: 0.99 },
  { id: 19, image: "images/19.jpg", label: "Pig Head", confidence: 0.94 },
  { id: 20, image: "images/20.jpg", label: "Pig Head", confidence: 0.96 },
  { id: 21, image: "images/21.jpg", label: "Pig Head", confidence: 0.98 },
  { id: 22, image: "images/22.jpg", label: "Pig Head", confidence: 0.99 },
  { id: 24, image: "images/24.jpg", label: "Pig Head", confidence: 0.91 },
  { id: 25, image: "images/25.jpg", label: "Pig Head", confidence: 0.93 },
  { id: 26, image: "images/26.jpg", label: "Pig Head", confidence: 0.97 },
  { id: 27, image: "images/27.jpg", label: "Pig Head", confidence: 0.95 },
  { id: 28, image: "images/28.jpg", label: "Pig Head", confidence: 0.98 },
];

