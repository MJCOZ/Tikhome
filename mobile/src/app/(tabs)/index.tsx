import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useIsFocused } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api, Listing } from '../../lib/api';
import { filterCount, toQuery, useFilters } from '../../lib/filters';
import { C, row } from '../../lib/theme';
import { ListingItem } from '../../components/ListingItem';
import { FiltersSheet } from '../../components/FiltersSheet';
import { Btn, Empty } from '../../components/ui';

const PAGE = 8;

// الخلاصة: فيديو وصور بملء الشاشة مع تمرير عمودي
export default function Feed() {
  const insets = useSafeAreaInsets();
  const focused = useIsFocused();
  const { filters, setFilters } = useFilters();
  const [items, setItems] = useState<Listing[]>([]);
  const [active, setActive] = useState(0);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const state = useRef({ offset: 0, done: false, busy: false });

  const load = useCallback(async (reset: boolean) => {
    const s = state.current;
    if (s.busy || (!reset && s.done)) return;
    s.busy = true;
    if (reset) { s.offset = 0; s.done = false; }
    try {
      const d = await api<{ listings: Listing[] }>('/api/listings?' + toQuery(filters, { limit: PAGE, offset: s.offset }));
      s.offset += d.listings.length;
      if (d.listings.length < PAGE) s.done = true;
      setItems((old) => {
        const base = reset ? [] : old;
        const seen = new Set(base.map((x) => x.id));
        return [...base, ...d.listings.filter((x) => !seen.has(x.id))];
      });
      if (reset) setActive(0);
      setError('');
    } catch (e: any) { setError(e.message); s.done = true; }
    s.busy = false; setLoading(false); setRefreshing(false);
  }, [filters]);

  useEffect(() => { setLoading(true); load(true); }, [load]);

  const onViewable = useRef(({ viewableItems }: { viewableItems: { index?: number | null; isViewable: boolean }[] }) => {
    const v = viewableItems.find((x) => x.isViewable);
    if (v?.index != null) setActive(v.index);
  }).current;

  const n = filterCount(filters);
  const chip = (k: '' | 'rent' | 'sale', label: string) => {
    const on = (filters.kind || '') === k;
    return (
      <Pressable key={k} onPress={() => setFilters({ ...filters, kind: k || undefined })} style={[st.chip, on && { backgroundColor: C.acc }]}>
        <Text style={[st.chipText, on && { color: C.accInk }]}>{label}</Text>
      </Pressable>
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }} onLayout={(e) => setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
      {loading && !items.length ? <ActivityIndicator style={{ flex: 1 }} color={C.acc} size="large" />
        : !items.length ? (
          <Empty title={error ? 'تعذّر التحميل' : 'لا توجد عقارات مطابقة'} text={error || 'جرّب تغيير الفلاتر أو العودة لاحقاً.'}>
            {error ? <Btn title="إعادة المحاولة" onPress={() => { setLoading(true); load(true); }} /> : null}
            {n ? <Btn title="مسح الفلاتر" kind="sec" onPress={() => setFilters({})} /> : null}
          </Empty>
        ) : size.h > 0 ? (
          <FlatList
            data={items}
            keyExtractor={(x) => String(x.id)}
            pagingEnabled
            showsVerticalScrollIndicator={false}
            decelerationRate="fast"
            getItemLayout={(_, i) => ({ length: size.h, offset: size.h * i, index: i })}
            onViewableItemsChanged={onViewable}
            viewabilityConfig={{ itemVisiblePercentThreshold: 70 }}
            onEndReached={() => load(false)}
            onEndReachedThreshold={2}
            windowSize={3}
            initialNumToRender={2}
            maxToRenderPerBatch={2}
            refreshControl={<RefreshControl refreshing={refreshing} tintColor="#fff" onRefresh={() => { setRefreshing(true); load(true); }} />}
            renderItem={({ item, index }) => (
              <ListingItem l={item} width={size.w} height={size.h} active={focused && index === active}
                mountMedia={Math.abs(index - active) <= 1}
                onChange={(nl) => setItems((arr) => arr.map((x) => (x.id === nl.id ? nl : x)))} />
            )}
          />
        ) : null}

      <View style={[st.topbar, row, { top: insets.top + 8 }]} pointerEvents="box-none">
        {chip('', 'الكل')}{chip('rent', 'إيجار')}{chip('sale', 'بيع')}
        <View style={{ flex: 1 }} />
        <Pressable onPress={() => setShowFilters(true)} style={[st.chip, row, { gap: 6 }, n > (filters.kind ? 1 : 0) && { backgroundColor: C.acc }]} accessibilityLabel="تصفية">
          <Ionicons name="options-outline" size={18} color={n > (filters.kind ? 1 : 0) ? C.accInk : C.ink} />
          {n ? <Text style={[st.chipText, { color: n > (filters.kind ? 1 : 0) ? C.accInk : C.ink }]}>{n}</Text> : null}
        </Pressable>
      </View>
      <FiltersSheet visible={showFilters} onClose={() => setShowFilters(false)} />
    </View>
  );
}

const st = StyleSheet.create({
  topbar: { position: 'absolute', left: 12, right: 12, gap: 8, alignItems: 'center' },
  chip: { backgroundColor: '#0E1411CC', paddingHorizontal: 16, paddingVertical: 9, borderRadius: 20, alignItems: 'center' },
  chipText: { color: C.ink, fontWeight: '700', fontSize: 14 },
});
