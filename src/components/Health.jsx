import React, { useCallback, useState } from 'react';
import { dataAPI } from '../lib/data';
import Swal from 'sweetalert2';
import { useHealthData } from '../hooks/useHealthData';
import { predictDiseaseFromSymptoms } from '../services/aiService';
import { addNotification as pushOwnerNotification } from '../lib/notifications';
import { formatDate } from '../lib/utils';
import styles from './Health.module.css';

// ─── Sub‑components ──────────────────────────────────────────────

const StatsCards = ({ stats }) => (
  <div className={styles.statsGrid}>
    <div className={`${styles.statCard} ${styles.total}`}>
      <div className={styles.statValue}>{stats.total}</div>
      <div className={styles.statLabel}>Total Records</div>
    </div>
    <div className={`${styles.statCard} ${styles.upcoming}`}>
      <div className={styles.statValue}>{stats.upcoming}</div>
      <div className={styles.statLabel}>Upcoming Vaccinations</div>
    </div>
    <div className={`${styles.statCard} ${styles.overdue}`}>
      <div className={styles.statValue}>{stats.overdue}</div>
      <div className={styles.statLabel}>Overdue Treatments</div>
    </div>
    <div className={`${styles.statCard} ${styles.atRisk}`}>
      <div className={styles.statValue}>{stats.atRisk}</div>
      <div className={styles.statLabel}>At‑Risk Pigs</div>
    </div>
  </div>
);

const InsightsPanel = ({ insights }) => {
  if (!insights.length) return null;
  return (
    <div className={styles.insightsPanel}>
      <h4 className={styles.insightsTitle}>
        <i className="fas fa-brain" /> AI Health Insights
      </h4>
      <ul className={styles.insightsList}>
        {insights.map((insight, idx) => (
          <li key={idx} className={styles.insightItem}>
            <span
              className={styles.insightDot}
              style={{ background: insight.urgency === 'high' ? '#ef4444' : insight.urgency === 'medium' ? '#f59e0b' : '#10b981' }}
            />
            {insight.message}
          </li>
        ))}
      </ul>
    </div>
  );
};

