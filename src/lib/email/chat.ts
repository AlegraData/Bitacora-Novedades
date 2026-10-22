// Aviso a Google Chat (canal tp-product-update) cuando una novedad se comunica por correo.
// Reemplaza la tarjeta que publicaba el Apps Script. Solo se publica el éxito: los
// errores se muestran en pantalla, MCP y API.

const CARD_ICON = 'https://i.imgur.com/LlYtMSU.png'

export interface ChatCardData {
  elaborado?: string
  titulo?: string
  tipo?: string
  url: string
}

function esc(s: string | undefined): string {
  return (s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export function buildChatCard(d: ChatCardData) {
  const who = d.elaborado ? `<b>${esc(d.elaborado)}</b> envió` : 'Se envió'
  const type = d.tipo ? ` y es (${esc(d.tipo)})` : ''
  return {
    cardsV2: [
      {
        cardId: 'analisisNovedades',
        card: {
          header: { title: 'Novedades de Product 📝', imageUrl: CARD_ICON, imageType: 'CIRCLE' },
          sections: [
            { widgets: [{ textParagraph: { text: `Hola a todos! 👋 ${who} un correo sobre "${esc(d.titulo)}"${type}.` } }] },
            {
              widgets: [
                {
                  buttonList: {
                    buttons: [
                      {
                        text: 'Link de bitácora de Novedades 📃',
                        color: { red: 0.0, green: 0.6, blue: 0.2, alpha: 1 },
                        onClick: { openLink: { url: d.url } },
                      },
                    ],
                  },
                },
              ],
            },
          ],
        },
      },
    ],
  }
}

function allowedWebhook(raw: string): boolean {
  try {
    const u = new URL(raw)
    if (u.protocol === 'https:' && u.hostname === 'chat.googleapis.com') return true
    // Solo para tests locales.
    return u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1')
  } catch {
    return false
  }
}

export type ChatResult = { status: 'sent' } | { status: 'skipped' } | { status: 'failed'; error: string }

export async function sendChatCard(d: ChatCardData): Promise<ChatResult> {
  const hook = process.env.PMKT_CHAT_WEBHOOK_URL?.trim()
  if (!hook) return { status: 'skipped' }
  if (!allowedWebhook(hook)) return { status: 'failed', error: 'PMKT_CHAT_WEBHOOK_URL no apunta a chat.googleapis.com.' }
  try {
    const res = await fetch(hook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=UTF-8' },
      body: JSON.stringify(buildChatCard(d)),
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) return { status: 'failed', error: `Google Chat respondió ${res.status}.` }
    return { status: 'sent' }
  } catch (e) {
    // El mensaje de red no incluye la URL (lleva key y token), solo el tipo de fallo.
    return { status: 'failed', error: e instanceof Error && e.name === 'TimeoutError' ? 'Google Chat no respondió a tiempo.' : 'No se pudo conectar con Google Chat.' }
  }
}
