import { useCallback, useEffect, useState } from 'react';
import { api, type Team, type WeekInfo } from './api';

/** Teams + calendar shared by the League and Matchup screens. */
export function useLeague() {
  const [teams, setTeams] = useState<Team[]>([]);
  const [weeks, setWeeks] = useState<WeekInfo[]>([]);
  const [current, setCurrent] = useState<number | null>(null);
  const [loaded, setLoaded] = useState(false);
  const load = useCallback(async () => {
    try {
      const [t, w] = await Promise.all([api.teams(), api.weeks()]);
      setTeams(t); setWeeks(w.weeks); setCurrent(w.current);
    } finally { setLoaded(true); }
  }, []);
  useEffect(() => { load(); }, [load]);
  const byId = new Map(teams.map((t) => [t.id, t]));
  return { teams, byId, weeks, current, loaded, reload: load };
}

export const fmtPts = (n: number | undefined | null) =>
  n == null ? '–' : Number.isInteger(n) ? String(n) : n.toFixed(1);
