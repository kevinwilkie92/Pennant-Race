import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { assignSlots } from '@pennant/domain';
import {
  API_URL, api, getToken,
  type DraftPlayer, type DraftSale, type DraftState, type MlbTeam, type SeasonRow, type Team,
} from '../api';

export type Group = 'CIF' | 'OF' | 'SP' | 'RP';
export const GROUPS: { key: Group; label: string; color: string }[] = [
  { key: 'CIF', label: 'C/IF', color: '#2bb0c4' },
  { key: 'OF', label: 'OF', color: '#5fbf6f' },
  { key: 'SP', label: 'SP', color: '#8a7dff' },
  { key: 'RP', label: 'RP', color: '#e08a3b' },
];

/** Board column for a player: C/IF, OF (+DH/Util), SP or RP — by primary position. */
export function groupOf(p: { pos: string }): Group {
  if (p.pos === 'SP') return 'SP';
  if (p.pos === 'RP' || p.pos === 'P') return 'RP';
  if (['OF', 'DH', 'Util', 'UTIL'].includes(p.pos)) return 'OF';
  return 'CIF';
}

export function useDraft() {
  const [seasons, setSeasons] = useState<SeasonRow[]>([]);
  const [season, setSeason] = useState<number | null>(null);
  const [players, setPlayers] = useState<DraftPlayer[]>([]);
  const [mlb, setMlb] = useState<MlbTeam[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [state, setState] = useState<DraftState | null>(null);
  const [error, setError] = useState('');
  const [live, setLive] = useState(false);
  const seasonRef = useRef<number | null>(null);
  seasonRef.current = season;

  // Static data + season list, once.
  useEffect(() => {
    Promise.all([api.seasons(), api.mlbTeams(), api.teams()])
      .then(([s, m, t]) => {
        setSeasons(s); setMlb(m); setTeams(t);
        setSeason((s.find((x) => x.status === 'live') ?? s[0])?.year ?? null);
      })
      .catch((e) => setError(e.message));
  }, []);

  const reloadSeasons = useCallback(async () => {
    const s = await api.seasons();
    setSeasons(s);
    setSeason((s.find((x) => x.status === 'live') ?? s[0])?.year ?? null);
  }, []);

  const refresh = useCallback(async () => {
    const yr = seasonRef.current;
    if (yr == null) return;
    try {
      const [st, pl] = await Promise.all([api.draftState(yr), api.draftPlayers(yr)]);
      setState(st); setPlayers(pl); setError('');
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed to load draft'); }
  }, []);

  useEffect(() => { setState(null); refresh(); }, [season, refresh]);

  // Realtime: every client (TV, commissioner, phones) refetches on any draft event.
  useEffect(() => {
    let ws: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout>;
    let closed = false;
    const connect = () => {
      const token = getToken();
      if (!token) return;
      ws = new WebSocket(`${API_URL.replace(/^http/, 'ws')}/draft/ws?token=${encodeURIComponent(token)}`);
      ws.onopen = () => setLive(true);
      ws.onmessage = (m) => {
        try {
          const ev = JSON.parse(String(m.data));
          if (ev.type === 'hat') setState((s) => (s ? { ...s, hat: ev.mlbTeam } : s));
          else if (ev.type === 'sale' || ev.type === 'undo' || ev.type === 'keepers') { if (ev.season === seasonRef.current) refresh(); }
        } catch { /* ignore malformed */ }
      };
      ws.onclose = () => { setLive(false); if (!closed) retry = setTimeout(connect, 2000); };
    };
    connect();
    return () => { closed = true; clearTimeout(retry); ws?.close(); };
  }, [refresh]);

  const status = seasons.find((s) => s.year === season)?.status ?? 'archived';

  const derived = useMemo(() => {
    const byPlayer = new Map(players.map((p) => [p.id, p]));
    const sale = new Map((state?.sales ?? []).map((s) => [s.playerId, s]));
    const roster = new Map<string, { sale: DraftSale; label: string }[]>();
    for (const tm of teams) {
      const mine = (state?.sales ?? []).filter((s) => s.teamId === tm.id);
      const slots = assignSlots(mine.map((s) => ({
        playerId: s.playerId, slot: s.slot, positions: byPlayer.get(s.playerId)?.positions ?? [],
      })));
      roster.set(tm.id, mine.flatMap((s) => (slots.has(s.playerId) ? [{ sale: s, label: slots.get(s.playerId)! }] : [])));
    }
    return { byPlayer, sale, roster };
  }, [players, state, teams]);

  return { seasons, season, setSeason, reloadSeasons, status, players, mlb, teams, state, error, live, refresh, ...derived };
}
