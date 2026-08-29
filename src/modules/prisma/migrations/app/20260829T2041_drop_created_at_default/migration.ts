#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/58a7d9161a16a5ef297b9d7680490cbb724ae5ccd5886ff9ef969863b958b665/contract';
import startContract from '../../snapshots/58a7d9161a16a5ef297b9d7680490cbb724ae5ccd5886ff9ef969863b958b665/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/b9a634d0340f9264d69d21e2a89b6ef0cfe15767217f9419b637806e719a547e/contract';
import endContract from '../../snapshots/b9a634d0340f9264d69d21e2a89b6ef0cfe15767217f9419b637806e719a547e/contract.json' with { type: 'json' };
import { Migration, MigrationCLI } from '@prisma/orm-sqlite/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.recreateTable({
        tableName: 'api_keys',
        contractTable: {
          columns: [
            { name: 'bucket_name', typeSql: 'TEXT', defaultSql: '', nullable: true },
            { name: 'can_read', typeSql: 'INTEGER', defaultSql: '', nullable: false },
            { name: 'can_write', typeSql: 'INTEGER', defaultSql: '', nullable: false },
            { name: 'created_at', typeSql: 'TEXT', defaultSql: '', nullable: false },
            { name: 'id', typeSql: 'TEXT', defaultSql: '', nullable: false },
            { name: 'is_admin', typeSql: 'INTEGER', defaultSql: '', nullable: false },
            { name: 'last_used_at', typeSql: 'TEXT', defaultSql: '', nullable: true },
            { name: 'name', typeSql: 'TEXT', defaultSql: '', nullable: false },
            { name: 'token_hash', typeSql: 'TEXT', defaultSql: '', nullable: false },
            { name: 'token_hint', typeSql: 'TEXT', defaultSql: '', nullable: true },
          ],
          primaryKey: { columns: ['id'] },
          uniques: [{ columns: ['token_hash'] }],
          foreignKeys: [
            {
              columns: ['bucket_name'],
              references: { table: 'buckets', columns: ['name'] },
              onDelete: 'cascade',
              onUpdate: 'cascade',
            },
          ],
        },
        schemaColumnNames: [
          'bucket_name',
          'can_read',
          'can_write',
          'created_at',
          'id',
          'is_admin',
          'last_used_at',
          'name',
          'token_hash',
          'token_hint',
        ],
        indexes: [{ name: 'api_keys_bucket_name_idx_a0195dbd', columns: ['bucket_name'] }],
        summary:
          'Recreates table api_keys to apply schema changes: database/api_keys/column:created_at/default',
        postchecks: [
          {
            description: 'verify "created_at" has no default on "api_keys"',
            sql: "SELECT COUNT(*) > 0 FROM pragma_table_info('api_keys') WHERE name = 'created_at' AND dflt_value IS NULL",
          },
        ],
        operationClass: 'destructive',
      }),
      this.recreateTable({
        tableName: 'buckets',
        contractTable: {
          columns: [
            { name: 'created_at', typeSql: 'TEXT', defaultSql: '', nullable: false },
            { name: 'name', typeSql: 'TEXT', defaultSql: '', nullable: false },
          ],
          primaryKey: { columns: ['name'] },
          uniques: [],
          foreignKeys: [],
        },
        schemaColumnNames: ['created_at', 'name'],
        indexes: [],
        summary:
          'Recreates table buckets to apply schema changes: database/buckets/column:created_at/default',
        postchecks: [
          {
            description: 'verify "created_at" has no default on "buckets"',
            sql: "SELECT COUNT(*) > 0 FROM pragma_table_info('buckets') WHERE name = 'created_at' AND dflt_value IS NULL",
          },
        ],
        operationClass: 'destructive',
      }),
      this.recreateTable({
        tableName: 'objects',
        contractTable: {
          columns: [
            { name: 'bucket_name', typeSql: 'TEXT', defaultSql: '', nullable: false },
            { name: 'content_type', typeSql: 'TEXT', defaultSql: '', nullable: false },
            { name: 'created_at', typeSql: 'TEXT', defaultSql: '', nullable: false },
            { name: 'id', typeSql: 'TEXT', defaultSql: '', nullable: false },
            { name: 'key', typeSql: 'TEXT', defaultSql: '', nullable: false },
            { name: 'size', typeSql: 'INTEGER', defaultSql: '', nullable: false },
          ],
          primaryKey: { columns: ['id'] },
          uniques: [{ columns: ['bucket_name', 'key'] }],
          foreignKeys: [
            {
              columns: ['bucket_name'],
              references: { table: 'buckets', columns: ['name'] },
              onDelete: 'restrict',
              onUpdate: 'restrict',
            },
          ],
        },
        schemaColumnNames: ['bucket_name', 'content_type', 'created_at', 'id', 'key', 'size'],
        indexes: [{ name: 'objects_bucket_name_idx_a0195dbd', columns: ['bucket_name'] }],
        summary:
          'Recreates table objects to apply schema changes: database/objects/column:created_at/default',
        postchecks: [
          {
            description: 'verify "created_at" has no default on "objects"',
            sql: "SELECT COUNT(*) > 0 FROM pragma_table_info('objects') WHERE name = 'created_at' AND dflt_value IS NULL",
          },
        ],
        operationClass: 'destructive',
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
