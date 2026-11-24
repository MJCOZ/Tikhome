import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api, Listing } from '../../lib/api';
import { C } from '../../lib/theme';
import { ListingItem } from '../../components/ListingItem';
import { Btn, Empty } from '../../components/ui';

// عرض إعلان واحد (من الخريطة أو المحفوظات أو رابط مشاركة)
export default function ListingScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const [l, setL] = useState<Listing | null>(null);
  const [err, setErr] = useState('');
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => { api<{ listing: Listing }>('/api/listings/' + id).then((d) => setL(d.listing)).catch((e) => setErr(e.message)); }, [id]);

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }} onLayout={(e) => setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
      {err ? <Empty title="هذا الإعلان لم يعد متاحاً" text={err}><Btn title="رجوع" onPress={() => router.back()} /></Empty>
        : !l || !size.h ? <ActivityIndicator style={{ flex: 1 }} color={C.acc} />
          : <ListingItem l={l} width={size.w} height={size.h} active onChange={setL} />}
      <Pressable onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} accessibilityLabel="رجوع"
        style={{ position: 'absolute', top: insets.top + 8, right: 12, width: 42, height: 42, borderRadius: 21, backgroundColor: '#0E1411CC', alignItems: 'center', justifyContent: 'center' }}>
        <Ionicons name="arrow-forward" size={22} color="#fff" />
      </Pressable>
    </View>
  );
}
