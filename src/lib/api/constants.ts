// Sin imports de servidor: este módulo también lo consumen componentes cliente.

export const MAX_KEYS_PER_USER = 3
export const TOKEN_PREFIX = 'btk_'
export const EXPIRY_OPTIONS_DAYS = [30, 90, 180, 365] as const
export const DEFAULT_EXPIRY_DAYS = 90

export const SCOPES = {
  'records:read': 'Leer novedades (listar, ver detalle, búsqueda semántica) y el esquema de campos',
  'records:write': 'Crear y editar novedades (editar solo las propias, o cualquiera si el dueño es ADMIN)',
  'records:delete': 'Eliminar novedades (además exige que el dueño del token sea ADMIN)',
  'audit:read': 'Consultar el historial de auditoría',
  'pmkt:notify': 'Disparar la comunicación a PMKT de una novedad',
} as const

export type Scope = keyof typeof SCOPES
export const ALL_SCOPES = Object.keys(SCOPES) as Scope[]

/** Scopes que un usuario sin rol ADMIN no puede otorgar a sus tokens. */
export const ADMIN_ONLY_SCOPES: Scope[] = ['records:delete']

export const API_BASE_URL = 'https://bitacora-novedades.alegra.com/api/v1'
