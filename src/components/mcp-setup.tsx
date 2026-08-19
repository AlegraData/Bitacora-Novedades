'use client'

import { useState } from 'react'

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
      </Section>

      <Section title="Qué puede hacer">
        <p style={{ fontSize: 13, color: '#718096' }}>
          Listar, buscar, crear y actualizar novedades. Eliminar registros está restringido a rol <strong>ADMIN</strong>. Todas las acciones de escritura quedan registradas en la auditoría de Bitácora.
        </p>
      </Section>
    </div>
  )
}
