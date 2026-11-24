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

export type PickedFile = { uri: string; mime: string; size: number };

// الرفع: (1) رابط موقّع من الخادم (2) رفع الملف مباشرة للتخزين (3) تأكيد الملفات
export async function uploadMedia(listingId: number, files: PickedFile[], onProgress?: (done: number, total: number) => void) {
  const { uploads } = await api<{ uploads: { path: string; upload_url: string; method: string; headers: Record<string, string> }[] }>(
    `/api/listings/${listingId}/uploads`, { method: 'POST', body: { files: files.map((f) => ({ mime: f.mime, size: f.size })) } });
  for (let i = 0; i < uploads.length; i++) {
    onProgress?.(i, uploads.length);
    const u = uploads[i];
    const blob = await (await fetch(files[i].uri)).blob();
    const url = /^https?:/.test(u.upload_url) ? u.upload_url : API_URL + u.upload_url;
    let r: Response;
    try { r = await fetch(url, { method: u.method || 'PUT', headers: u.headers, body: blob }); } catch { throw new ApiError('انقطع الاتصال أثناء رفع الملف', 0); }
    if (!r.ok) throw new ApiError('تعذّر رفع الملف (' + r.status + ')', r.status);
  }
  onProgress?.(uploads.length, uploads.length);
  return api<{ media: Media[]; status: string }>(`/api/listings/${listingId}/media`, { method: 'POST', body: { paths: uploads.map((u) => u.path) } });
}

export type Media = { id: number; url: string; mime: string };
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
