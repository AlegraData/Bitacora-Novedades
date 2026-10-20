'use client'

import { useState } from 'react'
import { API_BASE_URL, SCOPES, MAX_KEYS_PER_USER } from '@/lib/api/constants'
import { ENDPOINTS, ERRORS, SNIPPETS } from '@/lib/api/docs'
import { CodeBlock } from './ui'

const METHOD_COLOR = { GET: '#2b6cb0', POST: '#276749', PATCH: '#9c4221', DELETE: '#c53030' } as const

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ background: '#fff', borderRadius: 12, boxShadow: '0 2px 8px rgba(0,0,0,0.06)', padding: '20px 24px', marginBottom: 20 }}>
      <h2 style={{ fontSize: 16, fontWeight: 600, color: '#1a202c', marginBottom: 10 }}>{title}</h2>
      {children}
    </div>
  )
}

const p = { fontSize: 13, color: '#718096', marginBottom: 8, lineHeight: 1.6 } as const

export function ApiDocs() {
  const [lang, setLang] = useState<keyof typeof SNIPPETS>('appsScript')
  const [open, setOpen] = useState<string | null>(null)

  return (
    <div>
      <Section title="URL base y autenticación">
        <CodeBlock code={API_BASE_URL} />
        <p style={{ ...p, marginTop: 12 }}>
          Todas las llamadas llevan el header <code>Authorization: Bearer &lt;token&gt;</code>. Las respuestas son JSON. El token se manda <strong>solo por header</strong>
          (nunca en la URL) y el servidor no habilita CORS: está pensado para scripts y servicios, no para llamarlo desde el navegador.
        </p>
        <p style={p}>
          Un token <strong>actúa con tu mismo rol</strong> y respeta tus permisos; los scopes pueden además limitarlo (por ejemplo, solo lectura). Cada persona puede tener hasta <strong>{MAX_KEYS_PER_USER} tokens activos</strong> y
          vencen a los 30, 90, 180 o 365 días. Especificación OpenAPI: <a href="/api/v1/openapi.json" style={{ color: '#00A888' }}>/api/v1/openapi.json</a>.
        </p>
      </Section>

      <Section title="Primeros pasos">
        <div style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
          {([['appsScript', 'Apps Script'], ['curl', 'curl'], ['node', 'Node.js'], ['python', 'Python']] as const).map(([k, label]) => (
            <button key={k} onClick={() => setLang(k)} style={{ padding: '5px 12px', borderRadius: 6, border: '1px solid #cbd5e1', background: lang === k ? '#1e2a3a' : '#fff', color: lang === k ? '#fff' : '#4a5568', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
              {label}
            </button>
          ))}
        </div>
        <CodeBlock code={SNIPPETS[lang]} />
        <p style={{ ...p, marginTop: 10 }}>Guarda el token como secreto (Propiedades del script, variable de entorno, gestor de secretos). Nunca en el código ni en el repositorio.</p>
      </Section>

      <Section title="Permisos (scopes)">
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <tbody>
            {Object.entries(SCOPES).map(([s, d]) => (
              <tr key={s} style={{ borderTop: '1px solid #edf2f7' }}>
                <td style={{ padding: '8px 0', width: 160 }}><code style={{ fontWeight: 600 }}>{s}</code></td>
                <td style={{ padding: '8px 0', color: '#4a5568' }}>{d}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p style={{ ...p, marginTop: 10 }}>Para una integración que solo consulta (como un reverse-sync) crea el token únicamente con <code>records:read</code>.</p>
      </Section>

      <Section title="Endpoints">
        <p style={p}>Los mismos que las tools del MCP, más <code>/me</code> y <code>/fields</code>. Haz clic en uno para ver parámetros y un ejemplo.</p>
        {ENDPOINTS.map((e) => {
          const id = `${e.method} ${e.path}`
          const isOpen = open === id
          return (
            <div key={id} style={{ border: '1px solid #e2e8f0', borderRadius: 8, marginBottom: 8 }}>
              <button onClick={() => setOpen(isOpen ? null : id)} style={{ width: '100%', display: 'flex', gap: 10, alignItems: 'center', padding: '10px 12px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left' }}>
                <span style={{ minWidth: 56, fontSize: 11, fontWeight: 700, color: METHOD_COLOR[e.method] }}>{e.method}</span>
                <code style={{ fontSize: 13, color: '#1a202c' }}>{e.path}</code>
                <span style={{ fontSize: 12, color: '#718096', flex: 1 }}>{e.summary}</span>
                <span style={{ fontSize: 11, color: '#a0aec0' }}>{e.scope ?? 'cualquier token'}</span>
              </button>
              {isOpen && (
                <div style={{ padding: '0 12px 12px' }}>
                  {e.mcpTool && <p style={{ ...p, marginBottom: 4 }}>Equivale a la tool MCP <code>{e.mcpTool}</code>.</p>}
                  {e.params.length > 0 && (
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                      <tbody>
                        {e.params.map((pr) => (
                          <tr key={pr.name + pr.in} style={{ borderTop: '1px solid #edf2f7' }}>
                            <td style={{ padding: '6px 8px 6px 0', width: 190, verticalAlign: 'top' }}>
                              <code style={{ fontWeight: 600 }}>{pr.name}</code>
                              {pr.required && <span style={{ color: '#c53030' }}> *</span>}
                              <div style={{ color: '#a0aec0' }}>{pr.in} · {pr.type}</div>
                            </td>
                            <td style={{ padding: '6px 0', color: '#4a5568' }}>{pr.description}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                  <CodeBlock code={e.example} />
                </div>
              )}
            </div>
          )
        })}
      </Section>

      <Section title="Errores">
        <p style={p}>Todo error responde <code>{'{ "error": { "code": "...", "message": "..." } }'}</code>.</p>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <tbody>
            {ERRORS.map((er) => (
              <tr key={er.status} style={{ borderTop: '1px solid #edf2f7', verticalAlign: 'top' }}>
                <td style={{ padding: '8px 12px 8px 0', fontWeight: 700 }}>{er.status}</td>
                <td style={{ padding: '8px 12px 8px 0' }}><code style={{ fontSize: 12 }}>{er.code}</code></td>
                <td style={{ padding: '8px 0', color: '#4a5568' }}>{er.meaning}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section title="Límites, auditoría y buenas prácticas">
        <ul style={{ ...p, paddingLeft: 20 }}>
          <li><strong>Rate limit:</strong> 120 requests por minuto por token (cabeceras <code>X-RateLimit-Limit</code> y <code>X-RateLimit-Remaining</code>). Paginación máxima de 200 registros.</li>
          <li><strong>Auditoría:</strong> toda lectura y escritura queda registrada con el canal <code>api</code> y el token usado. En la tabla de arriba, «Ver uso» muestra cuándo, desde qué IP y con qué cliente se consulta cada token.</li>
          <li><strong>Escrituras:</strong> crear o editar una Novedad/Pre-novedad completa dispara automáticamente la comunicación a PMKT (igual que en la app y el MCP). Probar en datos reales tiene efectos reales.</li>
          <li><strong>Rotación:</strong> el valor de un token no se puede ver después de crearlo. Para rotarlo, crea uno nuevo, actualiza tu integración y revoca el anterior.</li>
          <li><strong>Si se filtra un token:</strong> revócalo de inmediato aquí mismo; deja de funcionar al instante.</li>
        </ul>
      </Section>
    </div>
  )
}
