import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import MapView, { Marker, Region } from 'react-native-maps';
import * as Location from 'expo-location';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api, Listing } from '../../lib/api';
import { toQuery, useFilters } from '../../lib/filters';
import { entranceLabel, floorLabel, fmtPrice, shortPrice } from '../../lib/format';
import { C, row } from '../../lib/theme';
import { BuildingView } from '../../components/BuildingView';
import { FiltersSheet } from '../../components/FiltersSheet';
import { Btn, T, toast } from '../../components/ui';

const RIYADH: Region = { latitude: 24.7136, longitude: 46.6753, latitudeDelta: 0.25, longitudeDelta: 0.25 };

export default function MapScreen() {
  const insets = useSafeAreaInsets();
  const { filters, mapFocus, setMapFocus } = useFilters();
  const mapRef = useRef<MapView>(null);
  const region = useRef<Region>(RIYADH);
  const [data, setData] = useState<Listing[]>([]);
  const [selected, setSelected] = useState<Listing | null>(null);
  const [showFilters, setShowFilters] = useState(false);

  const load = useCallback(async () => {
    const r = region.current;
    const bbox = [r.latitude - r.latitudeDelta / 2, r.longitude - r.longitudeDelta / 2, r.latitude + r.latitudeDelta / 2, r.longitude + r.longitudeDelta / 2].join(',');
    try {
      const d = await api<{ listings: Listing[] }>('/api/listings?' + toQuery(filters, { bbox, limit: 50 }));
      setData(d.listings);
    } catch (e: any) { toast(e.message); }
  }, [filters]);

  useEffect(() => { load(); }, [load]);

  // قادم من زر "عرض على الخريطة" في الخلاصة
  useEffect(() => {
    if (!mapFocus) return;
    setSelected(mapFocus);
    if (mapFocus.lat != null && mapFocus.lng != null) {
      mapRef.current?.animateToRegion({ latitude: mapFocus.lat, longitude: mapFocus.lng, latitudeDelta: 0.02, longitudeDelta: 0.02 }, 500);
    } else toast('لم يحدد المعلن موقع هذا العقار على الخريطة');
    setMapFocus(null);
  }, [mapFocus, setMapFocus]);

  const locate = async () => {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') return toast('لم نحصل على إذن الموقع');
    const p = await Location.getCurrentPositionAsync({});
    mapRef.current?.animateToRegion({ latitude: p.coords.latitude, longitude: p.coords.longitude, latitudeDelta: 0.05, longitudeDelta: 0.05 }, 500);
  };

  return (
    <View style={{ flex: 1 }}>
      <MapView ref={mapRef} style={StyleSheet.absoluteFill} initialRegion={RIYADH} showsUserLocation userInterfaceStyle="dark"
        onRegionChangeComplete={(r) => { region.current = r; load(); }} onPress={() => setSelected(null)}>
        {data.filter((l) => l.lat != null && l.lng != null).map((l) => (
          <Marker key={l.id} coordinate={{ latitude: l.lat!, longitude: l.lng! }} onPress={(e) => { e.stopPropagation(); setSelected(l); }}
            tracksViewChanges={false} accessibilityLabel={`${l.title} ${l.district}`}>
            <View style={[st.pin, selected?.id === l.id && { backgroundColor: C.acc }]}>
              <Text style={[st.pinText, selected?.id === l.id && { color: C.accInk }]}>{shortPrice(l.price)}</Text>
            </View>
          </Marker>
        ))}
      </MapView>

      <View style={[st.top, row, { top: insets.top + 8 }]}>
        <Pressable style={st.chip} onPress={() => setShowFilters(true)}><Text style={st.chipText}>تصفية</Text></Pressable>
        <Pressable style={st.chip} onPress={locate}><Text style={st.chipText}>موقعي</Text></Pressable>
      </View>

      {selected ? (
        <View style={[st.card, row]}>
          <BuildingView floor={selected.floor} />
          <View style={{ flex: 1, gap: 4 }}>
            <T style={{ color: C.accSoft, fontWeight: '600', fontSize: 13 }}>موقع الشقة في المبنى</T>
            <T style={{ fontWeight: '700', fontSize: 16 }} numberOfLines={2}>{`${selected.title} · ${selected.district}`}</T>
            <T style={{ color: C.mute2, fontSize: 13 }}>{[floorLabel(selected.floor), entranceLabel(selected.entrance)].filter(Boolean).join(' · ')}</T>
            <T style={{ color: C.gold, fontWeight: '800', fontSize: 18 }}>{fmtPrice(selected)}</T>
            <Btn small title="شاهد العقار" onPress={() => router.push(`/listing/${selected.id}`)} />
          </View>
        </View>
      ) : null}
      <FiltersSheet visible={showFilters} onClose={() => setShowFilters(false)} />
    </View>
  );
}

const st = StyleSheet.create({
  top: { position: 'absolute', left: 12, right: 12, gap: 8 },
  chip: { backgroundColor: '#0E1411E6', paddingHorizontal: 16, paddingVertical: 10, borderRadius: 20 },
  chipText: { color: C.ink, fontWeight: '700' },
  pin: { backgroundColor: C.panel, borderColor: C.acc, borderWidth: 1.5, paddingHorizontal: 9, paddingVertical: 4, borderRadius: 12 },
  pinText: { color: C.ink, fontWeight: '800', fontSize: 12 },
  card: { position: 'absolute', left: 12, right: 12, bottom: 12, backgroundColor: C.panel, borderRadius: 18, padding: 14, gap: 14, alignItems: 'center' },
});
