export type AdminPermission =
  | 'overview.view'
  | 'analytics.view'
  | 'health.view'
  | 'audit.view'
  | 'support.view'
  | 'support.manage'
  | 'settings.view'
  | 'settings.manage'
  | 'content.view'
  | 'content.manage'
  | 'users.view'
  | 'users.personal_data.view'
  | 'users.block'
  | 'users.verify'
  | 'users.delete'
  | 'users.reports.review'
  | 'users.message'
  | 'reports.view'
  | 'reports.manage'
  | 'announcements.view'
  | 'announcements.manage'
  | 'admins.view'
  | 'admins.manage'

export const adminPermissionCatalog: readonly {
  id: AdminPermission
  label: string
}[]
