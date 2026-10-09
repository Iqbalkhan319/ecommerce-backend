import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { AppException, ErrorCode } from '@ecom/platform';
import { DatabaseService } from '../database/database.service';
import type { UpdateProfileDto, UpsertAddressDto } from './dto/profile.dto';
import type { AddressRow, CustomerProfileRow } from '../database/tables';

export interface ProfileIdentity {
  userId: string;
  email: string;
  fullName: string;
  phone?: string | null;
}

const MAX_SAVED_ADDRESSES = 10;

@Injectable()
export class ProfileService {
  constructor(private readonly db: DatabaseService) {}

  async ensure(identity: ProfileIdentity): Promise<CustomerProfileRow> {
    const [profile] = await this.db
      .knex('customer_profiles')
      .insert({
        id: randomUUID(),
        user_id: identity.userId,
        email: identity.email,
        full_name: identity.fullName,
        phone: identity.phone ?? null,
      })
      .onConflict('user_id')
      .merge(['email', 'full_name'])
      .returning('*');

    return profile;
  }

  private addressesFor(profileId: string) {
    return this.db
      .knex('addresses')
      .where({ profile_id: profileId })
      .orderBy([
        { column: 'is_default', order: 'desc' },
        { column: 'created_at', order: 'asc' },
      ]);
  }

  async get(identity: ProfileIdentity) {
    const profile = await this.ensure(identity);
    const addresses = await this.addressesFor(profile.id);
    return { ...profile, addresses };
  }

  async update(identity: ProfileIdentity, dto: UpdateProfileDto): Promise<CustomerProfileRow> {
    const profile = await this.ensure(identity);

    const patch = {
      ...(dto.fullName !== undefined ? { full_name: dto.fullName } : {}),
      ...(dto.phone !== undefined ? { phone: dto.phone } : {}),
      ...(dto.marketingOptIn !== undefined ? { marketing_opt_in: dto.marketingOptIn } : {}),
    };

    if (Object.keys(patch).length === 0) return profile;

    const [updated] = await this.db.knex('customer_profiles').where({ id: profile.id }).update(patch).returning('*');
    return updated;
  }

  async listAddresses(identity: ProfileIdentity): Promise<AddressRow[]> {
    const profile = await this.ensure(identity);
    return this.addressesFor(profile.id);
  }

  async addAddress(identity: ProfileIdentity, dto: UpsertAddressDto): Promise<AddressRow> {
    const profile = await this.ensure(identity);

    const [{ count }] = await this.db
      .knex('addresses')
      .where({ profile_id: profile.id })
      .count<Array<{ count: string }>>('* as count');

    const existing = Number(count);
    if (existing >= MAX_SAVED_ADDRESSES) {
      throw AppException.unprocessable(
        `You can save at most ${MAX_SAVED_ADDRESSES} addresses`,
        ErrorCode.BAD_REQUEST,
      );
    }

    return this.db.transaction(async (trx) => {
      const shouldBeDefault = dto.isDefault || existing === 0;
      if (shouldBeDefault) {
        await trx('addresses').where({ profile_id: profile.id }).update({ is_default: false });
      }

      const [created] = await trx('addresses')
        .insert({
          id: randomUUID(),
          profile_id: profile.id,
          label: dto.label ?? 'Home',
          full_name: dto.fullName,
          line1: dto.line1,
          line2: dto.line2 ?? null,
          city: dto.city,
          state: dto.state ?? null,
          postal_code: dto.postalCode,
          country: dto.country,
          phone: dto.phone ?? null,
          is_default: shouldBeDefault,
        })
        .returning('*');

      return created;
    });
  }

  private async ownedAddress(customerId: string, addressId: string): Promise<AddressRow> {
    const address = await this.db
      .knex('addresses as a')
      .join('customer_profiles as p', 'p.id', 'a.profile_id')
      .where('a.id', addressId)
      .andWhere('p.user_id', customerId)
      .select('a.*')
      .first();

    if (!address) throw AppException.notFound('Address not found');
    return address as AddressRow;
  }

  async updateAddress(identity: ProfileIdentity, addressId: string, dto: UpsertAddressDto): Promise<AddressRow> {
    const address = await this.ownedAddress(identity.userId, addressId);

    return this.db.transaction(async (trx) => {
      if (dto.isDefault) {
        await trx('addresses').where({ profile_id: address.profile_id }).update({ is_default: false });
      }

      const [updated] = await trx('addresses')
        .where({ id: address.id })
        .update({
          label: dto.label ?? address.label,
          full_name: dto.fullName,
          line1: dto.line1,
          line2: dto.line2 ?? null,
          city: dto.city,
          state: dto.state ?? null,
          postal_code: dto.postalCode,
          country: dto.country,
          phone: dto.phone ?? null,
          is_default: dto.isDefault ?? address.is_default,
        })
        .returning('*');

      return updated;
    });
  }

  async removeAddress(identity: ProfileIdentity, addressId: string): Promise<void> {
    const address = await this.ownedAddress(identity.userId, addressId);
    await this.db.knex('addresses').where({ id: address.id }).del();
  }

  async addressById(customerId: string, addressId: string) {
    const address = await this.ownedAddress(customerId, addressId);
    return {
      fullName: address.full_name,
      line1: address.line1,
      line2: address.line2,
      city: address.city,
      state: address.state,
      postalCode: address.postal_code,
      country: address.country,
      phone: address.phone,
    };
  }

  async createFromEvent(payload: { userId: string; email: string; fullName: string }): Promise<void> {
    await this.db
      .knex('customer_profiles')
      .insert({
        id: randomUUID(),
        user_id: payload.userId,
        email: payload.email,
        full_name: payload.fullName,
      })
      .onConflict('user_id')
      .ignore();
  }
}
