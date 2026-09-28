// src/services/aiService.js
// ─────────────────────────────────────────────────────────────
// SwineSync Health AI
// Dataset-driven disease prediction & risk scoring for pigs.
// ─────────────────────────────────────────────────────────────

// ── Symptom vocabulary ─────────────────────────────────────────
export const SYMPTOM_VOCAB = [
  'Coughing', 'Fever', 'Diarrhea', 'Vomiting', 'Lethargy',
  'Skin Lesions', 'Scratching', 'Breathing Difficulty',
  'Nasal Discharge', 'Loss of Appetite',
  'Sudden Death', 'Lameness', 'Abortion', 'Weight Loss', 'Anemia',
];

// ── Disease training dataset ───────────────────────────────────
// Each disease has a weighted symptom map: symptom → weight (0-1).
// High-weight symptoms are "cardinal" signs; lower weights are secondary.
export const DISEASE_DATASET = [
  {
    id: 'asf',
    name: 'African Swine Fever (ASF)',
    severity: 'High',
    mortalityRisk: 0.95,
    contagious: true,
    incubationDays: [4, 19],
    atRisk: { ages: ['grower', 'finisher', 'adult'] },
    symptoms: ['Fever', 'Loss of Appetite', 'Lethargy', 'Skin Lesions', 'Vomiting', 'Diarrhea', 'Sudden Death'],
    symptomWeights: {
      'Fever': 0.9, 'Loss of Appetite': 0.8, 'Lethargy': 0.7,
      'Skin Lesions': 0.95, 'Vomiting': 0.6, 'Diarrhea': 0.7,
      'Sudden Death': 1.0, 'Anemia': 0.5,
    },
    description: 'Highly contagious viral hemorrhagic fever with near-100% mortality. No cure or vaccine exists.',
    cure: 'NO cure or vaccine available. Immediately quarantine and report to BAI. Culling of affected animals is mandatory under PH law.',
  },
  {
    id: 'swine-flu',
    name: 'Swine Influenza',
    severity: 'Medium',
    mortalityRisk: 0.05,
    contagious: true,
    incubationDays: [1, 4],
    atRisk: { ages: ['grower', 'finisher', 'adult'] },
    symptoms: ['Coughing', 'Fever', 'Nasal Discharge', 'Lethargy', 'Loss of Appetite'],
    symptomWeights: {
      'Coughing': 0.9, 'Fever': 0.85, 'Nasal Discharge': 0.8,
      'Lethargy': 0.6, 'Loss of Appetite': 0.65,
    },
    description: 'Influenza A virus causing sudden coughing, fever, and nasal discharge. Rarely fatal in healthy adults.',
    cure: 'Isolate affected pigs. Provide warmth, electrolytes, and supportive care. Consult vet for antiviral/anti-inflammatory medication.',
  },
  {
    id: 'prrs',
    name: 'PRRS (Blue Ear Disease)',
    severity: 'High',
    mortalityRisk: 0.35,
    contagious: true,
    incubationDays: [3, 37],
    atRisk: { ages: ['grower', 'finisher', 'adult'] },
    symptoms: ['Fever', 'Breathing Difficulty', 'Coughing', 'Loss of Appetite', 'Lethargy', 'Abortion'],
    symptomWeights: {
      'Fever': 0.8, 'Breathing Difficulty': 0.9, 'Coughing': 0.75,
      'Loss of Appetite': 0.7, 'Lethargy': 0.65, 'Abortion': 0.95,
    },
    description: 'Porcine Reproductive & Respiratory Syndrome. Causes blue discoloration of ears in severe cases.',
    cure: 'No specific cure. Supportive therapy (electrolytes, vitamins). Strict biosecurity, herd isolation, and consult vet for vaccination program.',
  },
  {
    id: 'ppc',
    name: 'Classical Swine Fever (CSF / Hog Cholera)',
    severity: 'High',
    mortalityRisk: 0.80,
    contagious: true,
    incubationDays: [2, 14],
    atRisk: { ages: ['starter', 'grower', 'finisher', 'adult'] },
    symptoms: ['Fever', 'Loss of Appetite', 'Lethargy', 'Diarrhea', 'Vomiting', 'Skin Lesions', 'Sudden Death'],
    symptomWeights: {
      'Fever': 0.85, 'Loss of Appetite': 0.8, 'Lethargy': 0.75,
      'Diarrhea': 0.7, 'Vomiting': 0.65, 'Skin Lesions': 0.7, 'Sudden Death': 0.9,
    },
    description: 'Highly contagious viral disease (Pestivirus). Causes hemorrhagic lesions and nervous signs.',
    cure: 'No treatment. Prevention via vaccination (C-strain) is key. Report immediately; quarantine and movement ban apply.',
  },
  {
    id: 'ped',
    name: 'Porcine Epidemic Diarrhea (PED)',
    severity: 'High',
    mortalityRisk: 0.50,
    contagious: true,
    incubationDays: [1, 3],
    atRisk: { ages: ['pre_starter', 'starter', 'grower'] },
    symptoms: ['Diarrhea', 'Vomiting', 'Loss of Appetite', 'Lethargy', 'Weight Loss'],
    symptomWeights: {
      'Diarrhea': 1.0, 'Vomiting': 0.9, 'Loss of Appetite': 0.7,
      'Lethargy': 0.6, 'Weight Loss': 0.7,
    },
    description: 'Coronavirus causing watery diarrhea, especially devastating in piglets (near 100% mortality under 1 week).',
    cure: 'Oral rehydration therapy. Antibiotics for secondary infections. Keep piglets warm and hydrated. Vaccinate sows pre-farrowing.',
  },
  {
    id: 'mange',
    name: 'Mange (Sarcoptic Scabies)',
    severity: 'Low',
    mortalityRisk: 0.01,
    contagious: true,
    incubationDays: [10, 21],
    atRisk: { ages: ['starter', 'grower', 'finisher', 'adult'] },
    symptoms: ['Scratching', 'Skin Lesions', 'Weight Loss', 'Anemia'],
    symptomWeights: {
      'Scratching': 1.0, 'Skin Lesions': 0.85, 'Weight Loss': 0.5, 'Anemia': 0.4,
    },
    description: 'Sarcoptes scabiei mite infestation causing intense itching, scabs, and thickened skin.',
    cure: 'Injectable ivermectin or doramectin. Treat all in-contact pigs. Clean and disinfect housing. Repeat in 14 days.',
  },
  {
    id: 'ileitis',
    name: 'Swine Dysentery / Ileitis',
    severity: 'Medium',
    mortalityRisk: 0.10,
    contagious: true,
    incubationDays: [7, 60],
    atRisk: { ages: ['grower', 'finisher'] },
    symptoms: ['Diarrhea', 'Loss of Appetite', 'Weight Loss', 'Lethargy', 'Anemia'],
    symptomWeights: {
      'Diarrhea': 0.9, 'Loss of Appetite': 0.7, 'Weight Loss': 0.75,
      'Lethargy': 0.55, 'Anemia': 0.6,
    },
    description: 'Brachyspira hyodysenteriae causes bloody diarrhea or Lawsonia intracellularis causes ileitis.',
    cure: 'Tiamulin or lincomycin medication in feed/water. Improve sanitation and reduce pig density. Consult vet for protocol.',
  },
  {
    id: 'pneumonia',
    name: 'Swine Pneumonia (Mycoplasmal)',
    severity: 'Medium',
    mortalityRisk: 0.15,
    contagious: true,
    incubationDays: [14, 21],
    atRisk: { ages: ['grower', 'finisher'] },
    symptoms: ['Coughing', 'Breathing Difficulty', 'Lethargy', 'Weight Loss', 'Loss of Appetite'],
    symptomWeights: {
      'Coughing': 0.95, 'Breathing Difficulty': 0.85, 'Lethargy': 0.7,
      'Weight Loss': 0.75, 'Loss of Appetite': 0.65,
    },
    description: 'Mycoplasma hyopneumoniae causes chronic dry cough, reduces daily weight gain significantly.',
    cure: 'Lincomycin, tiamulin, or tetracycline. Improve ventilation, reduce stocking density. Vaccination available.',
  },
  {
    id: 'erysipelas',
    name: 'Swine Erysipelas',
    severity: 'Medium',
    mortalityRisk: 0.20,
    contagious: false,
    incubationDays: [1, 7],
    atRisk: { ages: ['grower', 'finisher', 'adult'] },
    symptoms: ['Fever', 'Skin Lesions', 'Lethargy', 'Lameness', 'Loss of Appetite'],
    symptomWeights: {
      'Fever': 0.85, 'Skin Lesions': 0.9, 'Lethargy': 0.65,
      'Lameness': 0.8, 'Loss of Appetite': 0.7,
    },
    description: 'Erysipelothrix rhusiopathiae causes diamond-shaped skin lesions, arthritis, and endocarditis.',
    cure: 'Penicillin is the drug of choice. Vaccinate herd annually. Cull chronic carriers.',
  },
  {
    id: 'iron-deficiency',
    name: 'Iron Deficiency Anemia',
    severity: 'Low',
    mortalityRisk: 0.05,
    contagious: false,
    incubationDays: [7, 21],
    atRisk: { ages: ['pre_starter', 'starter'] },
    symptoms: ['Anemia', 'Lethargy', 'Weight Loss', 'Loss of Appetite'],
    symptomWeights: {
      'Anemia': 1.0, 'Lethargy': 0.7, 'Weight Loss': 0.65, 'Loss of Appetite': 0.6,
    },
    description: 'Common in suckling piglets confined indoors. Causes pale skin, weakness, and poor growth.',
    cure: 'Iron dextran injection (200mg) at 2-3 days of age. Ensure sows receive balanced mineral nutrition.',
  },
];

