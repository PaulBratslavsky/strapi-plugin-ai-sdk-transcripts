import { describe, it, expect } from 'vitest';
import { migrateFromAiSdkId } from '../../server/src/lib/migrate-from-ai-sdk-id';

/**
 * The migration runs in register(), before Strapi creates its own tables. On
 * the first boot of a fresh database `admin_permissions` does not exist yet,
 * so the grant rename failed with "no such table" and every new install saw a
 * red "migration failed" error on its first boot. There is nothing to migrate
 * there, so that step must be skipped, not reported.
 */

interface Log {
  level: string;
  message: string;
}

function fakeStrapi(opts: { tables: string[]; grants?: number; updateThrows?: string }) {
  const logs: Log[] = [];
  const updates: string[] = [];
  const log = (level: string) => (message: string) => logs.push({ level, message });

  const connection: any = (table: string) => ({
    where: () => ({
      update: async () => {
        if (!opts.tables.includes(table)) throw new Error(`no such table: ${table}`);
        if (opts.updateThrows) throw new Error(opts.updateThrows);
        updates.push(table);
        return opts.grants ?? 0;
      },
    }),
    count: async () => [{ count: 0 }],
  });
  connection.schema = {
    hasTable: async (name: string) => opts.tables.includes(name),
    renameTable: async () => {},
  };
  connection.raw = (sql: string) => sql;

  const strapi: any = {
    db: { connection },
    log: { info: log('info'), warn: log('warn'), error: log('error'), debug: log('debug') },
  };
  return { strapi, logs, updates };
}

describe('migrateFromAiSdkId', () => {
  it('stays quiet on the first boot of a fresh database', async () => {
    const { strapi, logs, updates } = fakeStrapi({ tables: [] });

    await migrateFromAiSdkId(strapi);

    expect(logs.filter((l) => l.level === 'error')).toEqual([]);
    expect(updates).toEqual([]);
  });

  it('still renames old grants when admin_permissions exists', async () => {
    const { strapi, logs, updates } = fakeStrapi({ tables: ['admin_permissions'], grants: 3 });

    await migrateFromAiSdkId(strapi);

    expect(updates).toEqual(['admin_permissions']);
    expect(logs).toContainEqual({
      level: 'info',
      message: '[youtube-transcripts] migrated 3 permission grant(s)',
    });
  });

  it('still reports a real failure', async () => {
    const { strapi, logs } = fakeStrapi({
      tables: ['admin_permissions'],
      updateThrows: 'database is locked',
    });

    await migrateFromAiSdkId(strapi);

    const errors = logs.filter((l) => l.level === 'error');
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain('database is locked');
  });
});
