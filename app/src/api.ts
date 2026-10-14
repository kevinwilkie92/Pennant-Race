import type { Slot } from '@pennant/domain';

export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8787';

let token: string | null = null;
export const setToken = (t: string | null) => { token = t; };
export const getToken = () => token;

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, (body as { error?: string }).error ?? `Request failed (${res.status})`);
  return body as T;
}

export type Team = { id: string; owner: string; name: string; color: string; logoKey: string | null; faab: number };
export type RosterSlot = {
  slot: string; playerId: number; name: string; mlbTeam: string | null; pos: string; pos2: string | null;
  positions: string[]; keeperYear: number | null; price: number | null;
};
export type Me = { user: { id: string; email: string; teamId: string | null; isCommissioner: boolean }; team: { id: string; name: string; color: string; owner_name: string; faab: number } | null };

export const api = {
  login: (email: string, password: string) =>
    call<{ token: string }>('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  register: (b: { email: string; password: string; teamId: string; joinCode: string }) =>
    call<{ token: string }>('/auth/register', { method: 'POST', body: JSON.stringify(b) }),
  logout: () => call<{ ok: true }>('/auth/logout', { method: 'POST' }),
  me: () => call<Me>('/me'),
  publicTeams: () => call<{ id: string; name: string; owner: string; claimed: number }[]>('/public/teams'),
  teams: () => call<Team[]>('/teams'),
  roster: (teamId: string, season = 2026) =>
    call<{ season: number; teamId: string; slots: RosterSlot[] }>(`/teams/${teamId}/roster?season=${season}`),
};

export type { Slot };
