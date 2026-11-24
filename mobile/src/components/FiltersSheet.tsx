import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Filters, useFilters } from '../lib/filters';
import { floorLabel } from '../lib/format';
import { row } from '../lib/theme';
import { Sheet } from './Sheet';
import { Btn, Field, Input, Pills, toast } from './ui';

export function FiltersSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { filters, setFilters } = useFilters();
  const { user } = useAuth();
  const [f, setF] = useState<Filters>(filters);
  useEffect(() => { if (visible) setF(filters); }, [visible, filters]);
  const set = (k: keyof Filters) => (v: string | number) => setF((o) => ({ ...o, [k]: v === '' ? undefined : String(v) }));

  const saveSearch = async () => {
    if (!user) { onClose(); toast('سجّل الدخول لحفظ البحث'); return router.push('/login'); }
    try { await api('/api/searches', { method: 'POST', body: f }); toast('حُفظ البحث وسيصلك تنبيه بالعقارات المطابقة'); onClose(); } catch (e: any) { toast(e.message); }
  };

  return (
    <Sheet visible={visible} onClose={onClose} title="تصفية العقارات">
      <Field label="نوع العرض"><Pills allowClear value={f.kind} options={[['rent', 'إيجار'], ['sale', 'بيع']]} onChange={set('kind')} /></Field>
      <Field label="المدينة"><Input value={f.city || ''} onChangeText={set('city')} placeholder="مثال: الرياض" /></Field>
      <Field label="الحي"><Input value={f.district || ''} onChangeText={set('district')} placeholder="اسم الحي" /></Field>
      <View style={[row, { gap: 10 }]}>
        <View style={{ flex: 1 }}><Field label="السعر من"><Input keyboardType="number-pad" value={f.min || ''} onChangeText={set('min')} placeholder="ر.س" /></Field></View>
        <View style={{ flex: 1 }}><Field label="السعر إلى"><Input keyboardType="number-pad" value={f.max || ''} onChangeText={set('max')} placeholder="ر.س" /></Field></View>
      </View>
      <Field label="عدد الغرف (على الأقل)"><Pills allowClear value={f.beds} options={['1', '2', '3', '4', '5'].map((n) => [n, n + '+'] as [string, string])} onChange={set('beds')} /></Field>
      <Field label="الدور"><Pills allowClear value={f.floor} options={['0', '1', '2', '3'].map((n) => [n, floorLabel(Number(n))] as [string, string])} onChange={set('floor')} /></Field>
      <Field label="المدخل"><Pills allowClear value={f.entrance} options={[['private', 'مدخل خاص'], ['shared', 'مدخل مشترك']]} onChange={set('entrance')} /></Field>
      <Field label="نوع المحتوى"><Pills allowClear value={f.media} options={[['video', 'فيديو'], ['photos', 'صور']]} onChange={set('media')} /></Field>
      <View style={[row, { gap: 10 }]}>
        <Btn title="عرض النتائج" style={{ flex: 1 }} onPress={() => { setFilters(Object.fromEntries(Object.entries(f).filter(([, v]) => v))); onClose(); }} />
        <Btn title="مسح" kind="sec" onPress={() => { setFilters({}); onClose(); }} />
      </View>
      <Btn title="احفظ هذا البحث وأبلغني بالجديد" kind="ghost" onPress={saveSearch} />
    </Sheet>
  );
}
