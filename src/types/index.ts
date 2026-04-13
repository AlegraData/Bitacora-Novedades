export type Role = 'ADMIN' | 'MANAGER' | 'VIEWER'

export type FieldType =
  | 'text'
  | 'textarea'
  | 'number'
  | 'date'
  | 'select'
  | 'multiselect'
  | 'person'
  | 'button'
  | 'url'
  | 'checkbox'

export interface ButtonConfig {
  action: 'send_email'
  targetFieldId: string  // field ID that contains the recipient email(s)
  emailSubject: string   // supports {{fieldName}} placeholders
  emailBody: string      // supports {{fieldName}} placeholders
  logFieldId?: string    // optional field to log send history
}

export interface Field {
  id: string
  name: string
  type: FieldType
  order: number
  isFilterable: boolean
  isVisible: boolean
  config?: ButtonConfig | null
  options: Tag[]
  permissions: FieldPermission[]
  createdAt: string
  updatedAt: string
}

export interface Tag {
  id: string
  fieldId: string
  name: string
  color: string
  order: number
}

export interface RecordData {
  [fieldId: string]: string | number | boolean | string[] | null
}

export interface BitacoraRecord {
  id: string
  data: RecordData
  createdAt: string
  updatedAt: string
  createdByEmail: string
  createdByName: string
}

export interface FieldPermission {
  id: string
  fieldId: string
  role: Role
  canEdit: boolean
}

export interface AuditLog {
  id: string
  timestamp: string
  userId?: string | null
  userEmail: string
  userName: string
  action: string
  recordId?: string | null
  details?: Record<string, unknown> | null
}

export interface WorkspaceUser {
  email: string
  name: string
  photo?: string | null
}

export interface FilterState {
  search: string
  fieldId: string
  value: string
  dateFrom: string
  dateTo: string
  dateFieldId: string
}
