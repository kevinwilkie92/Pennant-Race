import { useMemo, useRef, useState } from 'react';
import { Image, Modal, PanResponder, Pressable, View, useWindowDimensions } from 'react-native';
import { clampOffset, cropRect, zoomAround, type CropInput } from '@pennant/domain';
import type { Picked } from './images';
import { FONT, useTheme } from './theme';
import { Body, Display } from './ui';

/** Drag to position, zoom with − / + or the slider; shows a circle because logos are displayed round. */
export function CropModal({ image, onCancel, onDone }: {
  image: Picked | null; onCancel: () => void; onDone: (rect: { originX: number; originY: number; size: number }) => void;
}) {
  const { t } = useTheme();
  const { width: screenW } = useWindowDimensions();
  const view = Math.min(screenW - 48, 320);
  const [st, setSt] = useState({ zoom: 1, x: 0, y: 0 });
  const cur = useRef(st); cur.current = st;
  const start = useRef({ x: 0, y: 0 });
  const dims = image ? { width: image.width, height: image.height, view } : null;

  // Start centred.
  const centred = useMemo(() => {
    if (!dims) return { zoom: 1, x: 0, y: 0 };
    const c = { ...dims, zoom: 1, x: 0, y: 0 };
    const s = view / Math.min(dims.width, dims.height);
    return { zoom: 1, ...clampOffset({ ...c, x: (view - dims.width * s) / 2, y: (view - dims.height * s) / 2 }) };
  }, [image?.uri, view]);
  const key = image?.uri;
  const seeded = useRef<string | undefined>(undefined);
  if (key && seeded.current !== key) { seeded.current = key; setSt(centred); }

  const pan = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onPanResponderGrant: () => { start.current = { x: cur.current.x, y: cur.current.y }; },
    onPanResponderMove: (_e, g) => {
      if (!dims) return;
      const o = clampOffset({ ...dims, zoom: cur.current.zoom, x: start.current.x + g.dx, y: start.current.y + g.dy });
      setSt((s) => ({ ...s, ...o }));
    },
  }), [image?.uri, view]);

  if (!image || !dims) return null;
  const input = (): CropInput => ({ ...dims, ...cur.current });
  const setZoom = (z: number) => setSt(zoomAround(input(), z));
  const scale = (view / Math.min(dims.width, dims.height)) * st.zoom;
  const sliderPct = ((st.zoom - 1) / 7) * 100;

  return (
    <Modal transparent visible animationType="fade" onRequestClose={onCancel}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <Display style={{ fontSize: 22, marginBottom: 4, color: '#fff' }}>Position your logo</Display>
        <Body style={{ color: 'rgba(255,255,255,0.7)', fontSize: 12, marginBottom: 14 }}>Drag to move · zoom to fit · shown as a circle</Body>

        <View {...pan.panHandlers} style={{ width: view, height: view, overflow: 'hidden', backgroundColor: '#000', borderRadius: 8 }}>
          <Image source={{ uri: image.uri }} resizeMode="stretch"
            style={{ position: 'absolute', left: st.x, top: st.y, width: dims.width * scale, height: dims.height * scale }} />
          <View pointerEvents="none" style={{ position: 'absolute', inset: 0, alignItems: 'center', justifyContent: 'center' }}>
            <View style={{ width: view - 4, height: view - 4, borderRadius: view / 2, borderWidth: 2, borderColor: 'rgba(255,255,255,0.9)' }} />
          </View>
        </View>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 18, width: view }}>
          <Pressable onPress={() => setZoom(st.zoom - 0.5)} hitSlop={10}><Display style={{ fontSize: 28, color: '#fff' }}>−</Display></Pressable>
          <Pressable style={{ flex: 1, height: 28, justifyContent: 'center' }}
            onPress={(e) => { const w = view - 2 * 12 - 56; const x = Math.max(0, Math.min(w, e.nativeEvent.locationX)); setZoom(1 + (x / w) * 7); }}>
            <View style={{ height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.3)' }}>
              <View style={{ width: `${sliderPct}%`, height: 4, borderRadius: 2, backgroundColor: t.red }} />
            </View>
            <View style={{ position: 'absolute', left: `${sliderPct}%`, marginLeft: -9, width: 18, height: 18, borderRadius: 9, backgroundColor: '#fff' }} />
          </Pressable>
          <Pressable onPress={() => setZoom(st.zoom + 0.5)} hitSlop={10}><Display style={{ fontSize: 28, color: '#fff' }}>+</Display></Pressable>
        </View>

        <View style={{ flexDirection: 'row', gap: 12, marginTop: 22 }}>
          <Pressable onPress={onCancel} style={{ paddingHorizontal: 22, paddingVertical: 12, borderRadius: t.radius.button, borderWidth: 1, borderColor: 'rgba(255,255,255,0.4)' }}>
            <Display style={{ fontSize: 15, color: '#fff' }}>CANCEL</Display>
          </Pressable>
          <Pressable onPress={() => onDone(cropRect(input()))} style={{ paddingHorizontal: 26, paddingVertical: 12, borderRadius: t.radius.button, backgroundColor: t.red }}>
            <Display style={{ fontSize: 15, color: '#fff', fontFamily: FONT.display }}>USE THIS</Display>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}
