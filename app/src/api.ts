import type { Slot } from '@pennant/domain';

export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8787';

let token: string | null = null;
export const setToken = (t: string | null) => { token = t; };
export const getToken = () => token;

export class ApiError extends Error {
  constructor(public status: number, message: string, public data: Record<string, unknown> = {}) { super(message); }
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
  if (!res.ok) throw new ApiError(res.status, (body as { error?: string }).error ?? `Request failed (${res.status})`, body as Record<string, unknown>);
  return body as T;
}

export type Team = { id: string; owner: string; name: string; color: string; logoKey: string | null; faab: number };
export type RosterSlot = {
  slot: string; playerId: number; name: string; mlbTeam: string | null; pos: string; pos2: string | null;
  positions: string[]; keeperYear: number | null; price: number | null; injury?: string | null;
};
export type Me = { user: { id: string; email: string; teamId: string | null; isCommissioner: boolean }; team: { id: string; name: string; color: string; owner_name: string; faab: number; logo_key?: string | null } | null };

/** Where a team's logo lives (the file name is random, so the URL changes whenever the logo does). */
export const logoUrl = (key?: string | null) => (key ? `${API_URL}/logos/${key}` : null);

export type DraftSale = {
  seq: number; playerId: number; name: string; teamId: string; price: number;
  isKeeper: number; keeperYear: number | null; slot: string | null;
};
export type DraftManager = { teamId: string; spent: number; filled: number; remaining: number; maxBid: number; spots: number };
/** The player currently "on the block", with the leading manager and bid if the commissioner is tracking one. */
export type Nomination = { playerId: number; name: string; mlbTeam: string | null; positions: string[]; teamId: string | null; bid: number | null; at: number };
export type DraftState = { season: number; hat: string | null; nomination: Nomination | null; managers: DraftManager[]; sales: DraftSale[] };
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

export type LineupSlot = RosterSlot & { locked: boolean; points: number | null };
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

export type PoolPlayer = { id: number; name: string; mlbTeam: string | null; pos: string; positions: string[]; ownerId: string | null; watched: boolean; injury?: string | null; waiversUntil?: string | null };
export type Claim = {
  id: number; teamId: string; addId: number; dropId: number | null; bid: number; priority: number; status: string;
  reason: string | null; addName?: string; dropName?: string | null; processedAt: number | null; waiversUntil?: string | null;
};
export type PlayerCardData = {
  player: { id: number; name: string; mlbTeam: string | null; positions: string[] };
  ownerId: string | null; injury: { status: string; note: string | null } | null; waiversUntil: string | null;
  draft: { season: number; teamId: string; price: number; isKeeper: number; keeperYear: number | null }[];
  history: { type: string; teamId: string; from?: string; faab: number | null; at: number }[];
  points: { date: string; teamId: string; slot: string; points: number }[]; seasonPoints: number;
  stats: PlayerStats | null;
};
export type PlayerStats = {
  season: number; role: 'H' | 'P'; games: number; points: number; totals: Record<string, number>;
  log: { date: string; points: number; summary: string }[];
};
export type LeaderRow = { id: number; name: string; mlbTeam: string | null; pos: string; role: 'H' | 'P'; games: number; points: number; positions: string[]; ownerId: string | null };
export type FeedStatus = {
  total: number; mapped: number; games: number; finalGames: number; lastGameDate: string | null;
  lastSync: { value: { date: string }; at: number } | null; lastError: { value: { date: string; message: string }; at: number } | null;
  injuries: { value: { set: number; cleared: number }; at: number } | null;
};
export type Txn = { id: number; type: 'draft' | 'waiver' | 'trade' | 'add' | 'drop'; teamId: string; faab: number | null; at: number; player: string | null; detail?: string | null };

export type TradePlayer = { id: number; name: string; mlbTeam: string | null; positions: string[] };
export type TradeOffer = {
  id: number; fromTeam: string; toTeam: string; give: TradePlayer[]; get: TradePlayer[]; status: 'pending' | 'accepted' | 'rejected' | 'cancelled';
  reason: string | null; createdAt: number; resolvedAt: number | null; problem: string | null;
};

