
export const MODULE_KEYS = [ 'users', 'verticals', 'products', 'pricing', 'catalogue', 'leads', 'analytics'] as const;
export type ModuleKey    = (typeof MODULE_KEYS)[number];

export const PERMISSION_LEVELS = ['view', 'manage'] as const;
export type PermissionLevel    = (typeof PERMISSION_LEVELS)[number];

type ModuleDefinition = {
  label      : string;
  description: string;
};

const MODULE_DEFINITIONS = {
  users: {
    label      : 'User Management',
    description: 'Manage admin accounts and invitations.',
  },
  verticals: {
    label      : 'Verticals',
    description: 'Manage business verticals.',
  },
  products: {
    label      : 'Products',
    description: 'Manage the product master.',
  },
  pricing: {
    label      : 'Pricing',
    description: 'Manage product pricing.',
  },
  catalogue: {
    label      : 'Catalogue',
    description: 'Manage published catalogue data.',
  },
  leads: {
    label      : 'Marketing Leads',
    description: 'Manage marketing leads.',
  },
  analytics: {
    label      : 'Analytics',
    description: 'View business analytics.',
  },
} satisfies Record<ModuleKey, ModuleDefinition>;

export const ADMIN_MODULES = MODULE_KEYS.map((key) => ({
  key,
  ...MODULE_DEFINITIONS[key],
}));

export function getModuleDefinition(key: string) {
  return ADMIN_MODULES.find((module) => module.key === key);
}
