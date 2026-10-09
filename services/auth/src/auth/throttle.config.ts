const number = (name: string, fallback: number): number => {
  const raw = process.env[name];
  const parsed = raw === undefined ? Number.NaN : Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const ttl = number('THROTTLE_WINDOW_MS', 60000);

export const AUTH_THROTTLE = {
  register: { default: { limit: number('THROTTLE_REGISTER_LIMIT', 5), ttl } },
  login: { default: { limit: number('THROTTLE_LOGIN_LIMIT', 10), ttl } },
  refresh: { default: { limit: number('THROTTLE_REFRESH_LIMIT', 30), ttl } },
  password: { default: { limit: number('THROTTLE_PASSWORD_LIMIT', 5), ttl } },
  forgotPassword: { default: { limit: number('THROTTLE_FORGOT_LIMIT', 3), ttl } },
} as const;
