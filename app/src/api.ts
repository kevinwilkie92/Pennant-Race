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

export type DraftSale = {
  seq: number; playerId: number; name: string; teamId: string; price: number;
  isKeeper: number; keeperYear: number | null; slot: string | null;
};
export type DraftManager = { teamId: string; spent: number; filled: number; remaining: number; maxBid: number; spots: number };
export type DraftState = { season: number; hat: string | null; managers: DraftManager[]; sales: DraftSale[] };
export type DraftPlayer = { id: number; name: string; mlbTeam: string | null; pos: string; pos2: string | null; positions: string[] };
export type MlbTeam = { abbr: string; name: string; logo: string | null; color: string | null; color2: string | null };
export type SeasonRow = { year: number; status: 'live' | 'archived' };

export type KeeperCandidate = {
  teamId: string; playerId: number; name: string; mlbTeam: string | null; pos: string; positions: string[];
  tier: 0 | 1 | 2; cost: number | null; lastPrice: number | null; avgSalary: number | null; kept: boolean;
};
export type KeeperRow = { teamId: string; playerId: number; name: string; mlbTeam: string | null; pos: string; year: 1 | 2; cost: number };
export type KeeperView = {
  season: number; status: 'live' | 'archived' | null; max: number; locked: boolean;
  kept: KeeperRow[]; candidates: KeeperCandidate[];
};

export type WeekInfo = { week: number; start: string; end: string; final: boolean };
export type MatchupRow = { week: number; home: string; away: string; homeScore: number; awayScore: number; final: boolean };
export type StandingRow = {
  teamId: string; rank: number; w: number; l: number; t: number; pct: number; gb: number; pf: number; pa: number;
  streak: string; played: number; remaining: number; status: 'clinched' | 'eliminated' | 'alive'; faab: number;
};
export type BracketMatch = {
  id: string; round: string; week: number; a: string | null; b: string | null;
  aScore: number | null; bScore: number | null; winner: string | null; loser: string | null;
};
export type WeekSlot = RosterSlot & { byDay: Record<string, number>; weekTotal: number };

// Demo/testing only: pretend "today" is this date so completed weeks can be viewed before a season starts.
const AS_OF = process.env.EXPO_PUBLIC_AS_OF ? `&asOf=${process.env.EXPO_PUBLIC_AS_OF}` : '';

export const api = {
  login: (email: string, password: string) =>
    call<{ token: string }>('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  register: (b: { email: string; password: string; teamId: string; joinCode: string }) =>
    call<{ token: string }>('/auth/register', { method: 'POST', body: JSON.stringify(b) }),
  logout: () => call<{ ok: true }>('/auth/logout', { method: 'POST' }),
  me: () => call<Me>('/me'),
  publicTeams: () => call<{ id: string; name: string; owner: string; claimed: number }[]>('/public/teams'),
  seasons: () => call<SeasonRow[]>('/seasons'),
  pushSeason: () => call<{ year: number }>('/seasons/push', { method: 'POST' }),
  keepers: (season: number) => call<KeeperView>(`/keepers?season=${season}`),
  setKeeper: (b: { teamId: string; playerId: number; kept: boolean }) =>
    call<{ ok: true }>('/keepers', { method: 'PUT', body: JSON.stringify(b) }),
  setValue: (playerId: number, avgSalary: number) =>
    call<{ ok: true }>('/player-values', { method: 'PUT', body: JSON.stringify({ playerId, avgSalary }) }),
  mlbTeams: () => call<MlbTeam[]>('/mlb-teams'),
  draftPlayers: (season: number) => call<DraftPlayer[]>(`/draft/players?season=${season}`),
  draftState: (season: number) => call<DraftState>(`/draft/state?season=${season}`),
  sell: (b: { playerId: number; teamId: string; price: number }) =>
    call<{ seq: number }>('/draft/sales', { method: 'POST', body: JSON.stringify(b) }),
  undo: () => call<{ ok: true }>('/draft/sales/last', { method: 'DELETE' }),
  setHat: (mlbTeam: string | null) => call<{ ok: true }>('/draft/hat', { method: 'POST', body: JSON.stringify({ mlbTeam }) }),
  weeks: () => call<{ season: number | null; current: number | null; weeks: WeekInfo[] }>(`/weeks?x=1${AS_OF}`),
  matchups: (week: number) => call<MatchupRow[]>(`/matchups?week=${week}${AS_OF}`),
  standings: () => call<{ season: number | null; playoffTeams: number; rows: StandingRow[] }>(`/standings?x=1${AS_OF}`),
  bracket: () => call<{ season: number | null; seeds: string[]; matches: BracketMatch[] }>(`/bracket?x=1${AS_OF}`),
  teamWeek: (teamId: string, week: number) =>
    call<{ season: number; week: number; days: string[]; slots: WeekSlot[] }>(`/teams/${teamId}/week?week=${week}`),
  createSchedule: (startDate: string) => call<{ weeks: number }>('/schedule', { method: 'POST', body: JSON.stringify({ startDate }) }),
  teams: () => call<Team[]>('/teams'),
  roster: (teamId: string, season = 2026) =>
    call<{ season: number; teamId: string; slots: RosterSlot[] }>(`/teams/${teamId}/roster?season=${season}`),
};

export type { Slot };
