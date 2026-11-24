import { Text, View } from 'react-native';
import { floorLabel } from '../lib/format';
import { C } from '../lib/theme';

// رسم بسيط للمبنى يبيّن دور الشقة
export function BuildingView({ floor }: { floor: number | null }) {
  const top = Math.max(3, floor == null ? 3 : floor);
  const floors = Array.from({ length: top + 1 }, (_, i) => top - i);
  return (
    <View accessibilityLabel={floor == null ? 'الدور غير محدد' : floorLabel(floor)} style={{ width: 74, gap: 3, alignItems: 'center' }}>
      {floors.map((n) => (
        <View key={n} style={{ width: '100%', height: 20, borderRadius: 4, alignItems: 'center', justifyContent: 'center', backgroundColor: n === floor ? C.acc : C.panel2 }}>
          <Text style={{ fontSize: 10, fontWeight: '700', color: n === floor ? C.accInk : C.mute2 }}>{floorLabel(n).replace('الدور ', '')}</Text>
        </View>
      ))}
      <View style={{ width: '110%', height: 3, backgroundColor: C.mute2, borderRadius: 2 }} />
    </View>
  );
}
