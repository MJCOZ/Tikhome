import { useState } from 'react';
import { Platform, Pressable, Text } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { C } from '../lib/theme';
import { s } from './ui';

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// حقل تاريخ بصيغة YYYY-MM-DD
export function DateField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const date = value ? new Date(value + 'T12:00:00') : new Date();
  return (
    <>
      <Pressable onPress={() => setOpen((o) => !o)} style={[s.input, { justifyContent: 'center' }]} accessibilityRole="button">
        <Text style={{ color: value ? C.ink : C.mute2, fontSize: 15, textAlign: 'center' }}>{value || 'اختر التاريخ'}</Text>
      </Pressable>
      {open ? (
        <DateTimePicker value={date} mode="date" minimumDate={new Date()} display={Platform.OS === 'ios' ? 'inline' : 'default'}
          themeVariant="dark" onChange={(e, d) => { if (Platform.OS !== 'ios') setOpen(false); if (e.type === 'set' && d) { onChange(iso(d)); if (Platform.OS === 'ios') setOpen(false); } }} />
      ) : null}
    </>
  );
}
