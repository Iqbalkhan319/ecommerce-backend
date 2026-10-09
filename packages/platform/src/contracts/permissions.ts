export const PERMISSIONS = {
  productRead: 'product:read',
  productCreate: 'product:create',
  productUpdate: 'product:update',
  productDelete: 'product:delete',

  categoryRead: 'category:read',
  categoryCreate: 'category:create',
  categoryUpdate: 'category:update',
  categoryDelete: 'category:delete',

  orderRead: 'order:read',
  orderUpdate: 'order:update',
  orderConfirm: 'order:confirm',
  orderReject: 'order:reject',

  customerRead: 'customer:read',
  customerUpdate: 'customer:update',
  customerDelete: 'customer:delete',

  adminRead: 'admin:read',
  adminCreate: 'admin:create',
  adminUpdate: 'admin:update',
  adminDelete: 'admin:delete',

  roleRead: 'role:read',
  roleCreate: 'role:create',
  roleUpdate: 'role:update',
  roleDelete: 'role:delete',

  inventoryRead: 'inventory:read',
  inventoryAdjust: 'inventory:adjust',

  reportRead: 'report:read',
  reportExport: 'report:export',

  permissionRead: 'permission:read',
  invoiceRead: 'invoice:read',
  auditRead: 'audit:read',
  dashboardRead: 'dashboard:read',
} as const;

export type PermissionCode = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const ALL_PERMISSIONS: PermissionCode[] = Object.values(PERMISSIONS);

export const PERMISSION_DESCRIPTIONS: Record<PermissionCode, string> = {
  'product:read': 'View products and stock levels',
  'product:create': 'Create products',
  'product:update': 'Update products, pricing and stock',
  'product:delete': 'Archive or delete products',
  'category:read': 'View categories',
  'category:create': 'Create categories',
  'category:update': 'Update categories',
  'category:delete': 'Delete categories',
  'order:read': 'View orders and order details',
  'order:update': 'Move orders through the fulfilment lifecycle',
  'order:confirm': 'Confirm pending orders',
  'order:reject': 'Reject pending orders',
  'customer:read': 'View customer accounts',
  'customer:update': 'Update customer accounts and account status',
  'customer:delete': 'Deactivate customer accounts',
  'admin:read': 'View administrator accounts',
  'admin:create': 'Create administrator accounts',
  'admin:update': 'Update administrator accounts and their roles',
  'admin:delete': 'Deactivate administrator accounts',
  'role:read': 'View roles and their permissions',
  'role:create': 'Create roles',
  'role:update': 'Update roles and their permissions',
  'role:delete': 'Delete roles',
  'inventory:read': 'View stock levels, the movement ledger and inventory valuation',
  'inventory:adjust': 'Record stock counts, restocks, write-offs and corrections',
  'report:read': 'View sales, catalogue, customer and inventory reports',
  'report:export': 'Export report data as CSV',
  'permission:read': 'View the permission catalogue',
  'invoice:read': 'View and download invoices',
  'audit:read': 'Read the audit log',
  'dashboard:read': 'View dashboard statistics',
};

export const ROLES = {
  superAdmin: 'SUPER_ADMIN',
  admin: 'ADMIN',
  manager: 'MANAGER',
  staff: 'STAFF',
  customer: 'CUSTOMER',
} as const;

export type RoleCode = (typeof ROLES)[keyof typeof ROLES];

const P = PERMISSIONS;

export const ROLE_DEFINITIONS: Array<{
  code: RoleCode;
  name: string;
  description: string;
  permissions: PermissionCode[];
}> = [
  {
    code: ROLES.superAdmin,
    name: 'Super administrator',
    description: 'Protected owner account with unrestricted access',
    permissions: ALL_PERMISSIONS,
  },
  {
    code: ROLES.admin,
    name: 'Administrator',
    description: 'Full operational access; cannot change the role catalogue or remove administrators',
    permissions: ALL_PERMISSIONS.filter(
      (code) => !([P.adminDelete, P.roleCreate, P.roleUpdate, P.roleDelete] as PermissionCode[]).includes(code),
    ),
  },
  {
    code: ROLES.manager,
    name: 'Operations manager',
    description: 'Runs the catalogue and the order pipeline',
    permissions: [
      P.productRead, P.productCreate, P.productUpdate, P.productDelete,
      P.categoryRead, P.categoryCreate, P.categoryUpdate, P.categoryDelete,
      P.orderRead, P.orderUpdate, P.orderConfirm, P.orderReject,
      P.customerRead, P.customerUpdate,
      P.inventoryRead, P.inventoryAdjust,
      P.reportRead, P.reportExport,
      P.invoiceRead, P.auditRead, P.dashboardRead, P.roleRead,
    ],
  },
  {
    code: ROLES.staff,
    name: 'Support staff',
    description: 'Read-only access for customer support',
    permissions: [
      P.productRead, P.categoryRead, P.orderRead, P.customerRead,
      P.inventoryRead, P.reportRead, P.invoiceRead, P.dashboardRead,
    ],
  },
  {
    code: ROLES.customer,
    name: 'Customer',
    description: 'Storefront account. Carries no administrative permission.',
    permissions: [],
  },
];

export const SYSTEM_ROLE_CODES: RoleCode[] = [ROLES.superAdmin, ROLES.customer];
