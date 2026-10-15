import { useCallback, useEffect, useState } from 'react';
import { api, type WeekInfo } from './api';
import { useTeams } from './teams';

/** Teams + calendar shared by the League and Matchup screens. */
export function useLeague() {
  const { teams, byId, loaded: teamsLoaded, reload: reloadTeams } = useTeams();
  const [weeks, setWeeks] = useState<WeekInfo[]>([]);
  const [current, setCurrent] = useState<number | null>(null);
  const [weeksLoaded, setWeeksLoaded] = useState(false);
  const load = useCallback(async () => {
    try { const w = await api.weeks(); setWeeks(w.weeks); setCurrent(w.current); } finally { setWeeksLoaded(true); }
  }, []);
  useEffect(() => { load(); }, [load]);
  return { teams, byId, weeks, current, loaded: teamsLoaded && weeksLoaded, reload: async () => { await Promise.all([load(), reloadTeams()]); } };
}

export const fmtPts = (n: number | undefined | null) =>
  n == null ? '–' : Number.isInteger(n) ? String(n) : n.toFixed(1);
