import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider } from '../lib/auth';
import { FiltersProvider } from '../lib/filters';
import { C } from '../lib/theme';

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <FiltersProvider>
          <StatusBar style="light" />
          <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: C.bg } }}>
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="listing/[id]" />
            <Stack.Screen name="login" options={{ presentation: 'modal' }} />
          </Stack>
        </FiltersProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
