/**
 * En Cloud Run, detrás de un domain mapping, `request.url` puede resolver
 * al host:puerto interno del contenedor (0.0.0.0:8080) en vez del dominio
 * público. Se deriva el origen real de x-forwarded-host/x-forwarded-proto,
 * que sí reflejan el dominio con el que el usuario hizo la petición.
 */
export function getPublicOrigin(headers: Headers, fallbackUrl?: string): string {
  const forwardedHost = headers.get('x-forwarded-host')
  const forwardedProto = headers.get('x-forwarded-proto')?.split(',')[0]
  if (forwardedHost) {
    return `${forwardedProto ?? 'https'}://${forwardedHost}`
  }

  const origin = headers.get('origin')
  if (origin) return origin

  return fallbackUrl ? new URL(fallbackUrl).origin : 'http://localhost:3000'
}
