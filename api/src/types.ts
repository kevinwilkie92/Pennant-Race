export interface Env {
  DB: D1Database;
  LOGOS: R2Bucket;
  DRAFT_ROOM: DurableObjectNamespace;
  /** Secret code league members need to register (set with `wrangler secret put JOIN_CODE`). */
  JOIN_CODE: string;
}

export type AuthUser = { id: string; email: string; teamId: string | null; isCommissioner: boolean };

export type AppVars = { user: AuthUser };
