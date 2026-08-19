'use client'

import { useState } from 'react'
import Link from 'next/link'

const MCP_URL = 'https://bitacora-novedades.alegra.com/api/mcp'

const OPENCODE_SNIPPET = `"bitacora": {
  "type": "remote",
  "url": "${MCP_URL}",
  "enabled": true
}`

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)

  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(text)
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      }}
      style={{
        padding: '4px 10px',
        borderRadius: 6,
        border: '1px solid #cbd5e1',
        background: copied ? '#c6f6d5' : '#fff',
        color: copied ? '#276749' : '#4a5568',
        fontSize: 12,
        fontWeight: 500,
        cursor: 'pointer',
      }}
    >
      {copied ? '¡Copiado!' : 'Copiar'}
    </button>
  )
}

function CodeBlock({ code }: { code: string }) {
  return (
    <div style={{ position: 'relative', background: '#1e2a3a', borderRadius: 8, padding: '14px 16px', marginTop: 8 }}>
      <pre style={{ margin: 0, color: '#e2e8f0', fontSize: 13, fontFamily: 'monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-all', paddingRight: 70 }}>
        {code}
      </pre>
      <div style={{ position: 'absolute', top: 10, right: 10 }}>
        <CopyButton text={code} />
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ background: '#fff', borderRadius: 12, boxShadow: '0 2px 8px rgba(0,0,0,0.06)', padding: '20px 24px', marginBottom: 20 }}>
      <h2 style={{ fontSize: 16, fontWeight: 600, color: '#1a202c', marginBottom: 10 }}>{title}</h2>
      {children}
    </div>
  )
}

export function McpSetup() {
  return (
    <div style={{ maxWidth: 800, margin: '0 auto' }}>
      <Link
        href="/app"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          fontSize: 13,
          color: '#4a5568',
          textDecoration: 'none',
          marginBottom: 16,
        }}
      >
        ← Volver a novedades
      </Link>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: '#1a202c' }}>Conectar al MCP de Bitácora</h1>
        <p style={{ fontSize: 14, color: '#718096', marginTop: 4 }}>
          Deja que tu agente de IA (Claude, OpenCode, etc.) lea y escriba novedades directamente, respetando tu rol y permisos.
        </p>
      </div>

      <Section title="URL del servidor">
        <p style={{ fontSize: 13, color: '#718096', marginBottom: 4 }}>
          Cualquier cliente MCP con soporte de OAuth necesita esta URL:
        </p>
        <CodeBlock code={MCP_URL} />
      </Section>

      <Section title="OpenCode">
        <p style={{ fontSize: 13, color: '#718096' }}>
          Agrega esto dentro de <code>&quot;mcp&quot;</code> en tu <code>opencode.json</code>:
        </p>
        <CodeBlock code={OPENCODE_SNIPPET} />
        <p style={{ fontSize: 13, color: '#718096', marginTop: 12 }}>
          Luego autentícate una vez desde la terminal (abre el navegador para autorizar):
        </p>
        <CodeBlock code="opencode mcp auth bitacora" />
      </Section>

      <Section title="Claude (Desktop, Claude.ai y Claude Code)">
        <p style={{ fontSize: 13, color: '#718096', marginBottom: 8 }}>
          Bitácora está disponible como <strong>conector personalizado a nivel de organización</strong> — no necesitas configurar nada por tu cuenta ni escribir código. Una vez habilitado por un admin del workspace de Claude, aparece automáticamente en Claude Desktop, Claude.ai y Claude Code para todo el equipo.
        </p>
        <ol style={{ fontSize: 13, color: '#4a5568', paddingLeft: 20, lineHeight: 1.8 }}>
          <li>Abre Claude (Desktop, web o Code) y busca &quot;Bitácora&quot; en tus conectores/herramientas disponibles.</li>
          <li>La primera vez que lo uses, te va a pedir autorizar con tu cuenta de Google/Alegra.</li>
        </ol>

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 24, marginTop: 20 }}>
          {[
            { src: '/mcp-setup/claude-1-conectores.png', caption: '1. Settings → Conectores → busca "Bitácora" → Conectar' },
            { src: '/mcp-setup/claude-2-autorizar.png', caption: '2. Autoriza con tu cuenta de Google/Alegra' },
            { src: '/mcp-setup/claude-3-conectado.png', caption: '3. Listo, ya quedó conectado' },
          ].map((step) => (
            <figure key={step.src} style={{ margin: 0, maxWidth: 480, width: '100%', textAlign: 'center' }}>
              <figcaption style={{ fontSize: 13, color: '#4a5568', fontWeight: 500, marginBottom: 8 }}>{step.caption}</figcaption>
              <img
                src={step.src}
                alt={step.caption}
                style={{ maxWidth: '100%', borderRadius: 8, border: '1px solid #e2e8f0', display: 'block', margin: '0 auto' }}
              />
            </figure>
          ))}
        </div>
      </Section>

      <Section title="Qué puede hacer">
        <p style={{ fontSize: 13, color: '#718096' }}>
          Listar, buscar, crear y actualizar novedades, disparar la comunicación de PMKT (correo + Google Chat), y consultar el historial de auditoría. Eliminar registros está restringido a rol <strong>ADMIN</strong>, y editar cada campo respeta los mismos permisos por rol que la app web. Toda lectura y escritura queda registrada en la auditoría de Bitácora.
        </p>
      </Section>
    </div>
  )
}
