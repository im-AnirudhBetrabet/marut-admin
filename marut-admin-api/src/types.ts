export type AdminRole       = 'owner' | 'staff';
export type PermissionLevel = 'view' | 'manage';
export type ModuleKey       = 'users' | 'verticals' | 'products' | 'pricing' | 'catalogue' | 'leads' | 'analytics';
export interface AdminUser {
  id          : string;
  auth_user_id: string;
  email       : string;
  display_name: string | null;
  role        : AdminRole;
  is_active   : boolean;
}
export interface PermissionRow {
  module_key: ModuleKey;
  level     : PermissionLevel;
}
