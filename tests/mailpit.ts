// Cliente mínimo de la API HTTP de Mailpit (servidor SMTP de captura para tests).
const API = process.env.MAILPIT_API ?? 'http://localhost:8025/api/v1'

export interface CapturedMessage {
  ID: string
  Subject: string
  From: { Name: string; Address: string }
  To: { Name: string; Address: string }[]
  Cc: { Name: string; Address: string }[] | null
  Bcc: { Name: string; Address: string }[] | null
  ReplyTo: { Name: string; Address: string }[] | null
  HTML: string
  Text: string
  Headers?: Record<string, string[]>
}

export async function mailpitUp(): Promise<boolean> {
  try {
    return (await fetch(`${API}/info`)).ok
  } catch {
    return false
  }
}

export async function clearMailbox() {
  await fetch(`${API}/messages`, { method: 'DELETE' })
}

export async function listMessages(): Promise<{ ID: string; Subject: string }[]> {
  const res = await fetch(`${API}/messages`)
  const body = (await res.json()) as { messages: { ID: string; Subject: string }[] }
  return body.messages ?? []
}

export async function getMessage(id: string): Promise<CapturedMessage> {
  return (await fetch(`${API}/message/${id}`)).json() as Promise<CapturedMessage>
}

export async function getHeaders(id: string): Promise<Record<string, string[]>> {
  return (await fetch(`${API}/message/${id}/headers`)).json() as Promise<Record<string, string[]>>
}
