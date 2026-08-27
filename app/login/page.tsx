'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { toAuthEmail, isValidUserId, USER_ID_MAX_LENGTH } from '@/lib/authEmail'

export default function LoginPage() {
  const router = useRouter()
  const supabase = createClient()

  const [lang, setLang] = useState<'th' | 'en'>('th')
  const [userId, setUserId] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [warehouses, setWarehouses] = useState<{ warehouse_code: string; name: string }[]>([])
  const [warehouseCode, setWarehouseCode] = useState('')
  const [remember, setRemember] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    supabase
      .from('warehouses')
      .select('warehouse_code, name')
      .eq('active', true)
      .then(({ data }) => {
        if (data) {
          setWarehouses(data)
          if (data[0]) setWarehouseCode(data[0].warehouse_code)
        }
      })
  }, [supabase])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!isValidUserId(userId)) {
      setError(`User ID must be 1-${USER_ID_MAX_LENGTH} characters (letters, numbers, - or _)`)
      return
    }
    setLoading(true)
    const { error: signInError } = await supabase.auth.signInWithPassword({ email: toAuthEmail(userId), password })
    setLoading(false)
    if (signInError) {
      setError('Incorrect User ID or password')
      return
    }
    router.push('/dashboard')
    router.refresh()
  }

  return (
    <div className="login-shell">
      <div className="login-brand-panel">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 44, height: 44, borderRadius: 10, background: 'var(--color-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 19 }}>
            B
          </div>
          <div style={{ lineHeight: 1.2 }}>
            <div style={{ fontSize: 16, fontWeight: 700, letterSpacing: '.08em' }}>BEAUTRIUM</div>
            <div style={{ fontSize: 12.5, color: '#9CA3AF' }}>Order Management System</div>
          </div>
        </div>

        <div style={{ marginTop: 'auto' }}>
          <div style={{ fontSize: 11, letterSpacing: '.12em', color: 'var(--color-primary)', fontWeight: 700, marginBottom: 14 }}>
            ORDER CONSOLIDATION + PICKING PRODUCTIVITY
          </div>
          <h2 style={{ fontSize: 34, fontWeight: 700, lineHeight: 1.25, margin: '0 0 14px', maxWidth: '22ch' }}>
            One order core for consolidation and picking productivity
          </h2>
          <p style={{ fontSize: 14, color: '#9CA3AF', maxWidth: '46ch', margin: 0, lineHeight: 1.7 }}>
            WMS is the source of truth for the pick Bin Code. Zone and pick sequence are joined from Location Master
            on import.
          </p>
        </div>

        <div style={{ marginTop: 'auto', fontSize: 11.5, color: '#6B7280', display: 'flex', gap: 18 }}>
          <span>v1.2</span>
          <span>{warehouses.map((w) => w.name).join(' · ') || 'Bangna DC'}</span>
        </div>
      </div>

      <div className="login-form-panel">
        <form className="login-card" onSubmit={handleSubmit}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 22 }}>
            <div>
              <div style={{ fontSize: 22, fontWeight: 700 }}>Sign in</div>
              <div style={{ fontSize: 12.5, color: '#6B7280' }}>เข้าสู่ระบบ</div>
            </div>
            <div style={{ display: 'flex', border: '1px solid #E5E7EB', borderRadius: 8, overflow: 'hidden', fontSize: 12.5 }}>
              {(['th', 'en'] as const).map((l) => (
                <button
                  key={l}
                  type="button"
                  onClick={() => setLang(l)}
                  style={{
                    padding: '6px 12px',
                    border: 0,
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                    fontWeight: lang === l ? 500 : 400,
                    background: lang === l ? 'var(--color-primary)' : 'transparent',
                    color: lang === l ? '#fff' : '#6B7280',
                  }}
                >
                  {l.toUpperCase()}
                </button>
              ))}
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div className="field">
              <label className="field-label">
                User ID <span className="field-hint">/ รหัสผู้ใช้</span>
              </label>
              <input
                type="text"
                required
                maxLength={USER_ID_MAX_LENGTH}
                autoComplete="username"
                placeholder="e.g. U0001"
                className="field-input"
                value={userId}
                onChange={(e) => setUserId(e.target.value.toUpperCase())}
                style={{ border: '1px solid #E5E7EB' }}
              />
            </div>

            <div className="field">
              <label className="field-label">
                Password <span className="field-hint">/ รหัสผ่าน</span>
              </label>
              <div className="field-input is-focused">
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  style={{ border: 0, outline: 0, font: 'inherit', flex: 1, background: 'transparent' }}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  style={{ border: 0, background: 'none', color: 'var(--color-info)', fontSize: 12, cursor: 'pointer', font: 'inherit' }}
                >
                  {showPassword ? 'Hide' : 'Show'}
                </button>
              </div>
            </div>

            <div className="field">
              <label className="field-label">
                Warehouse <span className="field-hint">/ คลังสินค้า</span>
              </label>
              <select
                className="field-input"
                value={warehouseCode}
                onChange={(e) => setWarehouseCode(e.target.value)}
                style={{ border: '1px solid #E5E7EB', appearance: 'none', cursor: 'pointer' }}
              >
                {warehouses.map((w) => (
                  <option key={w.warehouse_code} value={w.warehouse_code}>
                    {w.name}
                  </option>
                ))}
              </select>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 12.5 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#374151', cursor: 'pointer' }}>
                <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
                Remember this device
              </label>
              <a href="#forgot" style={{ color: 'var(--color-info)', textDecoration: 'none' }} onClick={(e) => e.preventDefault()}>
                Forgot password?
              </a>
            </div>

            {error && (
              <div style={{ fontSize: 12.5, color: 'var(--color-danger)', background: 'var(--color-danger-bg)', borderRadius: 8, padding: '10px 12px' }}>
                {error}
              </div>
            )}

            <button type="submit" className="btn btn-primary" disabled={loading} style={{ height: 46, fontSize: 15 }}>
              {loading ? 'Signing in…' : 'Sign in / เข้าสู่ระบบ'}
            </button>
            <div style={{ fontSize: 11.5, color: '#6B7280', textAlign: 'center', lineHeight: 1.6 }}>
              Access is role-based. Menu visibility and action permission are granted separately by System Admin.
            </div>
          </div>
        </form>
      </div>
    </div>
  )
}