export type ChatMessage = {
  id: number; teamId: string; toTeam: string | null; groupId: number | null; body: string; createdAt: number; editedAt: number | null; pinned: boolean;
  reactions: Record<string, string[]>; imageKey: string | null; mentions: string[];
  replyTo: { id: number; teamId?: string; body?: string; hasImage?: boolean; deleted?: boolean } | null;
};
export type DmConversation = { team: string; unread: number; last: { id: number; fromMe: boolean; body: string; hasImage: boolean; createdAt: number } };
export type ChatGroup = { id: number; name: string | null; createdBy: string; members: string[] };
export type GroupConversation = ChatGroup & { unread: number; last: { id: number; teamId: string; fromMe: boolean; body: string; hasImage: boolean; createdAt: number } | null };
export const chatImageUrl = (key?: string | null) => (key ? `${API_URL}/chat-images/${key}` : null);

export const api = {
  login: (email: string, password: string) =>
    call<{ token: string }>('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  providers: () => call<import('./social').ProviderConfig>('/auth/providers'),
  social: (b: { provider: string; idToken: string; nonce: string; joinCode?: string; teamId?: string }) =>
    call<{ token: string }>('/auth/social', { method: 'POST', body: JSON.stringify(b) }),
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
  nominate: (playerId: number, teamId?: string | null, bid?: number | null) =>
    call<{ nomination: Nomination }>('/draft/nomination', { method: 'PUT', body: JSON.stringify({ playerId, teamId: teamId ?? null, bid: bid ?? null }) }),
  clearNomination: () => call<{ ok: true }>('/draft/nomination', { method: 'DELETE' }),
  undo: () => call<{ ok: true }>('/draft/sales/last', { method: 'DELETE' }),
  editSale: (season: number, playerId: number, b: { price?: number; teamId?: string }) =>
    call<{ ok: true }>(`/draft/archive/${season}/sales/${playerId}`, { method: 'PATCH', body: JSON.stringify(b) }),
  removeSale: (season: number, playerId: number) => call<{ ok: true }>(`/draft/archive/${season}/sales/${playerId}`, { method: 'DELETE' }),
  setHat: (mlbTeam: string | null) => call<{ ok: true }>('/draft/hat', { method: 'POST', body: JSON.stringify({ mlbTeam }) }),
  lineup: (teamId: string, date?: string) =>
    call<{ season: number | null; date: string | null; today: string; editable: boolean; total: number; slots: LineupSlot[] }>(
      `/teams/${teamId}/lineup${date ? `?date=${date}` : ''}`),
  moveLineup: (teamId: string, b: { date: string; playerId: number; toSlot: string }) =>
    call<{ ok: true }>(`/teams/${teamId}/lineup`, { method: 'PUT', body: JSON.stringify(b) }),
  pool: (o: { q?: string; pos?: string; sort?: string; dir?: string; watch?: boolean; all?: boolean; offset?: number; limit?: number }) => {
    const qs = new URLSearchParams();
    if (o.q) qs.set('q', o.q);
    if (o.pos && o.pos !== 'ALL') qs.set('pos', o.pos);
    if (o.sort) qs.set('sort', o.sort);
    if (o.dir) qs.set('dir', o.dir);
    if (o.watch) qs.set('watch', '1');
    if (o.all) qs.set('owned', 'all');
    qs.set('limit', String(o.limit ?? 60));
    qs.set('offset', String(o.offset ?? 0));
    return call<{ season: number | null; total: number; players: PoolPlayer[] }>(`/players/pool?${qs}`);
  },
  watch: (playerId: number, watched: boolean) =>
    call<{ ok: true }>('/watchlist', { method: 'PUT', body: JSON.stringify({ playerId, watched }) }),
  claims: () => call<{ season: number | null; faab: number; pending: Claim[]; recent: Claim[] }>('/claims'),
  createClaim: (b: { addPlayerId: number; dropPlayerId?: number | null; bid: number }) =>
    call<{ id: number }>('/claims', { method: 'POST', body: JSON.stringify(b) }),
  editClaim: (id: number, b: { bid?: number; dropPlayerId?: number | null; move?: 'up' | 'down' }) =>
    call<{ ok: true }>(`/claims/${id}`, { method: 'PATCH', body: JSON.stringify(b) }),
  cancelClaim: (id: number) => call<{ ok: true }>(`/claims/${id}`, { method: 'DELETE' }),
  processWaivers: () => call<{ won: number; failed: number }>('/waivers/process', { method: 'POST' }),
  dropPlayer: (playerId: number) => call<{ ok: true }>('/roster/drop', { method: 'POST', body: JSON.stringify({ playerId }) }),
  transactions: (teamId?: string) => call<Txn[]>(`/transactions?limit=60${teamId ? `&teamId=${teamId}` : ''}`),
  trades: () => call<{ season: number | null; sent: TradeOffer[]; received: TradeOffer[]; history: TradeOffer[] }>('/trades'),
  proposeTrade: (b: { toTeam: string; give: number[]; get: number[] }) => call<{ id: number }>('/trades', { method: 'POST', body: JSON.stringify(b) }),
  acceptTrade: (id: number) => call<{ ok: true }>(`/trades/${id}/accept`, { method: 'POST' }),
  rejectTrade: (id: number) => call<{ ok: true }>(`/trades/${id}/reject`, { method: 'POST' }),
  cancelTrade: (id: number) => call<{ ok: true }>(`/trades/${id}/cancel`, { method: 'POST' }),
  setStatus: (playerId: number, status: 'DTD' | 'IL' | 'OUT' | null) =>
    call<{ ok: true }>(`/players/${playerId}/status`, { method: 'PUT', body: JSON.stringify({ status }) }),
  leaders: (q: { window: string; role?: string; pos?: string; free?: boolean }) =>
    call<{ season: number | null; window: string; through?: string; players: LeaderRow[] }>(
      `/players/stats?window=${q.window}${q.role ? `&role=${q.role}` : ''}${q.pos && q.pos !== 'ALL' ? `&pos=${q.pos}` : ''}${q.free ? '&free=1' : ''}`),
  feedStatus: () => call<FeedStatus>('/stats/status'),
  feedUnmapped: () => call<{ id: number; name: string; mlbTeam: string | null; pos: string; drafted: number }[]>('/stats/unmapped'),
  feedMap: (step: 'players' | 'rosters' | 'search', from = 0) =>
    call<{ step: string; matched: number; remaining: number; next: number | null }>('/stats/map-players', { method: 'POST', body: JSON.stringify({ step, from }) }),
  feedSync: (from: string, to: string) =>
    call<{ results: { date: string; games: number; fetched: number; rows: number }[] }>('/stats/sync', { method: 'POST', body: JSON.stringify({ from, to }) }),
  feedRefresh: () => call<{ injuries: { set: number; cleared: number }; eligibility: { added: number } }>('/stats/refresh', { method: 'POST' }),
  feedSetMlbId: (playerId: number, mlbId: number | null) =>
    call<{ ok: true }>(`/stats/players/${playerId}/mlb-id`, { method: 'PUT', body: JSON.stringify({ mlbId }) }),
  playerCard: (id: number) => call<PlayerCardData>(`/players/${id}/card`),
  leagueSettings: () => call<{ waiverDays: number }>('/league/settings'),
  setWaiverDays: (waiverDays: number) => call<{ waiverDays: number }>('/league/settings', { method: 'PUT', body: JSON.stringify({ waiverDays }) }),
  chat: (before?: number) => call<{ messages: ChatMessage[]; hasMore: boolean; pinned: ChatMessage | null; emoji: string[] }>(`/chat?limit=40${before ? `&before=${before}` : ''}`),
  chatDm: (team: string, before?: number) => call<{ messages: ChatMessage[]; hasMore: boolean }>(`/chat/dm/${team}?limit=40${before ? `&before=${before}` : ''}`),
  chatGroups: () => call<{ groups: GroupConversation[]; totalUnread: number }>('/chat/groups'),
  chatGroup: (id: number, before?: number) => call<{ group: ChatGroup; messages: ChatMessage[]; hasMore: boolean }>(`/chat/groups/${id}?limit=40${before ? `&before=${before}` : ''}`),
  chatGroupCreate: (teamIds: string[], name?: string) => call<{ group: ChatGroup; existing: boolean }>('/chat/groups', { method: 'POST', body: JSON.stringify({ teamIds, name: name || undefined }) }),
  chatGroupRename: (id: number, name: string) => call<{ group: ChatGroup }>(`/chat/groups/${id}`, { method: 'PATCH', body: JSON.stringify({ name }) }),
  chatGroupAdd: (id: number, teamId: string) => call<{ group: ChatGroup }>(`/chat/groups/${id}/members`, { method: 'POST', body: JSON.stringify({ teamId }) }),
  chatGroupLeave: (id: number) => call<{ ok: true }>(`/chat/groups/${id}/members/me`, { method: 'DELETE' }),
  chatGroupRead: (groupId: number, lastId: number) => call<{ ok: true }>('/chat/group-read', { method: 'POST', body: JSON.stringify({ groupId, lastId }) }),
  chatDms: () => call<{ conversations: DmConversation[]; totalUnread: number }>('/chat/dms'),
  chatDmRead: (team: string, lastId: number) => call<{ ok: true }>('/chat/dm-read', { method: 'POST', body: JSON.stringify({ team, lastId }) }),
  chatUnread: () => call<{ count: number; mentions: number; dm: number }>('/chat/unread'),
  chatRead: (lastId: number) => call<{ ok: true }>('/chat/read', { method: 'POST', body: JSON.stringify({ lastId }) }),
  chatSend: (b: { body?: string; replyTo?: number; toTeam?: string; groupId?: number; imageKey?: string }) => call<ChatMessage>('/chat', { method: 'POST', body: JSON.stringify(b) }),
  chatEdit: (id: number, body: string) => call<ChatMessage>(`/chat/${id}`, { method: 'PATCH', body: JSON.stringify({ body }) }),
  chatUpload: async (image: Blob) => {
    const res = await fetch(`${API_URL}/chat/image`, { method: 'POST', headers: { 'content-type': image.type || 'application/octet-stream', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: image });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiError(res.status, (body as { error?: string }).error ?? `Upload failed (${res.status})`);
    return body as { imageKey: string };
  },
  chatReact: (id: number, emoji: string) => call<{ reactions: Record<string, string[]> }>(`/chat/${id}/react`, { method: 'POST', body: JSON.stringify({ emoji }) }),
  chatPin: (id: number, pinned: boolean) => call<{ pinned: ChatMessage | null }>(`/chat/${id}/pin`, { method: 'PUT', body: JSON.stringify({ pinned }) }),
  chatDelete: (id: number) => call<{ ok: true }>(`/chat/${id}`, { method: 'DELETE' }),
  uploadLogo: async (teamId: string, image: Blob) => {
    const res = await fetch(`${API_URL}/teams/${teamId}/logo`, {
      method: 'PUT', headers: { 'content-type': image.type || 'application/octet-stream', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: image,
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiError(res.status, (body as { error?: string }).error ?? `Upload failed (${res.status})`);
    return body as { logoKey: string };
  },
  removeLogo: (teamId: string) => call<{ logoKey: null }>(`/teams/${teamId}/logo`, { method: 'DELETE' }),
  renameTeam: (teamId: string, name: string) => call<{ name: string }>(`/teams/${teamId}`, { method: 'PATCH', body: JSON.stringify({ name }) }),
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
