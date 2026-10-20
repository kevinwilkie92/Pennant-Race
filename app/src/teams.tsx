import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { DEFAULT_RULES } from '@pennant/domain';
import { api, type LeagueRules, type Team } from './api';
import { useAuth } from './auth';
import { useRealtime } from './realtime';

type TeamsState = { teams: Team[]; byId: Map<string, Team>; loaded: boolean; reload: () => Promise<void>; leagueName: string; signupsOpen: boolean; rules: LeagueRules };
const Ctx = createContext<TeamsState>({ teams: [], byId: new Map(), loaded: false, reload: async () => {}, leagueName: 'Carrollton All Stars', signupsOpen: true, rules: DEFAULT_RULES });

/**
 * The league's teams, kept current: whenever anyone renames their team or changes its logo the server says so
 * and every screen using this updates at once.
 */
export function TeamsProvider({ children }: { children: React.ReactNode }) {
  const { me, refresh } = useAuth();
  const { subscribe } = useRealtime();
  const [teams, setTeams] = useState<Team[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [rules, setRules] = useState<LeagueRules>(DEFAULT_RULES);
  const [league, setLeague] = useState({ name: 'Carrollton All Stars', signupsOpen: true });
  const userId = me?.user.id ?? null;
  const myTeam = me?.user.teamId ?? null;

  const reload = useCallback(async () => {
    try { setTeams(await api.teams()); } catch { /* keep what we have */ } finally { setLoaded(true); }
  }, []);

  useEffect(() => { if (userId) reload(); else { setTeams([]); setLoaded(false); } }, [userId, reload]);

  // The league's name and whether sign-ups are open (public, so the login screen can show them too).
  const loadLeague = useCallback(() => {
    api.publicLeague().then(setLeague).catch(() => {});
    if (userId) api.leagueRules().then((r) => setRules(r.rules)).catch(() => {});      // the editable rules (budget, scoring, keepers…) need a login
  }, [userId]);
  useEffect(loadLeague, [loadLeague]);

  useEffect(() => subscribe((ev) => {
    if (ev.type === 'league') { loadLeague(); refresh(); return; }       // name, sign-ups or commissioners changed (your own role too)
    if (ev.type !== 'team') return;
    reload();
    if (ev.id === myTeam) refresh();                      // your own card (name, logo) comes from your account
  }), [subscribe, reload, refresh, myTeam, loadLeague]);

  const value = useMemo(() => ({ teams, byId: new Map(teams.map((t) => [t.id, t])), loaded, reload, leagueName: league.name, signupsOpen: league.signupsOpen, rules }), [teams, loaded, reload, league, rules]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
export const useTeams = () => useContext(Ctx);
