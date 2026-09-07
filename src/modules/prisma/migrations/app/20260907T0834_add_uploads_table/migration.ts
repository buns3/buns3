#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/a0d4ead53b02e728e574deee7a5706de655cad9a1f4764bb8932c12c7a40db58/contract';
import startContract from '../../snapshots/a0d4ead53b02e728e574deee7a5706de655cad9a1f4764bb8932c12c7a40db58/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/ec765a9aea75b5a75ec1c25747f675858edfb245a997e4d51de778ee305ec415/contract';
import endContract from '../../snapshots/ec765a9aea75b5a75ec1c25747f675858edfb245a997e4d51de778ee305ec415/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, foreignKey, primaryKey } from '@prisma/orm-sqlite/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createTable({
        table: 'uploads',
        columns: [
          col('bucket_name', 'TEXT', { notNull: true }),
          col('content_type', 'TEXT', { notNull: true }),
          col('created_at', 'TEXT', { notNull: true }),
          col('id', 'TEXT', { notNull: true }),
          col('key', 'TEXT', { notNull: true }),
          col('size', 'INTEGER', { notNull: true }),
          col('updated_at', 'TEXT', { notNull: true }),
        ],
        constraints: [
          primaryKey(['id']),
          foreignKey(['bucket_name'], 'buckets', ['name'], { onDelete: 'restrict' }),
        ],
      }),
      this.createIndex({
        table: 'uploads',
        index: 'uploads_bucket_name_idx_a0195dbd',
        columns: ['bucket_name'],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
