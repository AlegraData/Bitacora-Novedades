'use client'

import { useState, useEffect } from 'react'

interface Star {
  x: number
  y: number
  size: number
  delay: number
  opacity: number
}

function StarField() {
  const [stars, setStars] = useState<Star[]>([])

  useEffect(() => {
    const generated: Star[] = Array.from({ length: 180 }, () => ({
      x: Math.random() * 100,
      y: Math.random() * 100,
      size: Math.random() * 2.2 + 0.4,
      delay: Math.random() * 3,
      opacity: Math.random() * 0.6 + 0.3,
    }))
    setStars(generated)
  }, [])

  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
      {stars.map((star, i) => (
        <span
          key={i}
          style={{
            position: 'absolute',
            left: `${star.x}%`,
            top: `${star.y}%`,
            width: `${star.size}px`,
            height: `${star.size}px`,
            borderRadius: '50%',
            background: '#ffffff',
            opacity: star.opacity,
            animation: `twinkle 2.5s ${star.delay}s infinite alternate ease-in-out`,
          }}
        />
      ))}
    </div>
  )
}

function AlegraLogo({ size = 44 }: { size?: number }) {
  const h = Math.round(size * 0.7)
  return (
    <svg viewBox="0 0 60 42" fill="#00C4A0" style={{ width: size, height: h }}>
      <path d="M44.1655 35.523C42.7057 36.262 30.0716 38.8032 20.4654 36.2079C13.2923 34.2614 3.72211 28.6923 0.532056 26.7639C-0.0446777 26.4034 -0.170838 25.6284 0.243689 25.1058L12.0487 10.1467C12.5533 9.51594 13.5446 9.57001 13.9591 10.2549C15.8696 13.2827 20.7177 20.4739 26.467 25.3581C34.1989 31.9184 40.4528 33.7568 44.2016 34.1893C44.6702 34.2434 45.6074 34.7661 44.1655 35.523Z"/>
      <path d="M40.7596 30.3143C39.5701 30.044 31.0273 25.5022 26.7018 19.4104C23.5838 15.0309 20.7902 7.62346 19.7629 4.73979C19.5286 4.09097 19.9252 3.42412 20.592 3.27993L33.8388 0.396268C34.6319 0.216039 35.3528 0.900912 35.2627 1.69392C34.9202 4.57759 34.3975 10.6874 35.3708 15.9861C36.7225 23.4656 39.462 27.5208 41.4265 29.5574C41.6788 29.8097 41.9672 30.5666 40.7777 30.3143H40.7596Z"/>
      <path d="M42.1111 26.8539C41.5704 26.2051 38.7768 20.1494 38.939 14.9948C39.0472 11.4983 40.4349 6.65018 41.1378 4.41534C41.3361 3.76652 42.057 3.46013 42.6878 3.7485L50.3295 7.31703C51.0685 7.65947 51.2307 8.6327 50.672 9.22746C49.1941 10.7955 46.6709 13.6971 45.1209 16.743C42.7419 21.411 42.5436 24.7812 42.7779 26.7277C42.814 26.962 42.6518 27.5027 42.1111 26.8719V26.8539Z"/>
      <path d="M45.2828 24.9437C45.2648 24.4571 46.1299 20.6903 48.0223 18.3833C49.2478 16.9055 51.4286 15.2654 52.6001 14.4363C53.0146 14.148 53.5914 14.2921 53.8257 14.7427L55.8442 18.6357C56.1146 19.1764 55.7721 19.8432 55.1774 19.9333C53.9158 20.1496 51.9152 20.5821 50.2571 21.3751C47.4996 22.6728 46.238 24.1507 45.6613 25.1239C45.5892 25.2501 45.3189 25.4303 45.3008 24.9437H45.2828Z"/>
    </svg>
  )
}

