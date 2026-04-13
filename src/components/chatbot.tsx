'use client'

import { useState, useRef, useEffect } from 'react'

interface Message {
  role: 'user' | 'assistant'
  content: string
}

interface ChatbotProps {
  onClose: () => void
}

export function Chatbot({ onClose }: ChatbotProps) {
  const [messages, setMessages] = useState<Message[]>([
    { role: 'assistant', content: '¡Hola! Soy el asistente de la Bitácora. Puedo ayudarte a buscar información sobre los registros. ¿Qué necesitas?' }
  ])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  async function sendMessage() {
    if (!input.trim() || loading) return
    const userMsg = input.trim()
    setInput('')
    setMessages((prev) => [...prev, { role: 'user', content: userMsg }])
    setLoading(true)

    const allMessages = [...messages, { role: 'user' as const, content: userMsg }]

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: allMessages }),
      })

      if (!response.ok) throw new Error('Error en la respuesta')
      if (!response.body) throw new Error('Sin cuerpo de respuesta')

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let assistantMsg = ''

      setMessages((prev) => [...prev, { role: 'assistant', content: '' }])

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        const text = decoder.decode(value, { stream: true })
        const lines = text.split('\n')

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6)
            if (data === '[DONE]') break
            try {
              const parsed = JSON.parse(data)
              assistantMsg += parsed.text ?? ''
              setMessages((prev) => {
                const updated = [...prev]
                updated[updated.length - 1] = { role: 'assistant', content: assistantMsg }
                return updated
              })
            } catch {}
          }
        }
      }
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: 'Lo siento, ocurrió un error. ' + (err instanceof Error ? err.message : '') }
      ])
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)',
      zIndex: 300, display: 'flex', alignItems: 'flex-end',
      justifyContent: 'flex-end', padding: 20,
    }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div style={{
        background: '#fff', borderRadius: 16,
        boxShadow: '0 8px 32px rgba(0,0,0,0.2)',
        width: 380, height: 520,
        display: 'flex', flexDirection: 'column',
      }}>
        {/* Header */}
        <div style={{
          padding: '16px 20px', background: '#1e2a3a',
          borderRadius: '16px 16px 0 0',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              width: 32, height: 32, borderRadius: '50%',
              background: '#00C4A0',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 16,
            }}>💬</div>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, color: '#fff' }}>Asistente Bitácora</div>
              <div style={{ fontSize: 11, color: '#a0aec0' }}>Powered by GPT-4o mini</div>
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#a0aec0', fontSize: 20 }}>×</button>
        </div>

        {/* Messages */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 16px 8px' }}>
          {messages.map((msg, i) => (
            <div key={i} style={{
              marginBottom: 12,
              display: 'flex',
              justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start',
            }}>
              <div style={{
                maxWidth: '80%',
                padding: '10px 14px',
                borderRadius: msg.role === 'user' ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
                background: msg.role === 'user' ? '#00C4A0' : '#f0f4f8',
                color: msg.role === 'user' ? '#fff' : '#1a202c',
                fontSize: 13,
                lineHeight: 1.5,
                whiteSpace: 'pre-wrap',
              }}>
                {msg.content || (msg.role === 'assistant' && loading && i === messages.length - 1
                  ? <span style={{ color: '#a0aec0' }}>Pensando...</span>
                  : msg.content
                )}
              </div>
            </div>
          ))}
          <div ref={endRef} />
        </div>

        {/* Input */}
        <div style={{
          padding: '12px 16px',
          borderTop: '1px solid #e2e8f0',
          display: 'flex', gap: 8,
        }}>
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage() } }}
            placeholder="Pregunta algo sobre los registros..."
            disabled={loading}
            style={{
              flex: 1, padding: '8px 12px',
              border: '1px solid #e2e8f0', borderRadius: 8,
              fontSize: 13, outline: 'none',
              background: loading ? '#f7fafc' : '#fff',
            }}
          />
          <button
            onClick={sendMessage}
            disabled={loading || !input.trim()}
            style={{
              padding: '8px 16px',
              background: (loading || !input.trim()) ? '#e2e8f0' : '#00C4A0',
              color: (loading || !input.trim()) ? '#a0aec0' : '#fff',
              border: 'none', borderRadius: 8,
              cursor: (loading || !input.trim()) ? 'default' : 'pointer',
              fontSize: 13, fontWeight: 500,
            }}
          >
            {loading ? '...' : '→'}
          </button>
        </div>
      </div>
    </div>
  )
}
