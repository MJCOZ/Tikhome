import { Tabs } from 'expo-router/js-tabs';
import { Ionicons } from '@expo/vector-icons';
import { ColorValue, I18nManager } from 'react-native';
import { useAuth } from '../../lib/auth';
import { C } from '../../lib/theme';

type IconName = keyof typeof Ionicons.glyphMap;
const icon = (name: IconName) => ({ color, size }: { color: ColorValue; size: number }) => <Ionicons name={name} size={size} color={color as string} />;

export default function TabsLayout() {
  const { user, unread } = useAuth();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: C.acc,
        tabBarInactiveTintColor: C.mute2,
        tabBarStyle: { backgroundColor: '#0A0F0C', borderTopColor: C.border, flexDirection: I18nManager.isRTL ? 'row' : 'row-reverse' },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
        sceneStyle: { backgroundColor: C.bg },
      }}>
      <Tabs.Screen name="index" options={{ title: 'الرئيسية', tabBarIcon: icon('home-outline') }} />
      <Tabs.Screen name="map" options={{ title: 'الخريطة', tabBarIcon: icon('map-outline') }} />
      <Tabs.Screen name="publish" options={{ title: 'نشر', tabBarIcon: icon('add-circle-outline') }} />
      <Tabs.Screen name="saved" options={{ title: 'المحفوظات', tabBarIcon: icon('bookmark-outline') }} />
      <Tabs.Screen name="me" options={{ title: user ? 'حسابي' : 'دخول', tabBarIcon: icon('person-outline'), tabBarBadge: unread ? unread : undefined }} />
    </Tabs>
  );
}
