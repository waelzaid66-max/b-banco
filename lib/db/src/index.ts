import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

type Db = NodePgDatabase<typeof schema>;

let poolRef: pg.Pool | null = null;
let dbRef: Db | null = null;

function requireDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL must be set. Did you forget to provision a database?",
    );
  }
  return url;
}

function initPool(): pg.Pool {
  if (!poolRef) {
    poolRef = new Pool({ connectionString: requireDatabaseUrl() });
  }
  return poolRef;
}

function initDb(): Db {
  if (!dbRef) {
    dbRef = drizzle(initPool(), { schema });
  }
  return dbRef;
}

/** Lazy pool — safe to import without DATABASE_URL until first query. */
export const pool: pg.Pool = new Proxy({} as pg.Pool, {
  get(_target, prop, receiver) {
    const real = initPool();
    const value = Reflect.get(real, prop, receiver);
    return typeof value === "function" ? value.bind(real) : value;
  },
});

/** Lazy drizzle client — defers connection until first DB operation. */
export const db: Db = new Proxy({} as Db, {
  get(_target, prop, receiver) {
    const real = initDb();
    const value = Reflect.get(real, prop, receiver);
    return typeof value === "function" ? value.bind(real) : value;
  },
});

export { ensureSchemaPatches } from "./ensureSchema";
export * from "./schema";
