export const AUTH_EVENTS = {
  customerRegistered: 'customer.registered',
  loginSucceeded: 'auth.login_succeeded',
  loginFailed: 'auth.login_failed',
  passwordChanged: 'auth.password_changed',
  passwordReset: 'auth.password_reset',
  adminCreated: 'auth.admin_created',
  userStatusChanged: 'auth.user_status_changed',
  userRolesChanged: 'auth.user_roles_changed',
  roleChanged: 'auth.role_changed',
  authorizationChanged: 'auth.authorization_changed',
} as const;
