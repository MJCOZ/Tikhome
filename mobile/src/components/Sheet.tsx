import { ReactNode } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { C } from '../lib/theme';
import { T } from './ui';

// نافذة سفلية بسيطة (بديل .sheet في نسخة الويب)
export function Sheet({ visible, onClose, title, children }: { visible: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <Pressable style={st.scrim} onPress={onClose} accessibilityLabel="إغلاق" />
        <View style={[st.sheet, { paddingBottom: insets.bottom + 16 }]}>
          <View style={st.grab} />
          <T style={{ fontSize: 18, fontWeight: '700' }}>{title}</T>
          <ScrollView contentContainerStyle={{ gap: 14, paddingTop: 12 }} keyboardShouldPersistTaps="handled">{children}</ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const st = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: '#000a' },
  sheet: { backgroundColor: C.panel, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 18, maxHeight: '85%' },
  grab: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: C.panel2, marginBottom: 12 },
});
