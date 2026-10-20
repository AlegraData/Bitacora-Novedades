'use client'

import { useState } from 'react'

export function CopyButton({ text }: { text: string }) {
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

export function CodeBlock({ code }: { code: string }) {
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
