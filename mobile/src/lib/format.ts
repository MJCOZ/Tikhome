import type { Listing } from './api';

const num = (n: number) => Number(n).toLocaleString('en-US');
export const fmtPrice = (l: Pick<Listing, 'price' | 'kind'>) => num(l.price) + ' ر.س' + (l.kind === 'rent' ? ' / سنة' : '');
export const shortPrice = (p: number) => (p >= 1e6 ? (p / 1e6).toFixed(1) + ' م' : p >= 1000 ? Math.round(p / 1000) + ' ألف' : String(p));
export const floorLabel = (n: number | null | undefined) =>
  n == null ? '' : n === 0 ? 'الدور الأرضي' : ['', 'الدور الأول', 'الدور الثاني', 'الدور الثالث', 'الدور الرابع', 'الدور الخامس'][n] || 'الدور ' + n;
export const entranceLabel = (e: string | null | undefined) => (e === 'private' ? 'مدخل خاص' : e === 'shared' ? 'مدخل مشترك' : '');
export const kindLabel = (k: string) => (k === 'rent' ? 'إيجار' : 'بيع');
export const statusLabel = (s: string) =>
  ({ draft: 'مسودة', pending: 'قيد المراجعة', published: 'منشور', rejected: 'مرفوض', paused: 'موقوف مؤقتاً', suspended: 'أوقفته الإدارة', expired: 'الترخيص منتهٍ' } as Record<string, string>)[s] || s;
export const statusColor = (s: string) => (s === 'published' ? '#1FB58F' : s === 'pending' ? '#F2C46D' : ['rejected', 'expired', 'suspended'].includes(s) ? '#E5534B' : '#8FA39A');
export const toLatin = (s: string) => s.replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)));
