import { Inject, Injectable } from '@nestjs/common';
import { Algorithm, hash, verify } from '@node-rs/argon2';
import { AUTH_ENV, type AuthEnv } from '../config/env';

const DUMMY_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$c29tZS1zdGF0aWMtc2FsdA$Zt7oJ5cCwCJ5Fq3lY6oT0Xt5b8FZ7oJ1hQ2mNq9wKzs';

@Injectable()
export class PasswordService {
  private readonly options: { algorithm: Algorithm; memoryCost: number; timeCost: number; parallelism: number };

  constructor(@Inject(AUTH_ENV) env: AuthEnv) {
    this.options = {
      algorithm: Algorithm.Argon2id,
      memoryCost: env.ARGON2_MEMORY_COST,
      timeCost: env.ARGON2_TIME_COST,
      parallelism: env.ARGON2_PARALLELISM,
    };
  }

  hash(plain: string): Promise<string> {
    return hash(plain, this.options);
  }

  async verify(hashed: string, plain: string): Promise<boolean> {
    try {
      return await verify(hashed, plain, this.options);
    } catch {
      return false;
    }
  }

  async burnTime(plain: string): Promise<void> {
    await this.verify(DUMMY_HASH, plain).catch(() => undefined);
  }
}
