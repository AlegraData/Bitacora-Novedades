import Link from 'next/link'

const AlegraLogo = ({ size = 40 }: { size?: number }) => (
  <svg viewBox="0 0 60 42" fill="#00C4A0" style={{ width: size, height: size * 0.7 }}>
    <path d="M44.1655 35.523C42.7057 36.262 30.0716 38.8032 20.4654 36.2079C13.2923 34.2614 3.72211 28.6923 0.532056 26.7639C-0.0446777 26.4034 -0.170838 25.6284 0.243689 25.1058L12.0487 10.1467C12.5533 9.51594 13.5446 9.57001 13.9591 10.2549C15.8696 13.2827 20.7177 20.4739 26.467 25.3581C34.1989 31.9184 40.4528 33.7568 44.2016 34.1893C44.6702 34.2434 45.6074 34.7661 44.1655 35.523Z"/>
    <path d="M40.7596 30.3143C39.5701 30.044 31.0273 25.5022 26.7018 19.4104C23.5838 15.0309 20.7902 7.62346 19.7629 4.73979C19.5286 4.09097 19.9252 3.42412 20.592 3.27993L33.8388 0.396268C34.6319 0.216039 35.3528 0.900912 35.2627 1.69392C34.9202 4.57759 34.3975 10.6874 35.3708 15.9861C36.7225 23.4656 39.462 27.5208 41.4265 29.5574C41.6788 29.8097 41.9672 30.5666 40.7777 30.3143H40.7596Z"/>
    <path d="M42.1111 26.8539C41.5704 26.2051 38.7768 20.1494 38.939 14.9948C39.0472 11.4983 40.4349 6.65018 41.1378 4.41534C41.3361 3.76652 42.057 3.46013 42.6878 3.7485L50.3295 7.31703C51.0685 7.65947 51.2307 8.6327 50.672 9.22746C49.1941 10.7955 46.6709 13.6971 45.1209 16.743C42.7419 21.411 42.5436 24.7812 42.7779 26.7277C42.814 26.962 42.6518 27.5027 42.1111 26.8719V26.8539Z"/>
    <path d="M45.2828 24.9437C45.2648 24.4571 46.1299 20.6903 48.0223 18.3833C49.2478 16.9055 51.4286 15.2654 52.6001 14.4363C53.0146 14.148 53.5914 14.2921 53.8257 14.7427L55.8442 18.6357C56.1146 19.1764 55.7721 19.8432 55.1774 19.9333C53.9158 20.1496 51.9152 20.5821 50.2571 21.3751C47.4996 22.6728 46.238 24.1507 45.6613 25.1239C45.5892 25.2501 45.3189 25.4303 45.3008 24.9437H45.2828Z"/>
  </svg>
)

export default function LandingPage() {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', background: '#f0f4f8' }}>
      <nav style={{
        background: '#1e2a3a', height: 60,
        display: 'flex', alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 32px', flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <AlegraLogo />
          <div>
            <div style={{ fontSize: 15, fontWeight: 600, color: '#fff' }}>
              Alegra <span style={{ color: '#00C4A0' }}>·</span> Bitácora
            </div>
            <div style={{ fontSize: 11, color: '#a0aec0' }}>Panel de novedades</div>
          </div>
        </div>
        <Link href="/auth/login" style={{
          padding: '8px 18px', background: '#00C4A0', color: '#fff',
          borderRadius: 8, textDecoration: 'none', fontSize: 13, fontWeight: 600,
        }}>
          Ingresar →
        </Link>
      </nav>

      <main style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '48px 24px' }}>
        <div style={{
          background: '#fff', borderRadius: 16,
          padding: '48px 56px', width: '100%', maxWidth: 520,
          boxShadow: '0 4px 20px rgba(0,0,0,0.08)',
        }}>
          <div style={{
            width: 56, height: 56, background: '#E0F7F4', borderRadius: 14,
            display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 20,
          }}>
            <AlegraLogo size={36} />
          </div>

          <span style={{
            display: 'inline-block', background: '#E0F7F4', color: '#00A888',
            fontSize: 11, fontWeight: 600, padding: '4px 10px', borderRadius: 20,
            textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 12,
          }}>Product</span>

          <h1 style={{ fontSize: 24, fontWeight: 700, color: '#1a202c', lineHeight: 1.3, marginBottom: 8 }}>
            Bitácora Novedades Product
          </h1>
          <p style={{ fontSize: 14, color: '#718096', marginBottom: 32, lineHeight: 1.6 }}>
            Registro centralizado de novedades, pre-novedades y mejoras técnicas del producto.
            Nueva versión con campos dinámicos, filtros avanzados y automatizaciones.
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 32 }}>
            {[
              { icon: '📋', text: 'Campos dinámicos configurables por administradores' },
              { icon: '🔍', text: 'Filtros y búsqueda en tiempo real' },
              { icon: '⚡', text: 'Automatización de correos con campos tipo botón' },
              { icon: '💬', text: 'Chatbot con IA para consultar los registros' },
              { icon: '📊', text: 'Exportación a CSV y Excel' },
              { icon: '🔒', text: 'Control de acceso por roles (Admin / Manager / Viewer)' },
            ].map((item, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 14, color: '#4a5568' }}>
                <span>{item.icon}</span>
                <span>{item.text}</span>
              </div>
            ))}
          </div>

          <Link href="/auth/login" style={{
            display: 'block', width: '100%', padding: 14,
            background: '#00C4A0', color: '#fff', border: 'none',
            borderRadius: 10, fontSize: 15, fontWeight: 600,
            cursor: 'pointer', textAlign: 'center', textDecoration: 'none',
          }}>
            Ingresar a la Bitácora →
          </Link>
        </div>
      </main>

      <footer style={{
        background: '#1e2a3a', height: 48,
        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
      }}>
        <span style={{ color: '#718096', fontSize: 12 }}>Bitácora Novedades Product · New Version · Alegra</span>
      </footer>
    </div>
  )
}
