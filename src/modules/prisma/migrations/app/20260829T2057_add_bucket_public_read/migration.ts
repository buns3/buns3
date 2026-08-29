#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/a0d4ead53b02e728e574deee7a5706de655cad9a1f4764bb8932c12c7a40db58/contract';
import endContract from '../../snapshots/a0d4ead53b02e728e574deee7a5706de655cad9a1f4764bb8932c12c7a40db58/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/b9a634d0340f9264d69d21e2a89b6ef0cfe15767217f9419b637806e719a547e/contract';
import startContract from '../../snapshots/b9a634d0340f9264d69d21e2a89b6ef0cfe15767217f9419b637806e719a547e/contract.json' with { type: 'json' };
import { Migration, MigrationCLI } from '@prisma/orm-sqlite/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        table: 'buckets',
        column: {
          name: 'public_read',
          typeSql: 'INTEGER',
          defaultSql: 'DEFAULT 0',
          nullable: false,
        },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
