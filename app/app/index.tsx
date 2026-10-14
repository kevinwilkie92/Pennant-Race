import { Redirect } from 'expo-router';
import { useAuth } from '../src/auth';

export default function Index() {
  const { ready, me } = useAuth();
  if (!ready) return null;
  return <Redirect href={me ? '/team' : '/login'} />;
}
