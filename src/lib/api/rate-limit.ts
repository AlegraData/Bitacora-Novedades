/**
 * Ventana fija en memoria. En Cloud Run cada instancia lleva su propio
 * contador, así que el límite real es aproximado (límite × instancias):
 * sirve para frenar abuso y bucles, no como cuota exacta.
 */
interface Bucket {
  count: number
  resetAt: number
}

export class RateLimiter {
  private buckets = new Map<string, Bucket>()

  constructor(private limit: number, private windowMs: number) {}

  setLimit(limit: number) {
    this.limit = limit
  }

  reset() {
    this.buckets.clear()
  }

  /** Cuenta un hit; devuelve si sigue dentro del límite y cuánto falta para la nueva ventana. */
  hit(key: string, now = Date.now()) {
    if (this.buckets.size > 10_000) this.sweep(now)
    let b = this.buckets.get(key)
    if (!b || b.resetAt <= now) {
      b = { count: 0, resetAt: now + this.windowMs }
      this.buckets.set(key, b)
    }
    b.count++
    return {
      allowed: b.count <= this.limit,
      limit: this.limit,
      remaining: Math.max(this.limit - b.count, 0),
      retryAfterSec: Math.max(Math.ceil((b.resetAt - now) / 1000), 1),
    }
  }

  /** Cuántos hits lleva la clave sin contar uno nuevo. */
  peek(key: string, now = Date.now()) {
    const b = this.buckets.get(key)
    return b && b.resetAt > now ? b.count : 0
  }

  private sweep(now: number) {
    for (const [k, b] of this.buckets) if (b.resetAt <= now) this.buckets.delete(k)
  }
}

const perMinute = Number(process.env.API_RATE_LIMIT_PER_MIN) || 120

/** Requests por token por minuto. */
export const keyLimiter = new RateLimiter(perMinute, 60_000)

export const FAILED_AUTH_MAX = 20
/** Intentos fallidos de autenticación por IP en 5 minutos (frena fuerza bruta de tokens). */
export const failedAuthLimiter = new RateLimiter(FAILED_AUTH_MAX, 5 * 60_000)
