import { CHAT_USER_ID_RE } from './recipients'

// Aviso a Google Chat (canal tp-product-update) cuando una novedad se comunica por correo.
// Reemplaza la tarjeta que publicaba el Apps Script. Solo se publica el éxito: los errores se muestran en
// pantalla, MCP y API. Menciona a los destinatarios de la notificación con <users/ID> en el campo `text`
// (las tarjetas no admiten menciones); la tarjeta va debajo, igual que siempre.

const CARD_ICON = 'https://i.imgur.com/LlYtMSU.png'

export interface ChatCardData {
  elaborado?: string
  titulo?: string
  tipo?: string
  url: string
}

export interface ChatMention {
  name?: string
  /** ID numérico de Google; sin él se nombra a la persona en texto, sin notificarla. */
  chatUserId?: string
}

function esc(s: string | undefined): string {
  return (s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Texto de mención de Chat. Solo IDs numéricos válidos se convierten en <users/ID> (nada de <users/all>). */
export function mentionText(mentions: ChatMention[]): string {
  return mentions
    .map((m) => {
      if (m.chatUserId && CHAT_USER_ID_RE.test(m.chatUserId)) return `<users/${m.chatUserId}>`
      // eslint-disable-next-line no-control-regex
      const name = (m.name ?? '').replace(/[\u0000-\u001F<>*_~`]/g, '').trim()
      return name ? esc(name) : ''
    })
    .filter(Boolean)
    .join(' ')
}

export function buildChatMessage(d: ChatCardData, mentions: ChatMention[] = []) {
  const who = d.elaborado ? `<b>${esc(d.elaborado)}</b> envió` : 'Se envió'
  const type = d.tipo ? ` y es (${esc(d.tipo)})` : ''
  const to = mentionText(mentions)
  return {
    ...(to ? { text: `📣 Nueva comunicación de Producto para ${to}` } : {}),
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

async function post(hook: string | undefined, payload: unknown): Promise<ChatResult> {
  const url = hook?.trim()
  if (!url) return { status: 'skipped' }
  if (!allowedWebhook(url)) return { status: 'failed', error: 'El webhook de Chat no apunta a chat.googleapis.com.' }
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=UTF-8' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) return { status: 'failed', error: `Google Chat respondió ${res.status}.` }
    return { status: 'sent' }
  } catch (e) {
    // El mensaje de red no incluye la URL (lleva key y token), solo el tipo de fallo.
    return { status: 'failed', error: e instanceof Error && e.name === 'TimeoutError' ? 'Google Chat no respondió a tiempo.' : 'No se pudo conectar con Google Chat.' }
  }
}

export function sendChatCard(d: ChatCardData, mentions: ChatMention[] = []): Promise<ChatResult> {
  return post(process.env.PMKT_CHAT_WEBHOOK_URL, buildChatMessage(d, mentions))
}

/**
 * Mensaje de prueba de menciones. Usa PMKT_CHAT_TEST_WEBHOOK_URL (un espacio de pruebas) si existe; si no,
 * el canal real. Devuelve a cuál fue para que la pantalla lo diga.
 */
export async function sendChatMentionTest(mentions: ChatMention[]): Promise<ChatResult & { target: 'prueba' | 'produccion' | 'ninguno' }> {
  const test = process.env.PMKT_CHAT_TEST_WEBHOOK_URL?.trim()
  const hook = test || process.env.PMKT_CHAT_WEBHOOK_URL
  const to = mentionText(mentions)
  const result = await post(hook, {
    text: `🧪 *[PRUEBA]* Mensaje de prueba de menciones de la Bitácora de Novedades${to ? ` — ${to}` : ''}. No requiere ninguna acción.`,
  })
  return { ...result, target: !hook?.trim() ? 'ninguno' : test ? 'prueba' : 'produccion' }
}
