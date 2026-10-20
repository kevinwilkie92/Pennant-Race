import { useState } from 'react';
import { Alert, Platform, Text, View } from 'react-native';
import { Redirect, useRouter } from 'expo-router';
import { rosterSizeOf } from '@pennant/domain';
import { api, type DraftPlayer } from '../src/api';
import { useTeams } from '../src/teams';
import { useAuth } from '../src/auth';
import { Award } from '../src/draft/Award';
import { Board } from '../src/draft/Board';
import { Money } from '../src/draft/Money';
import { Nav, type Tab } from '../src/draft/Nav';
import { Keepers } from '../src/draft/Keepers';
import { Log, Rosters, Undrafted } from '../src/draft/Tables';
import { D } from '../src/draft/tokens';
import { useDraft } from '../src/draft/useDraft';

// Commissioner-run TV board (README "Draft Room — TV big board"). Everyone else sees it read-only, live.
export default function Draft() {
  const { ready, me } = useAuth();
  if (!ready) return null;                       // wait for the saved login before calling the API
  if (!me) return <Redirect href="/login" />;
  return <DraftRoom commissioner={me.user.isCommissioner} myTeamId={me.user.teamId} />;
}

function DraftRoom({ commissioner, myTeamId }: { commissioner: boolean; myTeamId: string | null }) {
  const router = useRouter();
  const d = useDraft();
  const { rules } = useTeams();
  const [tab, setTab] = useState<Tab>('board');
  const [browse, setBrowse] = useState<string | null>(null);
  const [award, setAward] = useState<DraftPlayer | null>(null);
  const [focus, setFocus] = useState<string | null>(null);

  const isLive = d.status === 'live';
  const current = isLive ? d.state?.hat ?? null : browse;
  const say = (m: string) => (Platform.OS === 'web' ? globalThis.alert?.(m) : Alert.alert(m));
  const guard = (fn: () => Promise<unknown>) => fn().catch((e) => say(e instanceof Error ? e.message : 'Failed'));

  const select = (abbr: string | null) => {
    if (isLive && commissioner) guard(() => api.setHat(abbr));
    else setBrowse(abbr);
  };

  return (
    <View style={{ flex: 1, backgroundColor: D.bg }}>
      <Nav
        tab={tab} setTab={setTab} seasons={d.seasons} season={d.season} setSeason={(y) => { d.setSeason(y); setBrowse(null); }}
        drafted={d.state?.sales.length ?? 0} total={d.teams.length * rosterSizeOf(rules.roster)} live={d.live} commissioner={commissioner} isLive={isLive}
        onUndo={() => guard(() => api.undo().then(d.refresh))} onBack={() => router.back()}
        pushYear={d.seasons.some((s) => s.status === 'live') || d.seasons.length === 0 ? null : Math.max(...d.seasons.map((s) => s.year)) + 1}
        onPush={() => {
          const y = Math.max(...d.seasons.map((s) => s.year)) + 1;
          const ok = Platform.OS === 'web' ? globalThis.confirm?.(`Push to ${y}? This opens the ${y} season and its keeper window.`) : true;
          if (ok) guard(async () => { await api.pushSeason(); await d.reloadSeasons(); setBrowse(null); setTab('keepers'); });
        }}
      />
      {d.error ? <View style={{ padding: 20 }}><Err m={d.error} /></View> : null}
      <View style={{ flex: 1, flexDirection: 'row' }}>
        <View style={{ flex: 1 }}>
          {tab === 'board' && (
            <Board mlb={d.mlb} players={d.players} teams={d.teams} sale={d.sale} current={current} isLive={isLive}
              commissioner={commissioner} season={d.season} onSelect={select} nomination={d.state?.nomination ?? null}
              onDraft={(p) => { setAward(p); guard(() => api.nominate(p.id)); }} />
          )}
          {tab === 'rosters' && <Rosters teams={d.teams} managers={d.state?.managers ?? []} roster={d.roster} highlight={focus} />}
          {tab === 'undrafted' && <Undrafted players={d.players} sale={d.sale} />}
          {tab === 'keepers' && d.season != null && (
            <Keepers season={d.season} teams={d.teams} managers={d.state?.managers ?? []} version={d.state}
              commissioner={commissioner} myTeamId={myTeamId} onError={say} />
          )}
          {tab === 'log' && <Log sales={d.state?.sales ?? []} teams={d.teams} season={d.season} canEdit={commissioner && !isLive && d.season != null} onChanged={() => { d.refresh(); }} />}
        </View>
        {tab === 'board' && (
          <Money managers={d.state?.managers ?? []} teams={d.teams} onPick={(id) => { setFocus(id); setTab('rosters'); }} />
        )}
      </View>
      {award && d.state && (
        <Award player={award} managers={d.state.managers} teams={d.teams} onClose={() => { setAward(null); guard(() => api.clearNomination()); }}
          onDone={() => { setAward(null); d.refresh(); }} />
      )}
    </View>
  );
}

function Err({ m }: { m: string }) {
  return <Text style={{ color: '#ec3b48' }}>{m}</Text>;
}
