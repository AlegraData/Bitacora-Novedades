// Tipo de agente de IA a partir del nombre que el cliente informa al registrarse por OAuth.
// Es informativo, no verificado: el propio cliente declara cómo se llama.

export const AGENTS = ['Claude', 'Claude Code', 'opencode', 'Otro agente'] as const
export type Agent = (typeof AGENTS)[number]

export function agentOf(clientName: string | null | undefined): Agent {
  const n = String(clientName ?? '').toLowerCase().replace(/[_\s]+/g, '-')
  if (n.includes('claude-code') || n.includes('claudecode')) return 'Claude Code'
  if (n.includes('opencode') || n.includes('open-code')) return 'opencode'
  if (n.includes('claude')) return 'Claude'
  return 'Otro agente'
}
