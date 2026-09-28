// FarmInvite.jsx
import { useState, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { dataAPI, getActiveFarm, setActiveFarm, getWithFarmId } from '../lib/data';
import Swal from 'sweetalert2';
import { isOnline } from '../lib/sync';

function generateInviteCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no ambiguous I/0/O/1
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

async function copyToClipboard(text) {
  try {
    if (navigator.clipboard) {
      await navigator.clipboard.writeText(text);
      return;
    }
  } catch (_) { }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  document.execCommand('copy');
  document.body.removeChild(ta);
}

export default function FarmInvite({ profile, onFarmChange }) {
  const [online, setOnline] = useState(isOnline());
  const [farm, setFarm] = useState(null);
  const [members, setMembers] = useState([]);
  const [allProfiles, setAllProfiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showJoinInput, setShowJoinInput] = useState(false);
  const [isCreatingFarm, setIsCreatingFarm] = useState(false);
  const [viewingCaretaker, setViewingCaretaker] = useState(null); // { id, name }

  const [joinCode, setJoinCode] = useState('');
  const [joining, setJoining] = useState(false);

  const activeFarmId = getActiveFarm();
  const isOwner = profile?.role === 'Owner';
  const canJoin = profile?.role !== 'Owner';

  // Determine if owner has a farm (farm_id equals their own id)
  const hasFarm = isOwner && profile?.farm_id === profile?.id;
  // For caretaker, farm exists if they have a supervisor_id
  const hasJoinedFarm = !isOwner && profile?.supervisor_id !== null;

  const realtimeRef = useRef(null);

  useEffect(() => {
    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    if (profile?.id) {
      loadFarmData();
      subscribeToMembers();
    }
    return () => {
      if (realtimeRef.current) {
        supabase.removeChannel(realtimeRef.current);
        realtimeRef.current = null;
      }
    };
  }, [activeFarmId, profile?.id]);

  function subscribeToMembers() {
    // Only subscribe if we have a farm (owner's id or supervisor's id)
    const farmId = isOwner ? profile?.id : profile?.supervisor_id;
    if (!farmId) return;
    if (realtimeRef.current) supabase.removeChannel(realtimeRef.current);
    const channel = supabase
      .channel(`farm_members_${farmId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'profiles', filter: `farm_id=eq.${farmId}` },
        () => { loadFarmData(); }
      )
      .subscribe();
    realtimeRef.current = channel;
  }

  async function loadFarmData() {
    setLoading(true);
    try {
      let farmId = null;
      if (isOwner) {
        farmId = profile?.farm_id || null;
      } else {
        farmId = profile?.supervisor_id || null;
      }

      if (farmId) {
        // Fetch the owner's profile
        const ownerProfile = await dataAPI.profiles.getById(farmId);
        if (ownerProfile) {
          setFarm({
            id: ownerProfile.id,
            name: `${ownerProfile.username || 'Owner'}'s Farm`,
            invite_code: ownerProfile.invite_code
          });
        }

        // Fetch all profiles to get members
        const profileData = await dataAPI.profiles.getAll();
        setAllProfiles(profileData);
        // Members are profiles whose supervisor_id == owner's id (each caretaker has their own farm_id)
        setMembers(profileData.filter(p => p.supervisor_id === farmId));
      } else {
        setFarm(null);
        setMembers([]);
      }
    } catch (err) {
      console.error('Error loading farm data:', err);
    }
    setLoading(false);
  }

  // ── Owner: Create Farm ────────────────────────────────────────────
  async function createFarm() {
    if (!isOwner) return;
    setIsCreatingFarm(true);
    try {
      // Set farm_id to own id (this creates the farm)
      await dataAPI.profiles.update(profile.id, { farm_id: profile.id });
      // Also set active farm in localStorage
      setActiveFarm(profile.id);
      // Reload data
      await loadFarmData();
      // If onFarmChange is provided, notify parent
      if (onFarmChange) onFarmChange(profile.id);
      Swal.fire({
        icon: 'success',
        title: 'Farm Created!',
        text: 'Your farm is now active. You can now generate an invite code to add caretakers.',
        timer: 2000,
        showConfirmButton: false
      });
    } catch (err) {
      Swal.fire('Error', 'Failed to create farm: ' + err.message, 'error');
    } finally {
      setIsCreatingFarm(false);
    }
  }

  // ── Owner: Generate / Regenerate Code ────────────────────────────
  async function generateCode() {
    if (!farm) return;
    setGenerating(true);
    try {
      const code = generateInviteCode();
      await dataAPI.profiles.update(profile.id, { invite_code: code });
      setFarm(prev => ({ ...prev, invite_code: code }));
      await Swal.fire({
        title: '🎉 Invite Code Generated!',
        html: `
          <div style="font-size:36px;font-weight:900;letter-spacing:10px;color:#059669;
                      font-family:monospace;margin:16px 0;padding:14px 24px;
                      background:#ecfdf5;border-radius:12px;display:inline-block;
                      box-shadow:0 2px 8px rgba(5,150,105,0.15)">
            ${code}
          </div>
          <div style="color:#6b7280;font-size:13px;margin-top:10px">
            Share this code with your caretakers so they can join your farm.
          </div>`,
        icon: 'success',
        confirmButtonColor: '#059669',
        confirmButtonText: '📋 Copy & Close',
      });
      await copyToClipboard(code);
    } catch (err) {
      Swal.fire('Error', err.message, 'error');
    }
    setGenerating(false);
  }

  async function revokeCode() {
    const result = await Swal.fire({
      title: 'Revoke invite code?',
      text: 'The current code will be invalidated. No new caretakers can join with it.',
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#ef4444',
      confirmButtonText: 'Revoke',
    });
    if (!result.isConfirmed) return;
    try {
      await dataAPI.profiles.update(profile.id, { invite_code: null });
      setFarm(prev => ({ ...prev, invite_code: null }));
      Swal.fire('Revoked', 'Invite code has been removed.', 'success');
    } catch (err) {
      Swal.fire('Error', err.message, 'error');
    }
  }

  // ── Owner: Remove member ──────────────────────────────────────────
  async function removeMember(memberId, memberName) {
    const result = await Swal.fire({
      title: `Remove ${memberName}?`,
      text: 'This will remove them from the farm. They can rejoin with an invite code.',
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#ef4444',
      confirmButtonText: 'Remove',
    });
    if (!result.isConfirmed) return;
    try {
      // Remove from farm: set farm_id = own id (so they become a standalone user)
      // and set supervisor_id = null
      await dataAPI.profiles.update(memberId, {
        farm_id: memberId,
        supervisor_id: null
      });
      await loadFarmData();
      Swal.fire('Removed', `${memberName} has been removed from the farm.`, 'success');
    } catch (err) {
      Swal.fire('Error', err.message, 'error');
    }
  }

  // ── Caretaker: Join Farm ──────────────────────────────────────────
  async function joinFarm() {
    const code = joinCode.trim().toUpperCase();
    if (!code || code.length < 6) {
      Swal.fire('Error', 'Please enter a valid invite code (at least 6 characters).', 'error');
      return;
    }
    if (!profile?.id) {
      Swal.fire('Error', 'You must be logged in.', 'error');
      return;
    }
    setJoining(true);
    try {
      // Query profiles by invite_code using dataAPI to avoid RLS/schema issues
      const allProfiles = await dataAPI.profiles.getAll();
      const matched = allProfiles.find(p => p.invite_code && p.invite_code.toUpperCase() === code);

      if (!matched) {
        Swal.fire({
          title: 'Invalid Code',
          text: 'No farm found with that invite code. Please check the code with your farm owner.',
          icon: 'error',
          confirmButtonColor: '#059669',
        });
        setJoining(false);
        return;
      }

      // If already a member, show info
      if (profile.farm_id === matched.id) {
        Swal.fire({
          title: 'Already a Member',
          html: `You are already a member of <strong>${matched.username || 'this'}'s Farm</strong>.`,
          icon: 'info',
          confirmButtonColor: '#059669',
        });
        setJoining(false);
        return;
      }

      // Link caretaker to owner via supervisor_id.
      // IMPORTANT: farm_id stays as the caretaker's OWN user ID so their
      // data is isolated from other caretakers on the same farm.
      await dataAPI.profiles.update(profile.id, {
        supervisor_id: matched.id,
        farm_id: profile.id   // <-- own ID = isolated data workspace
      });
      
      try {
        await dataAPI.farm_members.insert({
          farm_id: profile.id, // caretaker's own workspace id
          user_id: profile.id,
          role: profile.role || 'Farm Caretaker'
        });
      } catch(e) {}

      // Active farm = caretaker's own ID (their isolated workspace)
      setActiveFarm(profile.id);

      // Notify success
      await Swal.fire({
        title: '🎉 Joined Farm!',
        html: `<div style="font-size:16px">You are now a member of <strong>${matched.username || 'the owner'}'s Farm</strong>!</div>
               <div style="color:#6b7280;margin-top:8px;font-size:13px">
                 You can now access farm data.
               </div>`,
        icon: 'success',
        confirmButtonColor: '#059669',
      });

      // Reload data and notify parent if needed
      await loadFarmData();
      if (onFarmChange) onFarmChange(matched.id);
      setJoinCode('');
      setShowJoinInput(false);
    } catch (err) {
      console.error('joinFarm error:', err);
      Swal.fire('Error', err.message || 'Failed to join farm. Please try again.', 'error');
    }
    setJoining(false);
  }

  async function handleCopy() {
    if (!farm?.invite_code) return;
    await copyToClipboard(farm.invite_code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function getMemberProfile(userId) {
    return allProfiles.find(p => p.id === userId);
  }

  function getRoleStyle(role) {
    switch ((role || '').toLowerCase()) {
      case 'owner': return { bg: '#dbeafe', color: '#1d4ed8', icon: 'fa-crown' };
      case 'admin': return { bg: '#ede9fe', color: '#6d28d9', icon: 'fa-shield-alt' };
      case 'farm caretaker': return { bg: '#d1fae5', color: '#065f46', icon: 'fa-user-cog' };
      default: return { bg: '#f3f4f6', color: '#6b7280', icon: 'fa-user' };
    }
  }

  // ── Loading ──────────────────────────────────────────────────────
  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', padding: 80 }}>
        <div style={{ textAlign: 'center' }}>
          <i className="fas fa-spinner fa-pulse" style={{ fontSize: 36, color: '#059669' }}></i>
          <p style={{ marginTop: 12, color: '#6b7280', fontSize: 14 }}>Loading farm data…</p>
        </div>
      </div>
    );
  }

  // ── Owner: No farm yet ──────────────────────────────────────────
  if (isOwner && !hasFarm) {
    return (
      <div style={{ maxWidth: 560, margin: '0 auto' }}>
        <div style={{
          background: 'linear-gradient(135deg, #0f766e 0%, #059669 50%, #0d9488 100%)',
          borderRadius: 24, padding: '48px 40px 40px',
          textAlign: 'center', marginBottom: 20,
          boxShadow: '0 12px 40px rgba(5,150,105,0.3)',
        }}>
          <div style={{
            width: 80, height: 80, borderRadius: '50%',
            background: 'rgba(255,255,255,0.2)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            margin: '0 auto 20px',
          }}>
            <i className="fas fa-tractor" style={{ fontSize: 34, color: 'white' }}></i>
          </div>

          <h2 style={{ color: 'white', fontWeight: 900, fontSize: 26, margin: '0 0 8px' }}>
            Create Your Farm
          </h2>
          <p style={{ color: 'rgba(255,255,255,0.8)', fontSize: 14, margin: '0 0 32px', lineHeight: 1.6 }}>
            As a farm owner, you need to create your farm first. After that, you can generate an invite code to add caretakers.
          </p>

          <button
            onClick={createFarm}
            disabled={isCreatingFarm || !online}
            style={{
              background: (isCreatingFarm || !online) ? 'rgba(255,255,255,0.3)' : 'white',
              color: (isCreatingFarm || !online) ? 'rgba(255,255,255,0.6)' : '#059669',
              border: 'none', borderRadius: 14,
              padding: '14px 40px', fontWeight: 800,
              cursor: (isCreatingFarm || !online) ? 'not-allowed' : 'pointer',
              fontSize: 16, display: 'inline-flex', alignItems: 'center', gap: 10,
              boxShadow: (!isCreatingFarm && online) ? '0 6px 20px rgba(0,0,0,0.2)' : 'none',
              transition: 'transform 0.15s, box-shadow 0.2s',
            }}
          >
            <i className={`fas ${isCreatingFarm ? 'fa-spinner fa-spin' : 'fa-plus-circle'}`}></i>
            {isCreatingFarm ? 'Creating…' : 'Create Farm'}
          </button>

          {!online && (
            <div style={{
              marginTop: 16, background: 'rgba(239,68,68,0.2)',
              borderRadius: 10, padding: '8px 16px',
              fontSize: 13, color: '#fecaca',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8
            }}>
              <i className="fas fa-wifi"></i>
              Requires internet connection
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── Caretaker: No farm yet ─────────────────────────────────────
  if (canJoin && !hasJoinedFarm) {
    return (
      <div style={{ maxWidth: 560, margin: '0 auto' }}>
        {/* Gradient hero card */}
        <div style={{
          background: 'linear-gradient(135deg, #0f766e 0%, #059669 50%, #0d9488 100%)',
          borderRadius: 24, padding: '48px 40px 40px',
          textAlign: 'center', marginBottom: 20,
          boxShadow: '0 12px 40px rgba(5,150,105,0.3)',
          position: 'relative', overflow: 'hidden'
        }}>
          <div style={{
            position: 'absolute', top: -30, right: -30,
            width: 160, height: 160, borderRadius: '50%',
            background: 'rgba(255,255,255,0.07)'
          }} />
          <div style={{
            position: 'absolute', bottom: -40, left: -20,
            width: 120, height: 120, borderRadius: '50%',
            background: 'rgba(255,255,255,0.05)'
          }} />

          <div style={{
            width: 80, height: 80, borderRadius: '50%',
            background: 'rgba(255,255,255,0.2)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            margin: '0 auto 20px', backdropFilter: 'blur(8px)',
            border: '2px solid rgba(255,255,255,0.3)'
          }}>
            <i className="fas fa-tractor" style={{ fontSize: 34, color: 'white' }}></i>
          </div>

          <h2 style={{ color: 'white', fontWeight: 900, fontSize: 26, margin: '0 0 8px' }}>
            Join Your Farm
          </h2>
          <p style={{ color: 'rgba(255,255,255,0.8)', fontSize: 14, margin: '0 0 32px', lineHeight: 1.6 }}>
            Enter the 8‑character invite code your farm owner shared with you.
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'center' }}>
            <input
              id="farm-invite-code-input"
              type="text"
              value={joinCode}
              onChange={e => setJoinCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
              maxLength={8}
              placeholder="e.g. AB3D7XYZ"
              autoFocus
              style={{
                width: '100%', maxWidth: 340,
                padding: '16px 20px',
                fontSize: 30, fontWeight: 900, letterSpacing: 12,
                fontFamily: 'monospace',
                border: '2px solid rgba(255,255,255,0.4)',
                background: 'rgba(255,255,255,0.95)',
                borderRadius: 14,
                textAlign: 'center', textTransform: 'uppercase',
                outline: 'none', transition: 'border-color 0.2s, box-shadow 0.2s',
                color: '#065f46',
                boxSizing: 'border-box',
              }}
              onFocus={e => { e.target.style.borderColor = 'white'; e.target.style.boxShadow = '0 0 0 4px rgba(255,255,255,0.25)'; }}
              onBlur={e => { e.target.style.borderColor = 'rgba(255,255,255,0.4)'; e.target.style.boxShadow = 'none'; }}
              onKeyDown={e => { if (e.key === 'Enter') joinFarm(); }}
            />

            {joinCode.length > 0 && joinCode.length < 8 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                {Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} style={{
                    width: 9, height: 9, borderRadius: '50%',
                    background: i < joinCode.length ? 'white' : 'rgba(255,255,255,0.3)',
                    transition: 'background 0.2s'
                  }} />
                ))}
                <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.7)', marginLeft: 6 }}>
                  {8 - joinCode.length} more
                </span>
              </div>
            )}

            <button
              id="farm-invite-join-btn"
              onClick={joinFarm}
              disabled={joining || !online || joinCode.length < 6}
              style={{
                background: (joining || !online || joinCode.length < 6)
                  ? 'rgba(255,255,255,0.3)'
                  : 'white',
                color: (joining || !online || joinCode.length < 6)
                  ? 'rgba(255,255,255,0.6)'
                  : '#059669',
                border: 'none', borderRadius: 14,
                padding: '14px 40px', fontWeight: 800,
                cursor: (joining || !online || joinCode.length < 6) ? 'not-allowed' : 'pointer',
                fontSize: 16, display: 'flex', alignItems: 'center', gap: 10,
                boxShadow: (!joining && online && joinCode.length >= 6)
                  ? '0 6px 20px rgba(0,0,0,0.2)' : 'none',
                transition: 'transform 0.15s, box-shadow 0.2s',
              }}
              onMouseEnter={e => { if (!joining && online && joinCode.length >= 6) e.currentTarget.style.transform = 'translateY(-2px)'; }}
              onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)'; }}
            >
              <i className={`fas ${joining ? 'fa-spinner fa-spin' : 'fa-sign-in-alt'}`}></i>
              {joining ? 'Joining…' : 'Join Farm'}
            </button>
          </div>

          {!online && (
            <div style={{
              marginTop: 16, background: 'rgba(239,68,68,0.2)',
              borderRadius: 10, padding: '8px 16px',
              fontSize: 13, color: '#fecaca',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8
            }}>
              <i className="fas fa-wifi"></i>
              Requires internet connection
            </div>
          )}
        </div>

        {/* How to get a code */}
        <div style={{
          background: 'white', borderRadius: 16, padding: 22,
          boxShadow: '0 2px 12px rgba(0,0,0,0.07)', border: '1px solid #e5e7eb'
        }}>
          <p style={{ margin: '0 0 10px', fontWeight: 700, fontSize: 13, color: '#374151', display: 'flex', alignItems: 'center', gap: 8 }}>
            <i className="fas fa-question-circle" style={{ color: '#059669' }}></i>
            Don't have a code yet?
          </p>
          <ol style={{ margin: 0, paddingLeft: 18, color: '#6b7280', fontSize: 13, lineHeight: 2 }}>
            <li>Ask your farm owner to open the <strong>Farm Access</strong> module.</li>
            <li>They click <strong>Generate Invite Code</strong> and share it with you.</li>
            <li>Enter the 8‑character code in the box above.</li>
            <li>You'll be added to the farm immediately. 🐷</li>
          </ol>
        </div>
      </div>
    );
  }

  // ── Owner with farm OR Caretaker with farm ──────────────────────
  // At this point, the user has a farm (owner has farm_id=id, caretaker has supervisor_id)
  // We show the farm access card and members list.

  const farmId = isOwner ? profile.id : profile.supervisor_id;
  const farmName = farm?.name || (isOwner ? 'My Farm' : 'Your Farm');

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 24 }}>

      {/* ── Farm Access Card ── */}
      <div style={{
        background: 'white',
        borderRadius: '16px',
        padding: '24px',
        boxShadow: '0 4px 12px rgba(0,0,0,0.05)',
        border: '1px solid #e5e7eb',
        borderLeft: '6px solid #3b82f6',
        width: '100%',
        maxWidth: '400px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
          <i className="fas fa-user-friends" style={{ color: '#3b82f6', fontSize: '20px' }}></i>
          <h3 style={{ margin: 0, fontWeight: 800, fontSize: '18px', color: '#111827' }}>Farm Access & Team</h3>
        </div>

        {isOwner && (
          <>
            <p style={{ margin: '0 0 12px 0', fontSize: '14px', color: '#4b5563', lineHeight: '1.5' }}>
              Share this code with your caretakers to join your farm:
            </p>

            <div style={{ display: 'flex', gap: '12px', marginBottom: '20px' }}>
              <div style={{
                flex: 1,
                background: '#eff6ff',
                border: '1px dashed #60a5fa',
                borderRadius: '8px',
                padding: '12px 16px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                minHeight: '48px'
              }}>
                {farm?.invite_code ? (
                  <span style={{ fontSize: '20px', fontWeight: 800, color: '#2563eb', letterSpacing: '4px', fontFamily: 'monospace' }}>
                    {farm.invite_code}
                  </span>
                ) : (
                  <span style={{ fontSize: '14px', color: '#9ca3af', fontWeight: 600 }}>No code yet</span>
                )}
              </div>

              {farm?.invite_code ? (
                <button
                  onClick={handleCopy}
                  title="Copy Code"
                  style={{
                    background: '#3b82f6', color: 'white', border: 'none', borderRadius: '8px',
                    width: '48px', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    cursor: 'pointer', fontSize: 16, transition: 'background 0.2s'
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = '#2563eb'}
                  onMouseLeave={e => e.currentTarget.style.background = '#3b82f6'}
                >
                  <i className={`fas ${copied ? 'fa-check' : 'fa-copy'}`}></i>
                </button>
              ) : (
                <button
                  onClick={generateCode}
                  disabled={!online || generating}
                  style={{
                    background: (!online || generating) ? '#9ca3af' : '#3b82f6',
                    color: 'white', border: 'none', borderRadius: '8px',
                    width: '48px', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    cursor: (!online || generating) ? 'not-allowed' : 'pointer', fontSize: 16,
                    transition: 'background 0.2s'
                  }}
                  title="Generate invite code"
                >
                  <i className={`fas ${generating ? 'fa-spinner fa-spin' : 'fa-magic'}`}></i>
                </button>
              )}
            </div>

            {farm?.invite_code && (
              <button
                onClick={revokeCode}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#ef4444',
                  fontSize: '13px',
                  cursor: 'pointer',
                  textDecoration: 'underline',
                  marginBottom: '16px',
                  display: 'block'
                }}
              >
                Revoke Code
              </button>
            )}

            <div style={{ height: '1px', background: '#e5e7eb', marginBottom: '20px' }}></div>
          </>
        )}

        {!isOwner && (
          <p style={{ margin: '0 0 12px 0', fontSize: '14px', color: '#4b5563', lineHeight: '1.5' }}>
            You are a member of <strong>{farmName}</strong>.
          </p>
        )}

        {/* Join another farm (for caretakers) */}
        {!isOwner && (
          <>
            <p style={{ margin: '0 0 12px 0', fontSize: '14px', color: '#4b5563', lineHeight: '1.5' }}>
              Need to join a different farm? Enter the access code provided by the owner.
            </p>

            {showJoinInput ? (
              <div style={{ display: 'flex', gap: '8px' }}>
                <input
                  type="text"
                  value={joinCode}
                  onChange={e => setJoinCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
                  maxLength={8}
                  placeholder="Code"
                  style={{
                    flex: 1, padding: '10px 12px', fontSize: 16, fontWeight: 700, fontFamily: 'monospace',
                    border: '2px solid #3b82f6', borderRadius: '8px', outline: 'none', color: '#1f2937'
                  }}
                  autoFocus
                  onKeyDown={e => { if (e.key === 'Enter') joinFarm(); }}
                />
                <button
                  onClick={() => joinFarm()}
                  disabled={joining || joinCode.length < 6}
                  style={{
                    background: (joining || joinCode.length < 6) ? '#9ca3af' : '#3b82f6',
                    color: 'white', border: 'none', borderRadius: '8px',
                    padding: '0 16px', fontWeight: 700,
                    cursor: (joining || joinCode.length < 6) ? 'not-allowed' : 'pointer'
                  }}
                >
                  {joining ? <i className="fas fa-spinner fa-spin"></i> : 'Join'}
                </button>
              </div>
            ) : (
              <button
                onClick={() => setShowJoinInput(true)}
                style={{
                  width: '100%', background: 'white', color: '#3b82f6', border: '2px solid #3b82f6',
                  borderRadius: '8px', padding: '10px', fontWeight: 700, cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
                  transition: 'background 0.2s'
                }}
                onMouseEnter={e => e.currentTarget.style.background = '#eff6ff'}
                onMouseLeave={e => e.currentTarget.style.background = 'white'}
              >
                <i className="fas fa-sign-in-alt"></i> Join Another Farm
              </button>
            )}
          </>
        )}
      </div>

      {/* ── Members List ── */}
      {members.length > 0 && (
        <div style={{
          background: 'white', borderRadius: 20, padding: 28,
          boxShadow: '0 4px 24px rgba(0,0,0,0.07)', border: '1px solid #e5e7eb'
        }}>
          <h3 style={{ margin: '0 0 18px', fontWeight: 800, fontSize: 18, color: '#1f2937', display: 'flex', alignItems: 'center', gap: 10 }}>
            <i className="fas fa-users" style={{ color: '#059669' }}></i>
            {farmName} — Members
            <span style={{
              background: 'linear-gradient(135deg,#d1fae5,#a7f3d0)', color: '#065f46',
              borderRadius: 999, padding: '2px 14px', fontSize: 13, fontWeight: 700, marginLeft: 4
            }}>
              {members.length}
            </span>
          </h3>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {members.map(memberProfile => {
              const roleKey = (memberProfile?.role || 'member').toLowerCase();
              const roleStyle = getRoleStyle(roleKey);
              const isCurrentUser = memberProfile.id === profile?.id;
              const displayName = memberProfile?.username || memberProfile?.full_name || memberProfile?.email?.split('@')[0] || 'Unknown User';
              const displayEmail = memberProfile?.email || `User …${(memberProfile.id || '').slice(-6)}`;

              return (
                <div
                  key={memberProfile.id}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 14,
                    padding: '14px 18px',
                    background: isCurrentUser ? '#f0fdf4' : '#f9fafb',
                    borderRadius: 14,
                    border: isCurrentUser ? '1.5px solid #6ee7b7' : '1px solid #e5e7eb',
                    transition: 'box-shadow 0.2s',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.08)'; }}
                  onMouseLeave={e => { e.currentTarget.style.boxShadow = 'none'; }}
                >
                  {/* Click Handler for Owner */}
                  {(() => {
                    const handleMemberClick = () => {
                      if (isOwner) {
                        const joinedDate = memberProfile.created_at ? new Date(memberProfile.created_at).toLocaleDateString() : 'Unknown';
                        Swal.fire({
                          html: `
                            <div style="display: flex; flex-direction: column; align-items: center; margin-bottom: 20px;">
                              <div style="background: ${roleStyle.bg}; color: ${roleStyle.color}; width: 80px; height: 80px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 32px; margin-bottom: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.1);">
                                <i class="fas ${roleStyle.icon}"></i>
                              </div>
                              <h2 style="margin: 0; font-size: 24px; font-weight: 800; color: #1f2937;">${displayName}</h2>
                              <span style="background: ${roleStyle.bg}; color: ${roleStyle.color}; border-radius: 999px; padding: 4px 12px; font-size: 12px; font-weight: 700; margin-top: 8px;">${memberProfile.role || 'Member'}</span>
                            </div>
                            <div style="text-align: left; padding: 16px; background: #f9fafb; border-radius: 12px; border: 1px solid #e5e7eb;">
                              <div style="margin-bottom: 10px; display: flex; align-items: center; gap: 10px;">
                                <i class="fas fa-envelope" style="color: #6b7280; width: 16px;"></i> 
                                <strong style="color: #4b5563;">Email:</strong> ${memberProfile.email || 'N/A'}
                              </div>
                              <div style="margin-bottom: 10px; display: flex; align-items: center; gap: 10px;">
                                <i class="fas fa-calendar-alt" style="color: #6b7280; width: 16px;"></i>
                                <strong style="color: #4b5563;">Joined:</strong> ${joinedDate}
                              </div>
                              <div style="margin-bottom: 0; display: flex; align-items: center; gap: 10px; font-size: 13px;">
                                <i class="fas fa-id-badge" style="color: #9ca3af; width: 16px;"></i>
                                <strong style="color: #9ca3af;">ID:</strong> <span style="color: #9ca3af; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${memberProfile.id}</span>
                              </div>
                            </div>
                          `,
                          showCancelButton: true,
                          confirmButtonColor: '#3b82f6',
                          cancelButtonColor: '#6b7280',
                          confirmButtonText: '<i class="fas fa-chart-line" style="margin-right: 6px;"></i> View Dashboard',
                          cancelButtonText: 'Close'
                        }).then((result) => {
                          if (result.isConfirmed) {
                            setActiveFarm(memberProfile.id);
                            window.location.reload();
                          }
                        });
                      }
                    };

                    return (
                      <>
                        {/* Avatar */}
                        <div 
                          onClick={handleMemberClick}
                          title={isOwner ? "View Account Details" : ""}
                          style={{
                            background: roleStyle.bg, borderRadius: '50%',
                            width: 44, height: 44, display: 'flex',
                            alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                            cursor: isOwner ? 'pointer' : 'default',
                            transition: 'transform 0.2s'
                          }}
                          onMouseEnter={e => { if (isOwner) e.currentTarget.style.transform = 'scale(1.05)'; }}
                          onMouseLeave={e => { if (isOwner) e.currentTarget.style.transform = 'scale(1)'; }}
                        >
                          <i className={`fas ${roleStyle.icon}`} style={{ color: roleStyle.color, fontSize: 17 }}></i>
                        </div>

                        {/* Info */}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 700, color: '#1f2937', fontSize: 14, display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span
                              onClick={handleMemberClick}
                              style={{
                                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                cursor: isOwner ? 'pointer' : 'inherit',
                                color: isOwner ? '#059669' : 'inherit',
                                textDecoration: isOwner ? 'underline' : 'none',
                                transition: 'color 0.2s'
                              }}
                              onMouseEnter={e => { if (isOwner) e.currentTarget.style.color = '#047857'; }}
                              onMouseLeave={e => { if (isOwner) e.currentTarget.style.color = '#059669'; }}
                              title={isOwner ? "View Account Details" : ""}
                            >
                        {displayName}
                      </span>
                      {isCurrentUser && (
                        <span style={{
                          fontSize: 11, color: '#059669', fontWeight: 600,
                          background: '#d1fae5', borderRadius: 999, padding: '1px 8px', flexShrink: 0
                        }}>
                          You
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 12, color: '#9ca3af', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {displayEmail}
                    </div>
                  </div>
                </>
              );
            })()}
                  {/* Role badge */}
                  <span style={{
                    background: roleStyle.bg, color: roleStyle.color,
                    borderRadius: 999, padding: '4px 14px',
                    fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap', flexShrink: 0
                  }}>
                    {memberProfile?.role || 'Member'}
                  </span>

                  {/* Remove button (Owner only, not self) */}
                  {isOwner && !isCurrentUser && (
                    <button
                      onClick={() => removeMember(memberProfile.id, displayName)}
                      title="Remove from farm"
                      style={{
                        background: '#fee2e2', border: 'none', borderRadius: 8,
                        padding: '8px 12px', color: '#ef4444', cursor: 'pointer',
                        fontSize: 14, transition: 'background 0.2s, transform 0.1s', flexShrink: 0
                      }}
                      onMouseEnter={e => { e.currentTarget.style.background = '#fecaca'; e.currentTarget.style.transform = 'scale(1.05)'; }}
                      onMouseLeave={e => { e.currentTarget.style.background = '#fee2e2'; e.currentTarget.style.transform = 'scale(1)'; }}
                    >
                      <i className="fas fa-user-minus"></i>
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Empty member state */}
      {members.length === 0 && (
        <div style={{
          background: 'white', borderRadius: 20, padding: 40, textAlign: 'center',
          boxShadow: '0 1px 6px rgba(0,0,0,0.07)', border: '1px solid #e5e7eb'
        }}>
          <i className="fas fa-users-slash" style={{ fontSize: 40, color: '#d1d5db', marginBottom: 14 }}></i>
          <h4 style={{ color: '#374151', fontWeight: 700, margin: '0 0 6px' }}>No Members Yet</h4>
          <p style={{ color: '#6b7280', fontSize: 13, margin: 0 }}>
            {isOwner
              ? 'Generate an invite code above and share it with your caretakers.'
              : 'Once you join a farm, its members will appear here.'}
          </p>
        </div>
      )}

      {/* ── Caretaker Dashboard Modal (Owner) ── */}
      {viewingCaretaker && (
        <CaretakerDashboardModal
          caretakerId={viewingCaretaker.id}
          caretakerName={viewingCaretaker.name}
          onClose={() => setViewingCaretaker(null)}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CaretakerDashboardModal — read-only view of a caretaker's isolated data
// ─────────────────────────────────────────────────────────────────────────────
function CaretakerDashboardModal({ caretakerId, caretakerName, onClose }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, [caretakerId]);

  async function loadData() {
    setLoading(true);
    try {
      const today = new Date().toISOString().split('T')[0];

      const [pigs, breedings, feedLogs, inventory] = await Promise.all([
        getWithFarmId(caretakerId, 'pigs'),
        getWithFarmId(caretakerId, 'breedings'),
        getWithFarmId(caretakerId, 'feeding_logs', {
          filters: { time: { gte: new Date(Date.now() - 30 * 864e5).toISOString().split('T')[0] } }
        }),
        getWithFarmId(caretakerId, 'inventory', { limit: 1 }),
      ]);

      const activePigs = pigs.filter(p => p.status === 'active').length;
      const upcomingFarrowings = breedings.filter(b => b.expected_farrow >= today);

      // Average daily feed consumption
      let avgDaily = 0;
      if (feedLogs.length > 0) {
        const map = new Map();
        feedLogs.forEach(l => {
          const day = (l.time || '').split('T')[0];
          if (day) map.set(day, (map.get(day) || 0) + (l.amount_kg || 0));
        });
        const total = Array.from(map.values()).reduce((s, v) => s + v, 0);
        avgDaily = map.size > 0 ? Math.round((total / map.size) * 10) / 10 : 0;
      }

      const feedStock = inventory[0]?.feed_stock_kg || 0;

      setData({
        activePigs,
        feedStock,
        avgDaily,
        upcomingFarrowings: upcomingFarrowings.slice(0, 5),
        allPigs: pigs,
      });
    } catch (err) {
      console.error('CaretakerDashboardModal error:', err);
    }
    setLoading(false);
  }

  function daysUntil(dateStr) {
    return Math.ceil((new Date(dateStr) - new Date()) / (1000 * 60 * 60 * 24));
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 16,
    }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        background: 'white', borderRadius: 24,
        width: '100%', maxWidth: 640,
        maxHeight: '90vh', overflowY: 'auto',
        boxShadow: '0 24px 64px rgba(0,0,0,0.25)',
        animation: 'fadeInScale 0.25s cubic-bezier(0.16,1,0.3,1)',
      }}>
        {/* Header */}
        <div style={{
          background: 'linear-gradient(135deg,#0f766e,#059669)',
          borderRadius: '24px 24px 0 0',
          padding: '24px 28px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <button
              onClick={onClose}
              style={{
                background: 'rgba(255,255,255,0.15)', border: 'none', borderRadius: 10,
                color: 'white', cursor: 'pointer', padding: '8px 16px',
                display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 600,
                transition: 'background 0.2s', marginRight: 4, gap: 8
              }}
              onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.25)'}
              onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,255,255,0.15)'}
            >
              <i className="fas fa-arrow-left"></i> Back
            </button>
            <div style={{
              width: 48, height: 48, borderRadius: '50%',
              background: 'rgba(255,255,255,0.2)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <i className="fas fa-user-cog" style={{ color: 'white', fontSize: 20 }}></i>
            </div>
            <div>
              <div style={{ color: 'rgba(255,255,255,0.75)', fontSize: 12, fontWeight: 600, letterSpacing: 1, textTransform: 'uppercase' }}>Caretaker Dashboard</div>
              <div style={{ color: 'white', fontSize: 20, fontWeight: 800 }}>{caretakerName}</div>
            </div>
          </div>
          <button onClick={onClose} style={{
            background: 'rgba(255,255,255,0.15)', border: 'none', borderRadius: 10,
            color: 'white', width: 36, height: 36, cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16,
            transition: 'background 0.2s',
          }}
            onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.25)'}
            onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,255,255,0.15)'}
          >
            <i className="fas fa-times"></i>
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: 28 }}>
          {loading ? (
            <div style={{ textAlign: 'center', padding: 48 }}>
              <i className="fas fa-spinner fa-pulse" style={{ fontSize: 32, color: '#059669' }}></i>
              <p style={{ marginTop: 12, color: '#6b7280' }}>Loading caretaker data…</p>
            </div>
          ) : !data ? (
            <div style={{ textAlign: 'center', padding: 48, color: '#6b7280' }}>
              <i className="fas fa-exclamation-circle" style={{ fontSize: 32, marginBottom: 12, color: '#f59e0b' }}></i>
              <p>Could not load data for this caretaker.</p>
            </div>
          ) : (
            <>
              {/* Stats Grid */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 16, marginBottom: 28 }}>
                <div style={statCard}>
                  <i className="fas fa-piggy-bank" style={{ fontSize: 28, color: '#10b981', marginBottom: 8 }}></i>
                  <div style={{ fontSize: 32, fontWeight: 900, color: '#1f2937' }}>{data.activePigs}</div>
                  <div style={{ fontSize: 13, color: '#6b7280', marginTop: 2 }}>Active Pigs</div>
                </div>
                <div style={statCard}>
                  <i className="fas fa-warehouse" style={{ fontSize: 28, color: '#f59e0b', marginBottom: 8 }}></i>
                  <div style={{ fontSize: 32, fontWeight: 900, color: '#1f2937' }}>{data.feedStock} <span style={{ fontSize: 14, fontWeight: 600 }}>kg</span></div>
                  <div style={{ fontSize: 13, color: '#6b7280', marginTop: 2 }}>Feed Stock</div>
                </div>
                <div style={statCard}>
                  <i className="fas fa-seedling" style={{ fontSize: 28, color: '#3b82f6', marginBottom: 8 }}></i>
                  <div style={{ fontSize: 32, fontWeight: 900, color: '#1f2937' }}>{data.avgDaily} <span style={{ fontSize: 14, fontWeight: 600 }}>kg</span></div>
                  <div style={{ fontSize: 13, color: '#6b7280', marginTop: 2 }}>Avg Daily Feed</div>
                </div>
                <div style={statCard}>
                  <i className="fas fa-calendar-week" style={{ fontSize: 28, color: '#a855f7', marginBottom: 8 }}></i>
                  <div style={{ fontSize: 32, fontWeight: 900, color: '#1f2937' }}>{data.upcomingFarrowings.length}</div>
                  <div style={{ fontSize: 13, color: '#6b7280', marginTop: 2 }}>Upcoming Farrowings</div>
                </div>
              </div>

              {/* Upcoming Farrowings Table */}
              {data.upcomingFarrowings.length > 0 && (
                <div style={{ background: '#f9fafb', borderRadius: 16, padding: 20, marginBottom: 20 }}>
                  <h4 style={{ margin: '0 0 14px', fontWeight: 800, color: '#1f2937', display: 'flex', alignItems: 'center', gap: 8 }}>
                    <i className="fas fa-calendar-check" style={{ color: '#a855f7' }}></i> Upcoming Farrowings
                  </h4>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {data.upcomingFarrowings.map(f => {
                      const pig = data.allPigs.find(p => p.id === f.pig_id);
                      const days = daysUntil(f.expected_farrow);
                      return (
                        <div key={f.id} style={{
                          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                          padding: '10px 14px', background: 'white', borderRadius: 10,
                          border: '1px solid #e5e7eb',
                        }}>
                          <div>
                            <div style={{ fontWeight: 700, fontSize: 14, color: '#1f2937' }}>
                              {pig?.tag || '?'} — {pig?.name || 'Unknown'}
                            </div>
                            <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>
                              {f.expected_farrow} · {days > 0 ? `${days} days left` : 'overdue'}
                            </div>
                          </div>
                          <span style={{
                            padding: '3px 12px', borderRadius: 999, fontSize: 12, fontWeight: 700,
                            background: days <= 7 ? '#fef3c7' : '#e0e7ff',
                            color: days <= 7 ? '#92400e' : '#3730a3',
                          }}>{f.status}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              <div style={{ background: '#ecfdf5', borderRadius: 12, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10 }}>
                <i className="fas fa-info-circle" style={{ color: '#059669' }}></i>
                <span style={{ fontSize: 13, color: '#065f46' }}>This is a read-only view of {caretakerName}'s data.</span>
              </div>
            </>
          )}
        </div>
      </div>

      <style>{`
        @keyframes fadeInScale {
          from { opacity: 0; transform: scale(0.92); }
          to { opacity: 1; transform: scale(1); }
        }
      `}</style>
    </div>
  );
}

const statCard = {
  background: '#f9fafb',
  borderRadius: 16,
  padding: '20px 16px',
  textAlign: 'center',
  border: '1px solid #e5e7eb',
};