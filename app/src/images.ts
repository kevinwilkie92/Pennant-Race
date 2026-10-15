import * as ImagePicker from 'expo-image-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

export type Picked = { uri: string; width: number; height: number };

/** Opens the photo library (no built-in cropper: we use our own so web and phones behave the same). */
export async function pickImage(): Promise<Picked | null> {
  const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: false, quality: 1 });
  if (r.canceled) return null;
  const a = r.assets[0];
  return { uri: a.uri, width: a.width, height: a.height };
}

/** Crops a square out of the picture and shrinks it to `px` square. PNG keeps transparency. */
export async function cropToSquare(img: Picked, rect: { originX: number; originY: number; size: number }, px: number): Promise<Blob> {
  const ctx = ImageManipulator.manipulate(img.uri)
    .crop({ originX: rect.originX, originY: rect.originY, width: rect.size, height: rect.size })
    .resize({ width: px, height: px });
  const out = await (await ctx.renderAsync()).saveAsync({ format: SaveFormat.PNG });
  return (await fetch(out.uri)).blob();
}

/** Shrinks a photo so its longer side is at most `maxSide` (never enlarges), as a JPEG for chat. */
export async function shrinkForChat(img: Picked, maxSide = 1280): Promise<{ blob: Blob; uri: string }> {
  const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
  const ctx = ImageManipulator.manipulate(img.uri);
  if (scale < 1) ctx.resize(img.width >= img.height ? { width: Math.round(img.width * scale) } : { height: Math.round(img.height * scale) });
  const out = await (await ctx.renderAsync()).saveAsync({ format: SaveFormat.JPEG, compress: 0.85 });
  return { blob: await (await fetch(out.uri)).blob(), uri: out.uri };
}
