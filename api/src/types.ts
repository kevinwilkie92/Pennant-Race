export interface Env {
  DB: D1Database;
  LOGOS: R2Bucket;
  DRAFT_ROOM: DurableObjectNamespace;
  /** Secret code league members need to register (set with `wrangler secret put JOIN_CODE`). */
  JOIN_CODE: string;
  /** Comma-separated OAuth client IDs the API accepts Google ID tokens for (the web ID first). Unset = Google sign-in off. */
  GOOGLE_CLIENT_IDS?: string;
  /** Comma-separated Apple Services IDs / bundle IDs the API accepts. Unset = Apple sign-in off. */
  APPLE_CLIENT_IDS?: string;
  /** Override where provider signing keys are fetched from (used by the end-to-end tests only). */
  /** Override the MLB stats API base URL (used by the end-to-end tests only). */
  MLB_API_BASE?: string;
  GOOGLE_JWKS_URL?: string;
  APPLE_JWKS_URL?: string;
}

export type AuthUser = { id: string; email: string; teamId: string | null; isCommissioner: boolean };

export type AppVars = { user: AuthUser };
