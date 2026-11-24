import * as ImagePicker from 'expo-image-picker';
import type { PickedFile } from './api';

const ALLOWED = ['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/webm', 'video/quicktime'];
const BY_EXT: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', mp4: 'video/mp4', m4v: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime' };

function toFile(a: ImagePicker.ImagePickerAsset): PickedFile {
  const ext = (a.uri.split('?')[0].split('.').pop() || '').toLowerCase();
  let mime = (a.mimeType || BY_EXT[ext] || '').toLowerCase();
  if (mime === 'image/jpg') mime = 'image/jpeg';
  return { uri: a.uri, mime, size: a.fileSize || 0 };
}

export type PickResult = { files: PickedFile[]; error?: string };

// اختيار فيديو واحد أو عدة صور، مع التحقق من النوع والحجم قبل الرفع
export async function pickMedia(kind: 'video' | 'photos', { limit = 12, maxVideoMb = 50, maxPhotoMb = 8, camera = false } = {}): Promise<PickResult> {
  const perm = camera ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) return { files: [], error: camera ? 'نحتاج إذن الكاميرا لتصوير العقار' : 'نحتاج إذن الوصول للصور لاختيار ملفات العقار' };
  const opts: ImagePicker.ImagePickerOptions = kind === 'video'
    ? { mediaTypes: ['videos'], videoMaxDuration: 90, allowsEditing: false }
    : { mediaTypes: ['images'], allowsMultipleSelection: !camera, selectionLimit: limit, quality: 0.8 };
  const r = camera ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
  if (r.canceled) return { files: [] };
  const files: PickedFile[] = []; let error: string | undefined;
  for (const a of r.assets.slice(0, kind === 'video' ? 1 : limit)) {
    const f = toFile(a);
    const mb = f.size / 1048576;
    if (!ALLOWED.includes(f.mime)) { error = 'نوع الملف غير مدعوم (' + (f.mime || 'غير معروف') + ')'; continue; }
    if (kind === 'video' && mb > maxVideoMb) { error = `الفيديو أكبر من ${maxVideoMb} ميغابايت. صوّر مقطعاً أقصر.`; continue; }
    if (kind === 'photos' && mb > maxPhotoMb) { error = `إحدى الصور أكبر من ${maxPhotoMb} ميغابايت`; continue; }
    files.push(f);
  }
  return { files, error };
}
