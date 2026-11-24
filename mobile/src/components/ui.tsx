import { ReactNode } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, TextInput, TextInputProps, View, ViewStyle } from 'react-native';
import { C, row, rtlText } from '../lib/theme';

export const toast = (msg: string, title = '') => Alert.alert(title, msg);

export function T({ children, style, ...p }: { children: ReactNode; style?: any; numberOfLines?: number }) {
  return <Text style={[s.t, rtlText, style]} {...p}>{children}</Text>;
}

type BtnKind = 'primary' | 'sec' | 'ghost' | 'danger';
export function Btn({ title, onPress, kind = 'primary', small, disabled, loading, style, icon }: {
  title: string; onPress?: () => void; kind?: BtnKind; small?: boolean; disabled?: boolean; loading?: boolean; style?: ViewStyle; icon?: ReactNode;
}) {
  const bg = kind === 'primary' ? C.acc : kind === 'sec' ? C.panel2 : kind === 'danger' ? '#E5534B26' : 'transparent';
  const fg = kind === 'primary' ? C.accInk : kind === 'danger' ? '#ffb4ae' : kind === 'ghost' ? C.accSoft : C.ink;
  return (
    <Pressable accessibilityRole="button" onPress={onPress} disabled={disabled || loading}
      style={({ pressed }) => [s.btn, row, small && s.btnSm, { backgroundColor: bg, opacity: disabled ? 0.5 : pressed ? 0.8 : 1 }, style]}>
      {loading ? <ActivityIndicator color={fg} /> : <>{icon}<Text style={[s.btnText, small && { fontSize: 13 }, { color: fg }]}>{title}</Text></>}
    </Pressable>
  );
}

export function Pills<V extends string | number>({ value, options, onChange, allowClear }: {
  value: V | '' | null | undefined; options: [V, string][]; onChange: (v: V | '') => void; allowClear?: boolean;
}) {
  return (
    <View style={[row, s.pills]}>
      {options.map(([v, label]) => {
        const on = value === v;
        return (
          <Pressable key={String(v)} onPress={() => onChange(on && allowClear ? '' : v)} accessibilityState={{ selected: on }}
            style={[s.pill, on && { backgroundColor: C.acc, borderColor: C.acc }]}>
            <Text style={[s.pillText, on && { color: C.accInk }]}>{label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return <View style={{ gap: 6 }}><T style={s.label}>{label}</T>{children}</View>;
}

export function Input(p: TextInputProps) {
  return <TextInput placeholderTextColor={C.mute2} {...p} style={[s.input, rtlText, p.multiline && { minHeight: 80, textAlignVertical: 'top' }, p.style]} />;
}

export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return <View style={[s.card, style]}>{children}</View>;
}

export function Empty({ title, text, children }: { title: string; text?: string; children?: ReactNode }) {
  return (
    <View style={s.empty}>
      <Text style={[s.t, { fontSize: 19, fontWeight: '700', textAlign: 'center' }]}>{title}</Text>
      {text ? <Text style={[s.t, { color: C.mute, textAlign: 'center' }]}>{text}</Text> : null}
      {children}
    </View>
  );
}

export const s = StyleSheet.create({
  t: { color: C.ink, fontSize: 15 },
  label: { color: C.mute, fontSize: 13, fontWeight: '600' },
  muted: { color: C.mute2, fontSize: 13 },
  h1: { fontSize: 24, fontWeight: '800', color: C.ink },
  h2: { fontSize: 17, fontWeight: '700', color: C.ink, marginTop: 8 },
  btn: { minHeight: 48, borderRadius: 14, paddingHorizontal: 18, alignItems: 'center', justifyContent: 'center', gap: 8 },
  btnSm: { minHeight: 38, paddingHorizontal: 12, borderRadius: 11 },
  btnText: { fontSize: 15, fontWeight: '700' },
  pills: { flexWrap: 'wrap', gap: 8 },
  pill: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 20, borderWidth: 1, borderColor: C.panel2, backgroundColor: C.panel },
  pillText: { color: C.ink, fontSize: 14, fontWeight: '600' },
  input: { backgroundColor: C.panel2, color: C.ink, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15 },
  card: { backgroundColor: C.panel, borderRadius: 16, padding: 14, gap: 12 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28, gap: 12 },
});
