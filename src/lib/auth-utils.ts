import { createClient } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'
import { Role } from '@/types'

/**
 * Obtiene el perfil del usuario actual desde la DB.
 * Lanza un error si no está autenticado.
 */
export async function requireUser() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  
  if (!user) {
    throw new Error('No autenticado')
  }

  const dbUser = await prisma.user.findUnique({
    where: { email: user.email! }
  })

  if (!dbUser) {
    // Si el usuario existe en Supabase pero no en nuestra DB, lo creamos como VIEWER
    const newUser = await prisma.user.create({
      data: {
        email: user.email!,
        name: user.user_metadata?.full_name ?? user.email!.split('@')[0],
        image: user.user_metadata?.avatar_url ?? null,
        role: 'VIEWER'
      }
    })
    return { ...newUser, role: newUser.role as Role }
  }

  return { ...dbUser, role: dbUser.role as Role }
}

/**
 * Valida que el usuario tenga uno de los roles permitidos.
 */
export async function authorize(allowedRoles: Role[]) {
  const user = await requireUser()
  
  if (!allowedRoles.includes(user.role)) {
    throw new Error('No autorizado: Permisos insuficientes')
  }

  return user
}

/**
 * Helpers específicos para roles comunes
 */
export const requireAdmin = () => authorize(['ADMIN'])
export const requireManager = () => authorize(['ADMIN', 'MANAGER'])
