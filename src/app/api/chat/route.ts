import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function POST(request: NextRequest) {
  const { messages } = await request.json()

  if (!process.env.GEMINI_API_KEY) {
    return Response.json({ error: 'GEMINI_API_KEY no configurada' }, { status: 501 })
  }

  const [rawRecords, rawFields] = await Promise.all([
    prisma.record.findMany({ orderBy: { createdAt: 'desc' }, take: 100 }),
    prisma.field.findMany({ orderBy: { order: 'asc' }, where: { isVisible: true } }),
  ])

  const fieldMap = Object.fromEntries(rawFields.map((f) => [f.id, f.name]))

  const recordTexts = rawRecords
    .map((r) => {
      const data = r.data as Record<string, unknown>
      const parts = Object.entries(data)
        .filter(([k]) => fieldMap[k])
        .map(([k, v]) => `${fieldMap[k]}: ${Array.isArray(v) ? v.join(', ') : String(v ?? '')}`)
        .join(' | ')
      return `[${r.createdAt.toLocaleDateString('es-CO')} por ${r.createdByName}] ${parts}`
    })
    .join('\n')

  const systemInstruction = `Eres un asistente experto en la Bitácora de Novedades del equipo de Product de Alegra.
Tienes acceso a los registros de la bitácora y puedes responder preguntas sobre ellos.
Responde siempre en español, de forma concisa y útil.

REGISTROS DISPONIBLES (${rawRecords.length} total):
${recordTexts.slice(0, 8000)}`

  // systemInstruction must be at model level, not in startChat
  const { GoogleGenerativeAI } = await import('@google/generative-ai')
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
  const model = genAI.getGenerativeModel({
    model: 'gemini-2.0-flash-001',
    systemInstruction,
  })

  // Build history: must start with 'user', skip leading assistant messages
  const allMessages = messages as Array<{ role: string; content: string }>
  const rawHistory = allMessages
    .slice(0, -1)
    .map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }))
  const firstUserIdx = rawHistory.findIndex((m) => m.role === 'user')
  const history = firstUserIdx >= 0 ? rawHistory.slice(firstUserIdx) : []

  const lastMessage = allMessages.at(-1)?.content ?? ''
  const chat = model.startChat({ history })

  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      try {
        const result = await chat.sendMessageStream(lastMessage)

        for await (const chunk of result.stream) {
          const text = chunk.text()
          if (text) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text })}\n\n`))
          }
        }
        controller.enqueue(encoder.encode('data: [DONE]\n\n'))
        controller.close()
      } catch (err) {
        controller.error(err)
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  })
}