const RecordsTable = ({ records, pigs, pigRiskMap, onDelete }) => {
  const getPigInfo = useCallback((pigId) => {
    const pig = pigs.find(p => p.id === pigId);
    return pig ? `${pig.tag} - ${pig.name}` : pigId;
  }, [pigs]);

  const getRiskColor = useCallback((pigId) => {
    return pigRiskMap[pigId]?.color || '#6b7280';
  }, [pigRiskMap]);

  const getPrediction = useCallback((pigId) => {
    return pigRiskMap[pigId]?.predictedCondition || 'N/A';
  }, [pigRiskMap]);

  const getRiskStatus = useCallback((pigId) => {
    return pigRiskMap[pigId]?.status || 'N/A';
  }, [pigRiskMap]);

  return (
    <div className={styles.tableWrapper}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Pig</th>
            <th>Type</th>
            <th>Date</th>
            <th>Next Due</th>
            <th>Risk</th>
            <th>Predicted Illness</th>
            <th style={{ textAlign: 'center' }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {records.map(r => (
            <tr key={r.id}>
              <td>{getPigInfo(r.pig_id)}</td>
              <td>{r.type}</td>
              <td>{formatDate(r.date)}</td>
              <td>{r.next_due ? formatDate(r.next_due) : '-'}</td>
              <td>
                <span className={styles.riskDot} style={{ background: getRiskColor(r.pig_id) }} />
                <span className={styles.riskStatus}>{getRiskStatus(r.pig_id)}</span>
              </td>
              <td>{getPrediction(r.pig_id)}</td>
              <td className={styles.actionsCell}>
                <button onClick={() => onDelete(r.id)} className={styles.deleteBtn}>
                  <i className="fas fa-trash" />
                </button>
              </td>
            </tr>
          ))}
          {!records.length && (
            <tr>
              <td colSpan="7" className={styles.emptyState}>
                No health records yet. Click "Add Record" to start.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
};

const AVAILABLE_SYMPTOMS = [
  { name: 'Coughing',             icon: 'fas fa-wind',                color: '#3b82f6' },
  { name: 'Fever',                icon: 'fas fa-temperature-high',    color: '#ef4444' },
  { name: 'Diarrhea',             icon: 'fas fa-biohazard',           color: '#d97706' },
  { name: 'Vomiting',             icon: 'fas fa-head-side-virus',     color: '#8b5cf6' },
  { name: 'Lethargy',             icon: 'fas fa-bed',                 color: '#6b7280' },
  { name: 'Skin Lesions',         icon: 'fas fa-allergies',           color: '#ec4899' },
  { name: 'Scratching',           icon: 'fas fa-hand-sparkles',       color: '#f59e0b' },
  { name: 'Breathing Difficulty', icon: 'fas fa-lungs',               color: '#2563eb' },
  { name: 'Nasal Discharge',      icon: 'fas fa-tint',                color: '#06b6d4' },
  { name: 'Loss of Appetite',     icon: 'fas fa-utensils-slash',      color: '#10b981' },
  // extended
  { name: 'Sudden Death',         icon: 'fas fa-skull-crossbones',    color: '#111827' },
  { name: 'Lameness',             icon: 'fas fa-shoe-prints',         color: '#a16207' },
  { name: 'Abortion',             icon: 'fas fa-baby',                color: '#be123c' },
  { name: 'Weight Loss',          icon: 'fas fa-weight',              color: '#7c3aed' },
  { name: 'Anemia',               icon: 'fas fa-tint-slash',          color: '#dc2626' },
];


// ─── Main Component ──────────────────────────────────────────────

export default function Health({ profile }) {
  const {
    records,
    pigs,
    loading,
    error,
    loadData,
    insights,
    pigRiskMap,
    stats,
  } = useHealthData();

  // Tab State
  const [activeTab, setActiveTab] = useState('records');

  // AI Diagnostic State
  const [selectedPigId, setSelectedPigId] = useState('');
  const [selectedSymptoms, setSelectedSymptoms] = useState([]);
  const [predictionResults, setPredictionResults] = useState([]);

  // ─── CRUD Handlers ────────────────────────────────────────────

  // ✨ IMPROVED: Add Record form with better UX
  const handleAddRecord = useCallback(async () => {
    // Build pig dropdown options (active pigs only)
    const pigOptions = pigs.filter(p => p.status === 'active').map(p =>
      `<option value="${p.id}">${p.tag} - ${p.name || p.id}</option>`
    ).join('');

    const { value: formValues } = await Swal.fire({
      title: 'Add Health Record',
      html: `
        <div class="health-form">
          <style>
            .health-form {
              text-align: left;
              max-width: 500px;
              margin: 0 auto;
              padding: 4px 0;
            }
            .health-form .form-group {
              margin-bottom: 18px;
            }
            .health-form .form-group label {
              display: block;
              font-weight: 600;
              color: #374151;
              font-size: 14px;
              margin-bottom: 5px;
            }
            .health-form .form-group label i {
              margin-right: 6px;
              color: #6b7280;
              width: 16px;
            }
            .health-form .form-group label .required {
              color: #ef4444;
              margin-left: 2px;
            }
            .health-form .form-row {
              display: grid;
              grid-template-columns: 1fr 1fr;
              gap: 16px;
            }
            .health-form .form-row .form-group {
              margin-bottom: 0;
            }
            .health-form .form-input,
            .health-form .form-select {
              width: 100%;
              padding: 10px 12px;
              border: 1px solid #d1d5db;
              border-radius: 8px;
              font-size: 14px;
              background: white;
              transition: border 0.2s, box-shadow 0.2s;
            }
            .health-form .form-input:focus,
            .health-form .form-select:focus {
              outline: none;
              border-color: #10b981;
              box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.15);
            }
            .health-form .form-input::placeholder {
              color: #9ca3af;
            }
            .health-form .hint {
              font-size: 12px;
              color: #6b7280;
              margin-top: 4px;
            }
            @media (max-width: 480px) {
              .health-form .form-row {
                grid-template-columns: 1fr;
              }
              .health-form .form-row .form-group {
                margin-bottom: 18px;
              }
            }
          </style>

          <div class="form-row">
            <div class="form-group">
              <label><i class="fas fa-piggy-bank"></i> Pig <span class="required">*</span></label>
              <select id="swal-pig" class="form-select">
                <option value="">Select a pig</option>
                ${pigOptions}
              </select>
            </div>
            <div class="form-group">
              <label><i class="fas fa-tag"></i> Record Type <span class="required">*</span></label>
              <select id="swal-type-select" class="form-select">
                <option value="Vaccination">Vaccination</option>
                <option value="Treatment">Treatment</option>
                <option value="Checkup">Checkup</option>
                <option value="Other">Other</option>
              </select>
            </div>
          </div>

          <div class="form-group">
            <label><i class="fas fa-syringe"></i> Vaccine / Treatment <span class="required">*</span></label>
            <input id="swal-type" type="text" class="form-input" placeholder="e.g., Parvo, Antibiotic, Deworming" />
          </div>

          <div class="form-row">
            <div class="form-group">
              <label><i class="fas fa-calendar-check"></i> Date</label>
              <input id="swal-date" type="date" class="form-input" value="${new Date().toISOString().split('T')[0]}" />
            </div>
            <div class="form-group">
              <label><i class="fas fa-calendar-alt"></i> Next due date <span class="hint">(optional)</span></label>
              <input id="swal-nextdue" type="date" class="form-input" />
            </div>
          </div>

          <div class="form-group">
            <label><i class="fas fa-sticky-note"></i> Notes (optional)</label>
            <textarea id="swal-notes" class="form-input" rows="2" placeholder="Any additional information"></textarea>
          </div>
        </div>
      `,
      focusConfirm: false,
      showCancelButton: true,
      confirmButtonText: 'Add Record',
      cancelButtonText: 'Cancel',
      preConfirm: () => {
        const pigId = document.getElementById('swal-pig').value;
        const typeSelect = document.getElementById('swal-type-select').value;
        const typeInput = document.getElementById('swal-type').value.trim();
        const date = document.getElementById('swal-date').value;
        const nextDue = document.getElementById('swal-nextdue').value;
        const notes = document.getElementById('swal-notes').value.trim();

        // Combine dropdown + free-text
        const finalType = typeInput ? `${typeSelect}: ${typeInput}` : typeSelect;

        if (!pigId) {
          Swal.showValidationMessage('Please select a pig');
          return false;
        }
        if (!finalType) {
          Swal.showValidationMessage('Please enter a vaccine or treatment name');
          return false;
        }

        return {
          pigId,
          type: finalType,
          date: date || new Date().toISOString().split('T')[0],
          nextDue: nextDue || null,
          notes
        };
      }
    });

    if (!formValues) return;

    try {
      await dataAPI.health_records.insert({
        pig_id: formValues.pigId,
        type: formValues.type,
        date: formValues.date,
        next_due: formValues.nextDue,
        notes: formValues.notes,
      });

      // Notify the farm owner about the new health record
      const actorName = profile?.username || 'Caretaker';
      const pigLabel = pigs.find(p => p.id === formValues.pigId);
      const pigName = pigLabel ? `${pigLabel.tag} - ${pigLabel.name || pigLabel.id}` : formValues.pigId;
      await pushOwnerNotification(
        'health_recorded',
        `${actorName} added a health record for pig ${pigName}: ${formValues.type}.`,
        'Owner',
        actorName
      );

      Swal.fire('Success', 'Health record added', 'success');
      loadData();
    } catch (err) {
      Swal.fire('Error', err.message || 'Failed to add record', 'error');
    }
  }, [pigs, loadData, profile]);

  const handleDeleteRecord = useCallback(async (id) => {
    const result = await Swal.fire({
      title: 'Delete record?',
      text: 'This action cannot be undone.',
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#d33',
      confirmButtonText: 'Delete',
    });
    if (result.isConfirmed) {
      try {
        await dataAPI.health_records.delete(id);
        Swal.fire('Deleted', 'Record removed', 'success');
        loadData();
      } catch (err) {
        Swal.fire('Error', err.message || 'Failed to delete', 'error');
      }
    }
  }, [loadData]);

  // ─── AI Diagnostic Handlers ─────────────────────────────────────

  const handleToggleSymptom = (symptomName) => {
    setSelectedSymptoms(prev =>
      prev.includes(symptomName)
        ? prev.filter(s => s !== symptomName)
        : [...prev, symptomName]
    );
  };

  const handleAnalyze = () => {
    if (!selectedPigId) {
      Swal.fire('Select Pig', 'Please select a pig to diagnose first.', 'warning');
      return;
    }
    if (selectedSymptoms.length === 0) {
      Swal.fire('Select Symptoms', 'Please check at least one symptom.', 'warning');
      return;
    }
    const pig = pigs.find(p => p.id === selectedPigId);
    const ageWeeks = pig?.birth_date
      ? Math.floor((Date.now() - new Date(pig.birth_date).getTime()) / (7 * 864e5))
      : null;
    const results = predictDiseaseFromSymptoms(selectedSymptoms, {
      ageWeeks,
      weightKg: pig?.weight_kg,
    });
    setPredictionResults(results);
    if (results.length === 0) {
      Swal.fire('No Match', 'No standard sickness matches these symptoms. Monitor the pig closely.', 'info');
    }
  };

  const handleApplyTreatment = async (disease) => {
    if (!selectedPigId) return;

    const nextCheckup = new Date();
    nextCheckup.setDate(nextCheckup.getDate() + 7);
    const nextCheckupStr = nextCheckup.toISOString().split('T')[0];

    const result = await Swal.fire({
      title: 'Apply Treatment Protocol?',
      text: `This will log a treatment record for "${disease.name}" and schedule a 7-day follow-up.`,
      icon: 'question',
      showCancelButton: true,
      confirmButtonText: 'Yes, Apply Protocol',
      cancelButtonText: 'Cancel'
    });

    if (result.isConfirmed) {
      try {
        await dataAPI.health_records.insert({
          pig_id: selectedPigId,
          type: `${disease.name} Treatment`,
          date: new Date().toISOString().split('T')[0],
          next_due: nextCheckupStr,
        });

        // Notify the farm owner about the treatment
        const actorName = profile?.username || 'Caretaker';
        const pigLabel = pigs.find(p => p.id === selectedPigId);
        const pigName = pigLabel ? `${pigLabel.tag} - ${pigLabel.name || pigLabel.id}` : selectedPigId;
        await pushOwnerNotification(
          'health_treatment',
          `${actorName} applied treatment protocol for ${disease.name} on pig ${pigName}. Follow-up due: ${nextCheckupStr}.`,
          'Owner',
          actorName
        );

        Swal.fire('Treatment Logged', 'The treatment has been added to the health logs.', 'success');
        
        // Reset states
        setSelectedSymptoms([]);
        setPredictionResults([]);
        setSelectedPigId('');
        loadData();
        setActiveTab('records');
      } catch (err) {
        Swal.fire('Error', err.message || 'Failed to apply treatment', 'error');
      }
    }
  };

  // ─── Render ────────────────────────────────────────────────────

  if (loading) {
    return <div className={styles.loading}>Loading health data...</div>;
  }

  if (error) {
    return (
      <div className={styles.error}>
        <p>{error}</p>
        <button onClick={loadData} className={styles.retryBtn}>Retry</button>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <h3 className={styles.title}>
          <i className="fas fa-heartbeat" style={{ color: '#ef4444' }} />
          Health & Vaccination Tracker
        </h3>
        {activeTab === 'records' && (
          <button onClick={handleAddRecord} className={styles.addBtn}>
            <i className="fas fa-plus" /> Add Record
          </button>
        )}
      </header>

      {/* Tabs Menu */}
      <div className={styles.tabsContainer}>
        <button
          onClick={() => setActiveTab('records')}
          className={`${styles.tabBtn} ${activeTab === 'records' ? styles.activeTab : ''}`}
        >
          <i className="fas fa-notes-medical"></i> Health Records
        </button>
        <button
          onClick={() => setActiveTab('ai_diagnostic')}
          className={`${styles.tabBtn} ${activeTab === 'ai_diagnostic' ? styles.activeTab : ''}`}
        >
          <i className="fas fa-brain"></i> AI Diagnostic Assistant
        </button>
      </div>

      {activeTab === 'records' && (
        <>
          <StatsCards stats={stats} />
          <InsightsPanel insights={insights} />
          <RecordsTable
            records={records}
            pigs={pigs}
            pigRiskMap={pigRiskMap}
            onDelete={handleDeleteRecord}
          />
        </>
      )}

      {activeTab === 'ai_diagnostic' && (
        <div className={styles.diagnosticWrapper}>
          <div className={styles.diagnosticForm}>
            <h4 style={{ fontSize: 18, fontWeight: '700', marginBottom: 16 }}>
              <i className="fas fa-microchip" style={{ color: '#2563eb', marginRight: 8 }}></i>
              AI Diagnostic Model Inputs
            </h4>

            {/* Select Pig */}
            <div style={{ marginBottom: 20 }}>
              <label className={styles.fieldLabel}>Select Pig to Diagnose</label>
              <select
                value={selectedPigId}
                onChange={(e) => setSelectedPigId(e.target.value)}
                className={styles.dropdown}
              >
                <option value="">-- Choose Pig --</option>
                {pigs.filter(p => p.status === 'active').map(p => (
                  <option key={p.id} value={p.id}>
                    {p.tag} - {p.name || p.id}
                  </option>
                ))}
              </select>
            </div>

            {/* Symptom selection */}
            <label className={styles.fieldLabel}>Observed Symptoms</label>
            <div className={styles.symptomsGrid}>
              {AVAILABLE_SYMPTOMS.map((symptom) => {
                const isSelected = selectedSymptoms.includes(symptom.name);
                return (
                  <div
                    key={symptom.name}
                    onClick={() => handleToggleSymptom(symptom.name)}
                    className={`${styles.symptomItem} ${isSelected ? styles.symptomSelected : ''}`}
                    style={{ '--symptom-color': symptom.color }}
                  >
                    <div className={styles.symptomIconWrapper}>
                      <i className={symptom.icon} style={{ color: isSelected ? 'white' : symptom.color }}></i>
                    </div>
                    <span className={styles.symptomName}>{symptom.name}</span>
                    <input
                      type="checkbox"
                      checked={isSelected}
                      readOnly
                      className={styles.checkbox}
                    />
                  </div>
                );
              })}
            </div>

            <button onClick={handleAnalyze} className={styles.analyzeBtn}>
              <i className="fas fa-microchip"></i> Run AI Diagnosis
            </button>
          </div>

          {/* Diagnosis Results */}
          <div className={styles.diagnosticResults}>
            <h4 style={{ fontSize: 18, fontWeight: '700', marginBottom: 16 }}>
              <i className="fas fa-notes-medical" style={{ color: '#10b981', marginRight: 8 }}></i>
              AI Prediction & Recommendation
            </h4>

            {predictionResults.length === 0 ? (
              <div className={styles.noResults}>
                <i className="fas fa-stethoscope"></i>
                <p>Select a pig, choose symptoms, and click "Run AI Diagnosis" to analyze.</p>
              </div>
            ) : (
              <div className={styles.resultsList}>
                {predictionResults.map((disease, index) => {
                  const isTopMatch = index === 0;
                  const severityColors = {
                    High: '#ef4444',
                    Medium: '#f59e0b',
                    Low: '#10b981'
                  };

                  return (
                    <div
                      key={disease.name}
                      className={`${styles.diseaseCard} ${isTopMatch ? styles.topMatch : ''}`}
                    >
                      <div className={disease.diseaseHeader || styles.diseaseHeader}>
                        <div>
                          <span
                            className={styles.severityBadge}
                            style={{ background: severityColors[disease.severity] }}
                          >
                            {disease.severity} Severity
                          </span>
                          <h5 className={styles.diseaseName}>{disease.name}</h5>
                        </div>
                        <div className={styles.confidenceScore}>
                          {disease.confidence}% Match
                        </div>
                      </div>

                      {/* Confidence bar */}
                      <div className={styles.progressBarBg}>
                        <div
                          className={styles.progressBar}
                          style={{
                            width: `${disease.confidence}%`,
                            background: isTopMatch ? '#10b981' : '#3b82f6'
                          }}
                        ></div>
                      </div>

                      <p className={styles.diseaseDesc}>{disease.description}</p>

                      <div className={styles.matchedSymList}>
                        <strong>Matched symptoms: </strong>
                        {disease.matchedSymptoms.map(sym => (
                          <span key={sym} className={styles.matchedSymBadge}>
                            {sym}
                          </span>
                        ))}
                      </div>

                      {/* Treatment details */}
                      <div className={styles.treatmentBox}>
                        <h6 className={styles.treatmentTitle}>
                          <i className="fas fa-hand-holding-medical"></i> Recommended Cure Protocol:
                        </h6>
                        <p>{disease.cure}</p>
                      </div>

                      {isTopMatch && (
                        <button
                          onClick={() => handleApplyTreatment(disease)}
                          className={styles.applyProtocolBtn}
                        >
                          <i className="fas fa-check-circle"></i> Log Sickness & Apply Cure Protocol
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}