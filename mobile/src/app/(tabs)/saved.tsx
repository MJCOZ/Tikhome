import { useCallback, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { Image } from 'expo-image';
import { router, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api, Listing, mediaUrl } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { entranceLabel, floorLabel, fmtPrice, kindLabel } from '../../lib/format';
import { C, row } from '../../lib/theme';
import { Btn, Card, Empty, T, toast, s } from '../../components/ui';

type Search = { id: number; query: string };
const searchLabel = (j: string) => {
  try {
    const o = JSON.parse(j);
    return [o.kind && kindLabel(o.kind), o.city, o.district, o.min && 'من ' + o.min, o.max && 'إلى ' + o.max, o.beds && o.beds + '+ غرف'].filter(Boolean).join(' · ');
  } catch { return ''; }
};

export default function Saved() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const [listings, setListings] = useState<Listing[]>([]);
  const [searches, setSearches] = useState<Search[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!user) return;
    try {
      const [a, b] = await Promise.all([api<{ listings: Listing[] }>('/api/saves'), api<{ searches: Search[] }>('/api/searches')]);
      setListings(a.listings); setSearches(b.searches);
    } catch (e: any) { toast(e.message); }
    setRefreshing(false);
  }, [user]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (!user) return <Empty title="المحفوظات" text="سجّل الدخول لتحفظ العقارات وتصلك تنبيهات البحث."><Btn title="تسجيل الدخول" onPress={() => router.push('/login')} /></Empty>;

  return (
    <ScrollView style={{ flex: 1, backgroundColor: C.bg }} contentContainerStyle={{ padding: 16, paddingTop: insets.top + 16, gap: 12 }}
      refreshControl={<RefreshControl refreshing={refreshing} tintColor={C.acc} onRefresh={() => { setRefreshing(true); load(); }} />}>
      <T style={s.h1}>المحفوظات</T>
      {listings.length ? listings.map((l) => {
        const thumb = l.media_type === 'photos' ? l.media[0]?.url : l.media[0]?.poster;
        return (
          <Pressable key={l.id} onPress={() => router.push(`/listing/${l.id}`)}>
            <Card style={{ ...row, alignItems: 'center' }}>
              {thumb ? <Image source={{ uri: mediaUrl(thumb) }} style={{ width: 64, height: 84, borderRadius: 10 }} contentFit="cover" />
                : <View style={{ width: 64, height: 84, borderRadius: 10, backgroundColor: C.panel2 }} />}
              <View style={{ flex: 1, gap: 3 }}>
                <T style={{ fontWeight: '700' }} numberOfLines={1}>{`${l.title} · ${l.district}`}</T>
                <T style={s.muted}>{[floorLabel(l.floor), entranceLabel(l.entrance)].filter(Boolean).join(' · ')}</T>
                <T style={{ color: C.gold, fontWeight: '800' }}>{fmtPrice(l)}</T>
              </View>
            </Card>
          </Pressable>
        );
      }) : <Card><T style={s.muted}>لم تحفظ عقاراً بعد. اضغط على القلب في أي إعلان ليظهر هنا.</T></Card>}

      <T style={s.h2}>عمليات البحث المحفوظة</T>
      {searches.length ? searches.map((x) => (
        <Card key={x.id} style={{ ...row, alignItems: 'center', justifyContent: 'space-between' }}>
          <T style={[s.muted, { flex: 1 }]}>{searchLabel(x.query)}</T>
          <Btn small kind="danger" title="حذف" onPress={async () => { try { await api('/api/searches/' + x.id, { method: 'DELETE' }); load(); } catch (e: any) { toast(e.message); } }} />
        </Card>
      )) : <T style={s.muted}>احفظ بحثاً من زر التصفية وسيصلك تنبيه عند نشر عقار مطابق.</T>}
    </ScrollView>
  );
}
