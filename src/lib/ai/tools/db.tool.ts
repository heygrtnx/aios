import { tool } from 'ai';
import { z } from 'zod';
import type { PrismaService } from '../../prisma/prisma.service';

const MAX_SELECT_LIMIT = 100;

async function getTableNames(prisma: PrismaService): Promise<string[]> {
  const rows = await prisma.$queryRaw<
    { table_name: string }[]
  >`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`;
  return rows.map((r) => r.table_name);
}

function escapeTableName(name: string): string {
  return name.replace(/"/g, '""');
}

export function createDbTool(prisma: PrismaService) {
  return tool({
    description: `Query the database for information. Use when the user asks about data, records, tables, or what is stored in the database. You can list tables, describe a table's columns, or fetch sample rows from a table (read-only).`,
    inputSchema: z.object({
      action: z
        .enum(['list_tables', 'describe_table', 'select_rows'])
        .describe(
          'list_tables: get all table names. describe_table: get columns for one table. select_rows: get up to limit rows from a table.',
        ),
      tableName: z
        .string()
        .optional()
        .describe(
          'Required for describe_table and select_rows. The table name (e.g. User, Post).',
        ),
      limit: z
        .number()
        .min(1)
        .max(MAX_SELECT_LIMIT)
        .optional()
        .default(10)
        .describe(
          'For select_rows only. Max rows to return (default 10, max 100).',
        ),
    }),
    execute: async ({ action, tableName, limit }) => {
      try {
        if (action === 'list_tables') {
          const tables = await getTableNames(prisma);
          return {
            tables: tables.length ? tables : [],
            message:
              tables.length === 0
                ? 'There are no user tables in the public schema yet.'
                : undefined,
          };
        }

        if (!tableName?.trim()) {
          return { error: 'tableName is required for this action.' };
        }

        const tables = await getTableNames(prisma);
        const safeName = tableName.trim();
        if (!tables.includes(safeName)) {
          return {
            error: `Table "${safeName}" not found. Available tables: ${tables.join(', ') || '(none)'}.`,
          };
        }

        if (action === 'describe_table') {
          const columns = await prisma.$queryRaw<
            { column_name: string; data_type: string }[]
          >`
            SELECT column_name, data_type
            FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = ${safeName}
            ORDER BY ordinal_position
          `;
          return { table: safeName, columns };
        }

        if (action === 'select_rows') {
          const safeLimit = Math.min(
            Math.max(1, Number(limit) || 10),
            MAX_SELECT_LIMIT,
          );
          const quoted = `"${escapeTableName(safeName)}"`;
          const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
            `SELECT * FROM ${quoted} LIMIT $1`,
            safeLimit,
          );
          return { table: safeName, rowCount: rows.length, rows };
        }

        return { error: 'Unknown action.' };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { error: `Database error: ${message}` };
      }
    },
  });
}
