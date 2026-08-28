#!/usr/bin/env -S bun
import type { Contract as End } from '../../snapshots/48c976c9fdaddf754b92b05cd8b99b5f48cdec5df55ff85b353c40620b1fa107/contract';
import endContract from '../../snapshots/48c976c9fdaddf754b92b05cd8b99b5f48cdec5df55ff85b353c40620b1fa107/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/6cd2f60e2db43f1825edb56bed3d34721dc167121d93ca8fd6e8aa411558d52b/contract';
import startContract from '../../snapshots/6cd2f60e2db43f1825edb56bed3d34721dc167121d93ca8fd6e8aa411558d52b/contract.json' with { type: 'json' };
import {
  Migration,
  MigrationCLI,
  col,
  fn,
  foreignKey,
  primaryKey,
  unique,
} from '@prisma/orm-sqlite/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createTable({
        table: 'api_keys',
        columns: [
          col('bucket_name', 'TEXT'),
          col('can_read', 'INTEGER', { notNull: true }),
          col('can_write', 'INTEGER', { notNull: true }),
          col('created_at', 'TEXT', { notNull: true, default: fn('now()') }),
          col('id', 'TEXT', { notNull: true }),
          col('is_admin', 'INTEGER', { notNull: true }),
          col('last_used_at', 'TEXT'),
          col('name', 'TEXT', { notNull: true }),
          col('tokenHash', 'TEXT', { notNull: true }),
          col('token_hint', 'TEXT'),
        ],
        constraints: [
          primaryKey(['id']),
          unique(['tokenHash']),
          foreignKey(['bucket_name'], 'buckets', ['name'], {
            onDelete: 'cascade',
            onUpdate: 'cascade',
          }),
        ],
      }),
      this.createIndex({
        table: 'api_keys',
        index: 'api_keys_bucket_name_idx_a0195dbd',
        columns: ['bucket_name'],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
