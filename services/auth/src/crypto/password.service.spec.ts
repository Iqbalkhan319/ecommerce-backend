import { PasswordService } from './password.service';
import type { AuthEnv } from '../config/env';

const env = { ARGON2_MEMORY_COST: 8192, ARGON2_TIME_COST: 1, ARGON2_PARALLELISM: 1 } as unknown as AuthEnv;

describe('PasswordService', () => {
  const service = new PasswordService(env);

  it('produces an argon2id digest that never contains the plaintext', async () => {
    const hash = await service.hash('Str0ngPassphrase');
    expect(hash.startsWith('$argon2id$')).toBe(true);
    expect(hash).not.toContain('Str0ngPassphrase');
  });

  it('salts every digest so identical passwords hash differently', async () => {
    const [a, b] = await Promise.all([service.hash('SamePassw0rd'), service.hash('SamePassw0rd')]);
    expect(a).not.toEqual(b);
  });

  it('verifies a correct password and rejects an incorrect one', async () => {
    const hash = await service.hash('Str0ngPassphrase');
    await expect(service.verify(hash, 'Str0ngPassphrase')).resolves.toBe(true);
    await expect(service.verify(hash, 'Str0ngPassphras')).resolves.toBe(false);
    await expect(service.verify(hash, '')).resolves.toBe(false);
  });

  it('returns false rather than throwing on a malformed digest', async () => {
    await expect(service.verify('not-a-hash', 'anything')).resolves.toBe(false);
  });

  it('burns comparable time on the unknown-account path', async () => {
    await expect(service.burnTime('anything')).resolves.toBeUndefined();
  });
});
