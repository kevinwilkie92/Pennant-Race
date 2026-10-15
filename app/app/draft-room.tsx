import { useState } from 'react';
import { Redirect, useRouter } from 'expo-router';
import { useAuth } from '../src/auth';
import { Phone } from '../src/draft/Phone';
import { useDraft } from '../src/draft/useDraft';

// Phone companion: managers follow the live draft (read-only). The commissioner runs it from /draft.
export default function DraftRoomPhone() {
  const { ready, me } = useAuth();
  if (!ready) return null;
  if (!me) return <Redirect href="/login" />;
  return <Companion myTeamId={me.user.teamId} />;
}

function Companion({ myTeamId }: { myTeamId: string | null }) {
  const router = useRouter();
  const d = useDraft();
  const [browse, setBrowse] = useState<string | null>(null);
  const isLive = d.status === 'live';
  return (
    <Phone
      title={d.season ? String(d.season) : ''} isLive={isLive} connected={d.live}
      mlb={d.mlb} players={d.players} teams={d.teams} managers={d.state?.managers ?? []} sales={d.state?.sales ?? []}
      sale={d.sale} roster={d.roster} byPlayer={d.byPlayer}
      current={isLive ? d.state?.hat ?? null : browse} onBrowse={setBrowse}
      nomination={d.state?.nomination ?? null}
      myTeamId={myTeamId} onBack={() => (router.canGoBack() ? router.back() : router.replace('/team'))}
    />
  );
}
