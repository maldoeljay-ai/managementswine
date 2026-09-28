import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import Swal from 'sweetalert2'
import bgImage from '../images/153560796_small_pig.jpg'
import { dataAPI } from '../lib/data'

export default function Login({ onLogin }) {
  const [isLogin, setIsLogin] = useState(true)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [username, setUsername] = useState('')
  const [farmName, setFarmName] = useState('') // Used for invite code during signup
  const [role, setRole] = useState('Farm Caretaker')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [online, setOnline] = useState(navigator.onLine)
  const [showPassword, setShowPassword] = useState(false)

  useEffect(() => {
    const handleOnline = () => setOnline(true)
    const handleOffline = () => setOnline(false)
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    const formatPhone = (num) => {
      if (!num) return num;
      let cleaned = num.replace(/[\s\-()]/g, '');
      if (cleaned.startsWith('09') && cleaned.length === 11) return '+63' + cleaned.substring(1);
      if (cleaned.startsWith('9') && cleaned.length === 10) return '+63' + cleaned;
      if (cleaned.startsWith('639')) return '+' + cleaned;
      if (!cleaned.startsWith('+') && cleaned.length >= 7 && !cleaned.includes('@')) return '+' + cleaned;
      return cleaned;
    }

    try {
      if (isLogin) {
        const isPhoneNumber = /^\+?[0-9\s\-()]{7,}$/.test(email) && !email.includes('@');
        const formattedId = isPhoneNumber ? formatPhone(email) : email;
        const credentials = isPhoneNumber ? { phone: formattedId, password } : { email: formattedId, password };
        const { error } = await supabase.auth.signInWithPassword(credentials)
        if (error) throw error
        
        onLogin()
      } else {
        const isPhoneNumber = /^\+?[0-9\s\-()]{7,}$/.test(email) && !email.includes('@');
        const formattedId = isPhoneNumber ? formatPhone(email) : email;
        const credentials = isPhoneNumber ? { phone: formattedId, password } : { email: formattedId, password };

        // Pass username & role so the handle_new_user trigger can create the profile row.
        const { data, error } = await supabase.auth.signUp({
          ...credentials,
          options: {
            data: {
              username: username,
              role: role,
            }
          }
        })
        if (error) throw error

        if (data?.user?.identities?.length === 0) {
          Swal.fire('Info', 'This account is already registered. Please log in.', 'info')
          setIsLogin(true)
        } else {
          // Update the profile with username and role (in case trigger didn't run)
          if (data.user) {
            try {
              await dataAPI.profiles.update(data.user.id, { username, role });
            } catch (_) { /* ignore — profile may not exist yet if email confirm is required */ }
          }

          // ---- 🔑 INVITE CODE HANDLING ----
          // If a session exists (auto‑confirm enabled) and an invite code was provided,
          // automatically join the farm during signup.
          if (data.session && data.user && farmName) {
            try {
              const searchCode = farmName.trim().toUpperCase();
              const allFarms = await dataAPI.farms.getAll();
              // Match by invite_code first, then by farm name (fallback)
              const matchedFarm = allFarms.find(f =>
                (f.invite_code && f.invite_code.toUpperCase() === searchCode) ||
                (f.name && f.name.toLowerCase() === farmName.trim().toLowerCase()) ||
                (f.farm_name && f.farm_name.toLowerCase() === farmName.trim().toLowerCase())
              );
              if (matchedFarm) {
                await dataAPI.farm_members.insert({
                  farm_id: matchedFarm.id,
                  user_id: data.user.id,
                  role: role
                });
                await dataAPI.profiles.update(data.user.id, { farm_id: matchedFarm.id });
              }
            } catch (err) {
              console.warn('Could not automatically join farm during signup:', err);
            }
          }

          Swal.fire('Success', 'Registration successful! Please check your email or phone to confirm (if required), then log in.', 'success')
          setIsLogin(true)
        }
        setEmail('')
        setPassword('')
        setUsername('')
        setFarmName('')
      }
    } catch (err) {
      console.error('Auth Error:', err);
      let rawMsg = typeof err === 'string' ? err : (err?.message || err?.error_description || err?.msg || JSON.stringify(err, Object.getOwnPropertyNames(err)));

      // Handle stringified JSON arrays (Supabase sometimes returns validation errors this way)
      if (typeof rawMsg === 'string' && rawMsg.trim().startsWith('[') && rawMsg.trim().endsWith(']')) {
        try {
          const parsed = JSON.parse(rawMsg);
          if (Array.isArray(parsed)) {
            rawMsg = parsed.length > 0 ? parsed.join(', ') : '';
          }
        } catch (_) {}
      }

      if (Array.isArray(rawMsg)) rawMsg = rawMsg.join(', ');
      if (typeof rawMsg !== 'string') rawMsg = JSON.stringify(rawMsg);
      
      if (!rawMsg || rawMsg === '[]' || rawMsg === '{}') {
        rawMsg = `An unexpected authentication error occurred. Please try again. (Details: ${String(err)})`;
      }

      const msg = rawMsg.toLowerCase();

      if (msg.includes('email rate limit') || msg.includes('rate limit exceeded') || msg.includes('over_email_send_rate_limit')) {
        const result = await Swal.fire({
          title: '📧 Email Rate Limit Reached',
          html: `
            <div style="font-size:14px;color:#374151;line-height:1.7">
              <p>Supabase is temporarily limiting confirmation emails for this address.</p>
              <p>This usually means your account <strong>was already created</strong> or a confirmation email was already sent.</p>
              <hr style="margin:12px 0;border:none;border-top:1px solid #e5e7eb">
              <p style="color:#6b7280">Please check your inbox (and spam folder) for a confirmation link, then try logging in.</p>
            </div>`,
          icon: 'warning',
          showCancelButton: true,
          confirmButtonColor: '#059669',
          cancelButtonColor: '#6b7280',
          confirmButtonText: '→ Go to Login',
          cancelButtonText: 'Stay Here',
        });
        if (result.isConfirmed) {
          setIsLogin(true);
          setError('');
        } else {
          setError('Email rate limit reached. Please wait a few minutes and try again.');
        }
      } else if (msg.includes('user already registered') || msg.includes('already been registered')) {
        Swal.fire({
          title: 'Account Exists',
          text: 'This email is already registered. Please log in instead.',
          icon: 'info',
          confirmButtonColor: '#059669',
          confirmButtonText: '→ Go to Login',
        }).then(() => {
          setIsLogin(true);
          setError('');
        });
      } else {
        setError(rawMsg || 'An unexpected error occurred. Please try again.');
      }
    } finally {
      setLoading(false)
    }
  }

  const handleGoogleLogin = async () => {
    try {
      setLoading(true)
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
      })
      if (error) throw error
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const handleForgotPassword = async () => {
    const { value: resetEmail } = await Swal.fire({
      title: 'Reset Password',
      input: 'email',
      inputLabel: 'Enter your email address',
      inputPlaceholder: 'name@example.com',
      inputValue: email,
      showCancelButton: true,
      confirmButtonColor: '#059669',
      cancelButtonColor: '#6b7280',
      confirmButtonText: 'Send Reset Link',
      inputValidator: (value) => {
        if (!value) {
          return 'You need to enter an email address!'
        }
      }
    });

    if (!resetEmail) {
      return;
    }

    setLoading(true)
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(resetEmail, {
        redirectTo: window.location.origin,
      })
      if (error) throw error
      Swal.fire('Success', 'Password reset email sent! Check your inbox.', 'success')
    } catch (err) {
      Swal.fire('Error', err.message, 'error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, position: 'relative', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', inset: 0, backgroundImage: `url(${bgImage})`, backgroundSize: 'cover', backgroundPosition: 'center' }}></div>
      <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(135deg, rgba(6, 78, 59, 0.8), rgba(6, 95, 70, 0.8))' }}></div>
      <div style={{ position: 'relative', zIndex: 10, background: 'rgba(255,255,255,0.9)', backdropFilter: 'blur(4px)', borderRadius: 32, boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25)', maxWidth: 420, width: '100%', padding: 32, border: '1px solid rgba(255,255,255,0.4)' }}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{ display: 'inline-flex', padding: 12, background: '#d1fae5', borderRadius: 999, marginBottom: 12 }}>
            <i className="fas fa-piggy-bank" style={{ fontSize: 48, color: '#047857' }}></i>
          </div>
          <h1 style={{ fontSize: 36, fontWeight: 900, color: '#1f2937' }}>SwineSync</h1>
          <p style={{ color: '#047857', fontWeight: 500 }}>AI-Powered Herd Management</p>
        </div>

        {!online && (
          <div style={{ background: '#fee2e2', border: '1px solid #fca5a5', padding: '10px 16px', borderRadius: 16, color: '#b91c1c', fontSize: 13, marginBottom: 20, display: 'flex', alignItems: 'center', gap: 8, lineHeight: 1.4 }}>
            <i className="fas fa-exclamation-triangle" style={{ fontSize: 16, flexShrink: 0 }}></i>
            <span><strong>Offline Mode active.</strong> Logging in with new credentials or signing up requires internet. Your last active session will be loaded if cached.</span>
          </div>
        )}

        <form onSubmit={handleSubmit}>
          {!isLogin && (
            <>
              <div style={{ marginBottom: 16 }}>
                <label style={{ display: 'block', fontWeight: 600, marginBottom: 4 }}>Username</label>
                <input type="text" value={username} onChange={(e) => setUsername(e.target.value)} required style={{ width: '100%', border: '2px solid #e5e7eb', borderRadius: 16, padding: '12px 16px', fontSize: 16 }} />
              </div>
              <div style={{ marginBottom: 16 }}>
                <label style={{ display: 'block', fontWeight: 600, marginBottom: 4 }}>Role</label>
                <select value={role} onChange={(e) => setRole(e.target.value)} style={{ width: '100%', border: '2px solid #e5e7eb', borderRadius: 16, padding: '12px 16px', fontSize: 16, background: 'white' }}>
                  <option value="Farm Caretaker">Farm Caretaker</option>
                  <option value="Owner">Farm Owner</option>
                </select>
                <p style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>Select your role – If joining an existing farm, select Farm Caretaker and enter the invite code below.</p>
              </div>
              {role === 'Farm Caretaker' && (
                <div style={{ marginBottom: 16 }}>
                  <label style={{ display: 'block', fontWeight: 600, marginBottom: 4 }}>Farm Invite Code <span style={{ color: '#9ca3af', fontWeight: 400 }}>(optional)</span></label>
                  <input
                    type="text"
                    value={farmName}
                    onChange={(e) => setFarmName(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8))}
                    maxLength={8}
                    style={{ width: '100%', border: '2px solid #e5e7eb', borderRadius: 16, padding: '12px 16px', fontSize: 20, textTransform: 'uppercase', letterSpacing: 6, fontFamily: 'monospace', textAlign: 'center' }}
                    placeholder="AB3D7XYZ"
                  />
                  <p style={{ fontSize: 11, color: '#9ca3af', marginTop: 4, marginBottom: 0 }}>Ask your farm owner for the 8-character invite code.</p>
                </div>
              )}
            </>
          )}
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', fontWeight: 600, marginBottom: 4 }}>Email or Phone Number</label>
            <input type="text" value={email} onChange={(e) => setEmail(e.target.value)} required style={{ width: '100%', border: '2px solid #e5e7eb', borderRadius: 16, padding: '12px 16px', fontSize: 16 }} placeholder="Email or Phone (e.g. +1234567890)" />
          </div>
          <div style={{ marginBottom: 24 }}>
            <label style={{ display: 'block', fontWeight: 600, marginBottom: 4 }}>Password</label>
            <div style={{ position: 'relative' }}>
              <input type={showPassword ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)} required style={{ width: '100%', border: '2px solid #e5e7eb', borderRadius: 16, padding: '12px 16px', fontSize: 16, paddingRight: 48 }} />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: '#6b7280', cursor: 'pointer', padding: 4 }}
              >
                <i className={`fas ${showPassword ? 'fa-eye-slash' : 'fa-eye'}`}></i>
              </button>
            </div>
            {isLogin && (
              <div style={{ textAlign: 'right', marginTop: 8 }}>
                <button
                  type="button"
                  onClick={handleForgotPassword}
                  style={{ background: 'none', border: 'none', color: '#047857', fontSize: 13, cursor: 'pointer', padding: 0, fontWeight: '500', textDecoration: 'underline' }}
                >
                  Forgot Password?
                </button>
              </div>
            )}
          </div>
          {error && (
            <div style={{
              marginBottom: 16,
              background: '#fef2f2',
              border: '1px solid #fecaca',
              borderRadius: 12,
              padding: '10px 14px',
              color: '#dc2626',
              fontSize: 13,
              display: 'flex',
              alignItems: 'flex-start',
              gap: 8,
              lineHeight: 1.5,
            }}>
              <i className="fas fa-exclamation-circle" style={{ marginTop: 1, flexShrink: 0 }}></i>
              <span>{error}</span>
            </div>
          )}
          <button
            type="submit"
            disabled={loading}
            style={{
              width: '100%',
              background: loading ? '#9ca3af' : 'linear-gradient(135deg, #059669, #0d9488)',
              color: 'white',
              fontWeight: 'bold',
              padding: 12,
              borderRadius: 16,
              border: 'none',
              fontSize: 16,
              cursor: loading ? 'not-allowed' : 'pointer',
              opacity: loading ? 0.7 : 1,
              transition: 'all 0.2s'
            }}
          >
            {loading ? (
              <><i className="fas fa-spinner fa-spin" style={{ marginRight: 8 }}></i> Please wait...</>
            ) : (
              <><i className="fas fa-sign-in-alt" style={{ marginRight: 8 }}></i> {isLogin ? 'Enter SwineSync' : 'Create Account'}</>
            )}
          </button>
        </form>

        <div style={{ marginTop: 24, textAlign: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', margin: '16px 0' }}>
            <div style={{ flex: 1, height: 1, background: '#e5e7eb' }}></div>
            <span style={{ padding: '0 12px', color: '#6b7280', fontSize: 14 }}>OR</span>
            <div style={{ flex: 1, height: 1, background: '#e5e7eb' }}></div>
          </div>

          <button
            onClick={handleGoogleLogin}
            disabled={loading || !online}
            style={{
              width: '100%',
              background: 'white',
              color: '#374151',
              fontWeight: '600',
              padding: 12,
              borderRadius: 16,
              border: '2px solid #e5e7eb',
              fontSize: 16,
              cursor: (loading || !online) ? 'not-allowed' : 'pointer',
              opacity: (loading || !online) ? 0.7 : 1,
              transition: 'all 0.2s',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8
            }}
          >
            <i className="fab fa-google" style={{ color: '#ea4335' }}></i>
            Sign in with Google
          </button>
        </div>

        <button
          onClick={() => setIsLogin(!isLogin)}
          style={{ marginTop: 24, width: '100%', color: '#047857', textDecoration: 'underline', background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, fontWeight: '500' }}
        >
          {isLogin ? ' Create New Account' : '← Back to Login'}
        </button>
      </div>
    </div>
  )
}