// ─────────────────────────────────────────────────────────────
// Training Engine: Weighted Jaccard + confidence calibration
// ─────────────────────────────────────────────────────────────

/** Map age in weeks to stage key */
function ageStageFromWeeks(weeks) {
  if (weeks == null) return null;
  if (weeks < 3)  return 'pre_starter';
  if (weeks < 8)  return 'starter';
  if (weeks < 14) return 'grower';
  if (weeks < 26) return 'finisher';
  return 'adult';
}

/** Score a disease against observed symptoms using weighted overlap */
function _scoreDisease(disease, observedSymptoms, context) {
  const weights = disease.symptomWeights || {};
  const fallback = 0.5;
  let weightedMatched = 0;
  let totalWeight = 0;
  const matched = [];

  for (const sym of disease.symptoms) {
    const w = weights[sym] ?? fallback;
    totalWeight += w;
    if (observedSymptoms.includes(sym)) {
      weightedMatched += w;
      matched.push(sym);
    }
  }

  if (totalWeight === 0 || matched.length === 0) return { raw: 0, matched: [] };

  let raw = weightedMatched / totalWeight;

  // Age-group bonus
  if (context && context.ageWeeks != null && disease.atRisk?.ages) {
    const stage = ageStageFromWeeks(context.ageWeeks);
    if (stage && disease.atRisk.ages.includes(stage)) raw = Math.min(1, raw * 1.05);
  }

  // Penalty: single weak symptom match
  if (matched.length === 1 && (weights[matched[0]] ?? fallback) < 0.6) raw *= 0.7;

  return { raw, matched };
}