export function LoginClient({ signInAction }: { signInAction: () => Promise<void> }) {
  const [phase, setPhase] = useState<'splash' | 'fadeout' | 'login'>('splash')

  useEffect(() => {
    const t1 = setTimeout(() => setPhase('fadeout'), 1800)
    const t2 = setTimeout(() => setPhase('login'), 2400)
    return () => { clearTimeout(t1); clearTimeout(t2) }
  }, [])

  return (
    <>
      <style>{`
        @keyframes twinkle {
          from { opacity: 0.2; transform: scale(0.8); }
          to   { opacity: 1;   transform: scale(1.2); }
        }
        @keyframes floatIn {
          from { opacity: 0; transform: translateY(20px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes pulse-glow {
          0%, 100% { box-shadow: 0 0 0 0 rgba(0,196,160,0); }
          50%       { box-shadow: 0 0 40px 10px rgba(0,196,160,0.25); }
        }
        @keyframes orbit {
          from { transform: rotate(0deg) translateX(90px) rotate(0deg); }
          to   { transform: rotate(360deg) translateX(90px) rotate(-360deg); }
        }
        @keyframes orbit2 {
          from { transform: rotate(120deg) translateX(130px) rotate(-120deg); }
          to   { transform: rotate(480deg) translateX(130px) rotate(-480deg); }
        }
      `}</style>

      {/* Splash screen */}
      {phase !== 'login' && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 9999,
          background: 'radial-gradient(ellipse at 50% 60%, #0d2137 0%, #07111c 55%, #020609 100%)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          opacity: phase === 'fadeout' ? 0 : 1,
          transition: 'opacity 0.6s ease',
        }}>
          <StarField />

          {/* Orbit rings */}
          <div style={{ position: 'absolute', width: 260, height: 260, borderRadius: '50%', border: '1px solid rgba(0,196,160,0.12)', animation: 'none' }} />
          <div style={{ position: 'absolute', width: 380, height: 380, borderRadius: '50%', border: '1px solid rgba(0,196,160,0.07)' }} />

          {/* Orbiting dot 1 */}
          <div style={{ position: 'absolute', width: 0, height: 0 }}>
            <span style={{
              display: 'block', width: 8, height: 8, borderRadius: '50%',
              background: '#00C4A0', boxShadow: '0 0 10px 3px rgba(0,196,160,0.6)',
              animation: 'orbit 4s linear infinite',
            }} />
          </div>

          {/* Orbiting dot 2 */}
          <div style={{ position: 'absolute', width: 0, height: 0 }}>
            <span style={{
              display: 'block', width: 5, height: 5, borderRadius: '50%',
              background: '#60d9c8', boxShadow: '0 0 8px 2px rgba(96,217,200,0.5)',
              animation: 'orbit2 6s linear infinite',
            }} />
          </div>

          {/* Center content */}
          <div style={{
            position: 'relative', zIndex: 2,
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 18,
            animation: 'floatIn 0.8s ease both',
          }}>
            <div style={{
              width: 80, height: 80, borderRadius: 20,
              background: 'rgba(0,196,160,0.12)',
              border: '1.5px solid rgba(0,196,160,0.3)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              animation: 'pulse-glow 2.5s ease infinite',
            }}>
              <AlegraLogo size={50} />
            </div>

            <div style={{ textAlign: 'center' }}>
              <div style={{
                fontSize: 11, fontWeight: 700, letterSpacing: '3px',
                color: '#00C4A0', textTransform: 'uppercase', marginBottom: 10,
              }}>
                Alegra · Product
              </div>
              <h1 style={{
                fontSize: 26, fontWeight: 700, color: '#ffffff',
                letterSpacing: '-0.3px', margin: 0,
              }}>
                Bitácora Novedades
              </h1>
              <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.45)', margin: '8px 0 0' }}>
                Registro centralizado del equipo de producto
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Login card */}
      {phase === 'login' && (
        <div style={{
          minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: '#f0f4f8',
          animation: 'floatIn 0.5s ease both',
        }}>
          <div style={{
            background: '#fff', borderRadius: 16, padding: '40px 48px',
            width: '100%', maxWidth: 440,
            boxShadow: '0 4px 24px rgba(0,0,0,0.08)',
          }}>
            <div style={{
              width: 56, height: 56, background: '#E0F7F4', borderRadius: 14,
              display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 20,
            }}>
              <AlegraLogo size={36} />
            </div>

            <span style={{
              display: 'inline-block', background: '#E0F7F4', color: '#00A888',
              fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 20,
              textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 14,
            }}>
              Product
            </span>

            <h1 style={{ fontSize: 22, fontWeight: 700, color: '#1a202c', margin: '0 0 8px' }}>
              Novedades de Producto
            </h1>
            <p style={{ fontSize: 14, color: '#718096', margin: '0 0 32px', lineHeight: 1.6 }}>
              Registro centralizado de novedades, pre-novedades y mejoras técnicas.
            </p>

            <form action={signInAction}>
              <button
                type="submit"
                style={{
                  width: '100%', padding: '13px 20px',
                  background: '#fff', border: '1.5px solid #e2e8f0',
                  borderRadius: 10, fontSize: 14, fontWeight: 600,
                  cursor: 'pointer', display: 'flex', alignItems: 'center',
                  justifyContent: 'center', gap: 10, color: '#1a202c',
                  transition: 'border-color 0.2s, box-shadow 0.2s',
                }}
                onMouseEnter={e => {
                  const el = e.currentTarget
                  el.style.borderColor = '#00C4A0'
                  el.style.boxShadow = '0 0 0 3px rgba(0,196,160,0.1)'
                }}
                onMouseLeave={e => {
                  const el = e.currentTarget
                  el.style.borderColor = '#e2e8f0'
                  el.style.boxShadow = 'none'
                }}
              >
                <svg viewBox="0 0 24 24" style={{ width: 20, height: 20 }}>
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                </svg>
                Continuar con Google
              </button>
            </form>
          </div>
        </div>
      )}
    </>
  )
}
