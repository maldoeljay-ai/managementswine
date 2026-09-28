import { useState } from 'react'
import { supabase } from '../lib/supabase'
import Swal from 'sweetalert2'

export default function ResetPassword({ onResetComplete }) {
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)

  const handleUpdate = async (e) => {
    e.preventDefault()
    setLoading(true)
    try {
      const { error } = await supabase.auth.updateUser({ password })
      if (error) throw error
      Swal.fire('Success', 'Password updated successfully. You can now use your new password.', 'success')
      onResetComplete()
    } catch (err) {
      Swal.fire('Error', err.message, 'error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(135deg, rgba(6, 78, 59, 0.8), rgba(6, 95, 70, 0.8))', padding: 16 }}>
      <div style={{ background: 'rgba(255,255,255,0.95)', backdropFilter: 'blur(4px)', borderRadius: 32, boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25)', maxWidth: 420, width: '100%', padding: 32 }}>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <div style={{ display: 'inline-flex', padding: 12, background: '#d1fae5', borderRadius: 999, marginBottom: 12 }}>
            <i className="fas fa-lock" style={{ fontSize: 48, color: '#047857' }}></i>
          </div>
          <h2 style={{ fontSize: 28, fontWeight: 900, color: '#1f2937' }}>Reset Password</h2>
          <p style={{ color: '#047857', fontWeight: 500 }}>Enter your new password below</p>
        </div>
        
        <form onSubmit={handleUpdate}>
          <div style={{ marginBottom: 24 }}>
            <label style={{ display: 'block', fontWeight: 600, marginBottom: 4 }}>New Password</label>
            <input 
              type="password" 
              value={password} 
              onChange={(e) => setPassword(e.target.value)} 
              required 
              style={{ width: '100%', border: '2px solid #e5e7eb', borderRadius: 16, padding: '12px 16px', fontSize: 16 }} 
              placeholder="Enter new password"
            />
          </div>
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
              <><i className="fas fa-spinner fa-spin" style={{ marginRight: 8 }}></i> Updating...</>
            ) : (
              <><i className="fas fa-save" style={{ marginRight: 8 }}></i> Update Password</>
            )}
          </button>
        </form>
      </div>
    </div>
  )
}
