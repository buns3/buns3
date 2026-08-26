#!/usr/bin/env -S bun
import type { Contract as End } from '../../snapshots/6cd2f60e2db43f1825edb56bed3d34721dc167121d93ca8fd6e8aa411558d52b/contract';
import endContract from '../../snapshots/6cd2f60e2db43f1825edb56bed3d34721dc167121d93ca8fd6e8aa411558d52b/contract.json' with { type: 'json' };
import {
  Migration,
  MigrationCLI,
  col,
  fn,
  foreignKey,
  primaryKey,
  unique,
} from '@prisma/orm-sqlite/migration';

export default class M extends Migration<never, End> {
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createTable({
        table: 'buckets',
        columns: [
          col('created_at', 'TEXT', { notNull: true, default: fn('now()') }),
          col('name', 'TEXT', { notNull: true }),
        ],
        constraints: [primaryKey(['name'])],
      }),
      this.createTable({
        table: 'objects',
        columns: [
          col('bucket_name', 'TEXT', { notNull: true }),
          col('content_type', 'TEXT', { notNull: true }),
          col('created_at', 'TEXT', { notNull: true, default: fn('now()') }),
          col('id', 'TEXT', { notNull: true }),
          col('key', 'TEXT', { notNull: true }),
          col('size', 'INTEGER', { notNull: true }),
        ],
        constraints: [
          primaryKey(['id']),
          unique(['bucket_name', 'key']),
          foreignKey(['bucket_name'], 'buckets', ['name'], {
            onDelete: 'restrict',
            onUpdate: 'restrict',
          }),
        ],
      }),
      this.createIndex({
        table: 'objects',
        index: 'objects_bucket_name_idx_a0195dbd',
        columns: ['bucket_name'],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
