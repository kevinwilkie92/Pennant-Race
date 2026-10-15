import type { ReactNode } from 'react';
import { Redirect } from 'expo-router';
import { useAuth } from './auth';

/** Deep links load before the saved login is restored; wait for it so API calls don't go out unauthenticated. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { ready, me } = useAuth();
  if (!ready) return null;
  if (!me) return <Redirect href="/login" />;
  return <>{children}</>;
}
