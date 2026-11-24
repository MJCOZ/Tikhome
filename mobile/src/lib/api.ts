import * as SecureStore from 'expo-secure-store';

// رابط الخادم على Vercel، يُضبط في ملف .env (EXPO_PUBLIC_API_URL)
export const API_URL = (process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3000').replace(/\/+$/, '');
const TOKEN_KEY = 'tikhome_token';

let token: string | null = null;
export async function loadToken() {
  try { token = await SecureStore.getItemAsync(TOKEN_KEY); } catch { token = null; }
  return token;
}
export async function setToken(t: string | null) {
  token = t;
  try {
    if (t) await SecureStore.setItemAsync(TOKEN_KEY, t);
    else await SecureStore.deleteItemAsync(TOKEN_KEY);
  } catch { /* */ }
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) { super(message); this.status = status; }
}

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const headers: Record<string, string> = { 'X-Requested-With': 'fetch', 'X-Client': 'mobile' };
  if (token) headers.Authorization = 'Bearer ' + token;
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  let res: Response;
  try {
    res = await fetch(API_URL + path, { method: opts.method || 'GET', headers, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined });
  } catch {
    throw new ApiError('تعذّر الاتصال بالخادم. تحقق من الإنترنت.', 0);
  }
  let data: any = {};
  try { data = await res.json(); } catch { /* */ }
  if (!res.ok) throw new ApiError(data.error || 'حدث خطأ', res.status);
  return data as T;
}

// روابط الوسائط قد تكون نسبية في التطوير المحلي
export const mediaUrl = (u: string) => (/^https?:/.test(u) ? u : API_URL + u);

export type PickedFile = { uri: string; mime: string; size: number; poster?: PickedFile };

// الرفع: (1) رابط موقّع من الخادم (2) رفع الملف مباشرة للتخزين (3) تأكيد الملفات
export async function uploadMedia(listingId: number, files: PickedFile[], onProgress?: (done: number, total: number) => void) {
  type Signed = { path: string; upload_url: string; method: string; headers: Record<string, string> };
  const poster = files.length === 1 ? files[0].poster : undefined;
  const req = files.map((f) => ({ mime: f.mime, size: f.size }));
  const { uploads, poster: posterUp } = await api<{ uploads: Signed[]; poster: Signed | null }>(
    `/api/listings/${listingId}/uploads`, { method: 'POST', body: { files: poster ? [...req, { mime: poster.mime, size: poster.size, role: 'poster' }] : req } });
  const put = async (u: Signed, uri: string) => {
    const blob = await (await fetch(uri)).blob();
    const url = /^https?:/.test(u.upload_url) ? u.upload_url : API_URL + u.upload_url;
    let r: Response;
    try { r = await fetch(url, { method: u.method || 'PUT', headers: u.headers, body: blob }); } catch { throw new ApiError('انقطع الاتصال أثناء رفع الملف', 0); }
    if (!r.ok) throw new ApiError('تعذّر رفع الملف (' + r.status + ')', r.status);
  };
  for (let i = 0; i < uploads.length; i++) {
    onProgress?.(i, uploads.length);
    await put(uploads[i], files[i].uri);
  }
  // الصورة المصغّرة اختيارية: فشلها لا يوقف نشر الإعلان
  let posterPath: string | undefined;
  if (posterUp && poster) { try { await put(posterUp, poster.uri); posterPath = posterUp.path; } catch { /* */ } }
  onProgress?.(uploads.length, uploads.length);
  return api<{ media: Media[]; status: string }>(`/api/listings/${listingId}/media`, { method: 'POST', body: { paths: uploads.map((u) => u.path), poster: posterPath } });
}

export type Media = { id: number; url: string; mime: string; poster?: string | null };
export type Listing = {
  id: number; kind: 'rent' | 'sale'; property_type: string; title: string; city: string; district: string;
  price: number; area: number | null; beds: number | null; baths: number | null; floor: number | null; entrance: string | null;
  description: string | null; lat: number | null; lng: number | null; media_type: 'video' | 'photos';
  license_no: string; license_expires: string; status: string; featured: boolean; media: Media[];
  owner_name: string; owner_verified: boolean; saved: boolean;
  reject_reason?: string | null; views?: number; contacts?: number;
};
export type User = { id: number; name: string; phone: string; role: 'user' | 'admin'; verified: boolean; verify_requested: boolean };
export type Plan = { id: number; name: string; max_listings: number };
