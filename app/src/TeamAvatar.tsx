import { useEffect, useState } from 'react';
import { Image, View } from 'react-native';
import { logoUrl } from './api';
import { Display } from './ui';

/** A team's logo, or its colour with its id when it has none (or the image can't load). */
export function TeamAvatar({ id, color, logoKey, size = 34 }: { id: string; color: string; logoKey?: string | null; size?: number }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [logoKey]);
  const url = logoUrl(logoKey);
  if (url && !failed) {
    return <Image source={{ uri: url }} onError={() => setFailed(true)} style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color }} />;
  }
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color, alignItems: 'center', justifyContent: 'center' }}>
      <Display style={{ fontSize: size * 0.38, color: '#fff' }}>{id}</Display>
    </View>
  );
}