/**
 * Run the AI diagnostic model.
 * Returns array of disease matches sorted by confidence desc,
 * each: { id, name, severity, confidence, matchedSymptoms, description, cure }
 */
export function predictDiseaseFromSymptoms(symptoms = [], context = {}) {
  if (!Array.isArray(symptoms) || symptoms.length === 0) return [];

  const results = [];
  for (const disease of DISEASE_DATASET) {
    const { raw, matched } = _scoreDisease(disease, symptoms, context);
    if (matched.length === 0) continue;
    // Calibrate: 100% weighted match → 94%, mapped linearly
    const confidence = Math.round(Math.min(94, raw * 94 + 5));
    results.push({
      id: disease.id,
      name: disease.name,
      severity: disease.severity,
      mortalityRisk: disease.mortalityRisk,
      contagious: disease.contagious,
      confidence,
      matchedSymptoms: matched,
      description: disease.description,
      cure: disease.cure,
    });
  }

  const severityRank = { High: 3, Medium: 2, Low: 1 };
  results.sort((a, b) =>
    b.confidence - a.confidence ||
    (severityRank[b.severity] ?? 0) - (severityRank[a.severity] ?? 0)
  );
  return results;
}

// ─────────────────────────────────────────────────────────────
// Risk Scoring
// ─────────────────────────────────────────────────────────────

