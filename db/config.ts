import { column, defineDb, defineTable, sql } from 'astro:db';

export const CodeSnippet = defineTable({
  columns: {
    id: column.text({primaryKey: true}),
    code: column.text(),
    createdAt: column.date({default: sql`CURRENT_TIMESTAMP`})
  }
});

// https://astro.build/db/config
export default defineDb({
  tables: {
    CodeSnippet
  }
});
