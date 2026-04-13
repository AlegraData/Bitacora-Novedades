import { NextRequest } from 'next/server'
import { searchSimilarRecords } from '@/lib/actions/ai'

export async function POST(request: NextRequest) {
  try {
    const { messages } = await request.json()
    const allMessages = messages as Array<{ role: string; content: string }>
    const lastMessageContent = allMessages.at(-1)?.content ?? ''

    if (!process.env.GEMINI_API_KEY) {
      return Response.json({ error: 'GEMINI_API_KEY no configurada' }, { status: 501 })
    }

    // 1. Obtener contexto mediante RAG
    let recordTexts = ''
    try {
      const similarRecords = await searchSimilarRecords(lastMessageContent, 10)
      recordTexts = similarRecords
        .map((r: any) => `[${new Date(r.createdAt).toLocaleDateString('es-CO')}] ${r.content}`)
        .join('\n')
    } catch (ragError) {
      console.error('Error en RAG:', ragError)
      // Si falla el RAG, continuamos sin contexto para no romper el chat
    }

    const systemInstruction = `Eres un asistente experto en la Bitácora de Novedades del equipo de Product de Alegra.
Responde siempre en español, de forma concisa y útil.

CONTEXTO DE LA BITÁCORA:
${recordTexts || 'No hay contexto disponible para esta consulta.'}

Si la información no está en el contexto, indícalo educadamente.`

    // 2. Configurar Modelo
    const { GoogleGenerativeAI } = await import('@google/generative-ai')
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash',
      systemInstruction,
    })

    // 3. Preparar Historial
    const rawHistory = allMessages
      .slice(0, -1)
      .map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      }))
    
    const firstUserIdx = rawHistory.findIndex((m) => m.role === 'user')
    const history = firstUserIdx >= 0 ? rawHistory.slice(firstUserIdx) : []

    const chat = model.startChat({ history })
    const encoder = new TextEncoder()

    const stream = new ReadableStream({
      async start(controller) {
        try {
          const result = await chat.sendMessageStream(lastMessageContent)
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
  } catch (error: any) {
    console.error('Chat Error:', error)
    return Response.json({ error: error.message }, { status: 500 })
  }
}