/**
 * Score a pig's health risk from its records.
 * Returns { status, score, color, predictedCondition }
 */
export function scorePigRisk(pig, records = []) {
  const today = Date.now();
  const pigRecords = [...records]
    .filter(r => r.pig_id === pig.id)
    .sort((a, b) => new Date(b.date) - new Date(a.date));

  if (pigRecords.length === 0) {
    return { status: 'At Risk', score: 50, color: '#f59e0b', predictedCondition: 'No records' };
  }

  const latest = pigRecords[0];
  if (latest.condition === 'Critical') {
    return { status: 'Critical', score: 90, color: '#ef4444', predictedCondition: 'Critical condition' };
  }
  if (latest.condition === 'Sick') {
    return { status: 'At Risk', score: 65, color: '#f59e0b', predictedCondition: 'Sick / Under treatment' };
  }

  const overdue = pigRecords.filter(r => r.next_due && new Date(r.next_due).getTime() < today);
  if (overdue.length > 0) {
    const daysPast = Math.floor((today - new Date(overdue[0].next_due).getTime()) / 86400000);
    if (daysPast > 30) {
      return { status: 'Critical', score: 85, color: '#ef4444', predictedCondition: `Overdue ${daysPast}d` };
    }
    return { status: 'At Risk', score: 55, color: '#f59e0b', predictedCondition: 'Treatment overdue' };
  }

  return { status: 'Healthy', score: 10, color: '#10b981', predictedCondition: 'None' };
}

// ─────────────────────────────────────────────────────────────
// AI Insights Aggregator
// ─────────────────────────────────────────────────────────────

/**
 * Compute AI-driven insights and per-pig risk map.
 * Returns { insights: Array<{urgency, message}>, pigRiskMap: Object }
 */
export function computeAIInsights(records = [], pigs = []) {
  const pigRiskMap = {};
  const insights = [];
  let criticalCount = 0;
  let atRiskCount = 0;
  let overdueCount = 0;
  let noRecordCount = 0;

  for (const pig of pigs) {
    const risk = scorePigRisk(pig, records);
    pigRiskMap[pig.id] = {
      status: risk.status,
      score: risk.score,
      color: risk.color,
      predictedCondition: risk.predictedCondition,
    };
    if (risk.status === 'Critical') criticalCount++;
    else if (risk.status === 'At Risk') {
      atRiskCount++;
      if (risk.predictedCondition === 'No records') noRecordCount++;
    }
  }

  const today = Date.now();
  for (const r of records) {
    if (r.next_due && new Date(r.next_due).getTime() < today) overdueCount++;
  }

  if (criticalCount > 0) {
    insights.push({ urgency: 'high', message: `⚠️ ${criticalCount} pig(s) are in CRITICAL health condition and require immediate attention.` });
  }
  if (overdueCount > 0) {
    insights.push({ urgency: 'medium', message: `${overdueCount} treatment(s) or vaccination(s) are overdue. Schedule a vet visit.` });
  }
  if (atRiskCount > 0) {
    insights.push({ urgency: 'medium', message: `${atRiskCount} pig(s) are At Risk.${noRecordCount > 0 ? ` ${noRecordCount} have no health records on file.` : ''}` });
  }
  if (criticalCount + atRiskCount >= 3) {
    insights.push({ urgency: 'high', message: `Possible outbreak: ${criticalCount + atRiskCount} pigs flagged. Use AI Diagnostic tab and isolate affected animals.` });
  }
  if (insights.length === 0) {
    insights.push({ urgency: 'low', message: '✅ Herd health is optimal. No critical issues detected.' });
  }

  return { insights, pigRiskMap };
}

/**
 * COMPUTER VISION DATASET
 * This dataset maps raw images of pigs to their respective detections (bounding boxes).
 * It is used to train the Computer Vision models for Health tracking and Inventory counting.
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
