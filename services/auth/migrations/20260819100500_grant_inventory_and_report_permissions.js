const NEW_PERMISSIONS = [
  ['inventory:read', 'inventory', 'read', 'View stock levels, the movement ledger and inventory valuation'],
  ['inventory:adjust', 'inventory', 'adjust', 'Record stock counts, restocks, write-offs and corrections'],
  ['report:read', 'report', 'read', 'View sales, catalogue, customer and inventory reports'],
  ['report:export', 'report', 'export', 'Export report data as CSV'],
];

const GRANTS = [
  [['ADMIN', 'MANAGER'], ['inventory:read', 'inventory:adjust', 'report:read', 'report:export']],
  [['STAFF'], ['inventory:read', 'report:read']],
  [['SUPER_ADMIN'], ['inventory:read', 'inventory:adjust', 'report:read', 'report:export']],
];

exports.up = async function up(knex) {
  await knex('permissions')
    .insert(
      NEW_PERMISSIONS.map(([code, resource, action, description]) => ({
        id: knex.raw('gen_random_uuid()'),
        code,
        resource,
        action,
        description,
      })),
    )
    .onConflict('code')
    .ignore();

  for (const [roleCodes, permissionCodes] of GRANTS) {
    await knex.raw(
      `
      INSERT INTO role_permissions (role_id, permission_id)
      SELECT r.id, p.id
      FROM roles r
      CROSS JOIN permissions p
      WHERE r.code = ANY(?) AND p.code = ANY(?)
      ON CONFLICT DO NOTHING
      `,
      [roleCodes, permissionCodes],
    );
  }
};

exports.down = async function down(knex) {
  const codes = NEW_PERMISSIONS.map(([code]) => code);

  await knex('permissions').whereIn('code', codes).del();
};
