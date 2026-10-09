import type { Knex } from 'knex';

export interface CustomerProfileRow {
  id: string;
  user_id: string;
  email: string;
  full_name: string;
  phone: string | null;
  marketing_opt_in: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface AddressRow {
  id: string;
  profile_id: string;
  label: string;
  full_name: string;
  line1: string;
  line2: string | null;
  city: string;
  state: string | null;
  postal_code: string;
  country: string;
  phone: string | null;
  is_default: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface CartRow {
  id: string;
  customer_id: string;
  revision: number;
  currency: string;
  created_at: Date;
  updated_at: Date;
}

export interface CartItemRow {
  id: string;
  cart_id: string;
  product_id: string;
  quantity: number;
  added_at: Date;
  updated_at: Date;
}

export interface ProcessedMessageRow {
  message_id: string;
  queue: string;
  processed_at: Date;
}

type Defaulted<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;

export type CustomerProfileInsert = Defaulted<
  CustomerProfileRow,
  'phone' | 'marketing_opt_in' | 'created_at' | 'updated_at'
>;
export type AddressInsert = Defaulted<
  AddressRow,
  'label' | 'line2' | 'state' | 'phone' | 'is_default' | 'created_at' | 'updated_at'
>;
export type CartInsert = Defaulted<CartRow, 'revision' | 'currency' | 'created_at' | 'updated_at'>;
export type CartItemInsert = Defaulted<CartItemRow, 'added_at' | 'updated_at'>;
export type ProcessedMessageInsert = Defaulted<ProcessedMessageRow, 'processed_at'>;

declare module 'knex/types/tables' {
  interface Tables {
    customer_profiles: Knex.CompositeTableType<
      CustomerProfileRow,
      CustomerProfileInsert,
      Partial<CustomerProfileRow>
    >;
    addresses: Knex.CompositeTableType<AddressRow, AddressInsert, Partial<AddressRow>>;
    carts: Knex.CompositeTableType<CartRow, CartInsert, Partial<CartRow>>;
    cart_items: Knex.CompositeTableType<CartItemRow, CartItemInsert, Partial<CartItemRow>>;
    processed_messages: Knex.CompositeTableType<
      ProcessedMessageRow,
      ProcessedMessageInsert,
      Partial<ProcessedMessageRow>
    >;
  }
}
