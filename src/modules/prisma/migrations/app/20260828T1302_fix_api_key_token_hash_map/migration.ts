#!/usr/bin/env -S bun
import type { Contract as Start } from '../../snapshots/48c976c9fdaddf754b92b05cd8b99b5f48cdec5df55ff85b353c40620b1fa107/contract';
import startContract from '../../snapshots/48c976c9fdaddf754b92b05cd8b99b5f48cdec5df55ff85b353c40620b1fa107/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/58a7d9161a16a5ef297b9d7680490cbb724ae5ccd5886ff9ef969863b958b665/contract';
import endContract from '../../snapshots/58a7d9161a16a5ef297b9d7680490cbb724ae5ccd5886ff9ef969863b958b665/contract.json' with { type: 'json' };
import { Migration, MigrationCLI } from '@prisma/orm-sqlite/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        table: 'api_keys',
        column: { name: 'token_hash', typeSql: 'TEXT', defaultSql: '', nullable: false },
      }),
      this.recreateTable({
        tableName: 'api_keys',
        contractTable: {
          columns: [
            { name: 'bucket_name', typeSql: 'TEXT', defaultSql: '', nullable: true },
            { name: 'can_read', typeSql: 'INTEGER', defaultSql: '', nullable: false },
            { name: 'can_write', typeSql: 'INTEGER', defaultSql: '', nullable: false },
            {
              name: 'created_at',
              typeSql: 'TEXT',
              defaultSql: "DEFAULT (datetime('now'))",
              nullable: false,
            },
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
          'tokenHash',
          'token_hint',
        ],
        indexes: [{ name: 'api_keys_bucket_name_idx_a0195dbd', columns: ['bucket_name'] }],
        summary:
          'Recreates table api_keys to apply schema changes: database/api_keys/unique:token_hash; database/api_keys/unique:tokenHash',
        postchecks: [
          {
            description: 'verify unique constraint (token_hash) on "api_keys"',
            sql: "SELECT EXISTS (SELECT 1 FROM pragma_index_list('api_keys') l WHERE l.\"unique\" = 1 AND (SELECT COUNT(*) FROM pragma_index_info(l.name)) = 1 AND (SELECT COUNT(*) FROM pragma_index_info(l.name) WHERE name IN ('token_hash')) = 1)",
          },
        ],
        operationClass: 'destructive',
      }),
      this.dropColumn({ table: 'api_keys', column: 'tokenHash' }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
