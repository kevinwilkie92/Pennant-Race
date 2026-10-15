import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, type Team } from './api';
import { useAuth } from './auth';
import { useRealtime } from './realtime';

type TeamsState = { teams: Team[]; byId: Map<string, Team>; loaded: boolean; reload: () => Promise<void> };
const Ctx = createContext<TeamsState>({ teams: [], byId: new Map(), loaded: false, reload: async () => {} });

/**
 * The league's teams, kept current: whenever anyone renames their team or changes its logo the server says so
 * and every screen using this updates at once.
 */
export function TeamsProvider({ children }: { children: React.ReactNode }) {
  const { me, refresh } = useAuth();
  const { subscribe } = useRealtime();
  const [teams, setTeams] = useState<Team[]>([]);
  const [loaded, setLoaded] = useState(false);
  const userId = me?.user.id ?? null;
  const myTeam = me?.user.teamId ?? null;

  const reload = useCallback(async () => {
    try { setTeams(await api.teams()); } catch { /* keep what we have */ } finally { setLoaded(true); }
  }, []);

  useEffect(() => { if (userId) reload(); else { setTeams([]); setLoaded(false); } }, [userId, reload]);

  useEffect(() => subscribe((ev) => {
    if (ev.type !== 'team') return;
    reload();
    if (ev.id === myTeam) refresh();                      // your own card (name, logo) comes from your account
  }), [subscribe, reload, refresh, myTeam]);

  const value = useMemo(() => ({ teams, byId: new Map(teams.map((t) => [t.id, t])), loaded, reload }), [teams, loaded, reload]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
export const useTeams = () => useContext(Ctx);
