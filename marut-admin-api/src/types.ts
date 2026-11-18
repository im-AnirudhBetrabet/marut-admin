import type { ModuleKey, PermissionLevel } from "./config/permissions.js";
export type { ModuleKey, PermissionLevel } from "./config/permissions.js";
export type AdminRole       = 'owner' | 'staff';
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
