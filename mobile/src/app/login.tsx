import { useState } from 'react';
import { ScrollView } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../lib/auth';
import { toLatin } from '../lib/format';
import { C } from '../lib/theme';
import { Btn, Card, Field, Input, T, s } from '../components/ui';

export default function Login() {
  const insets = useSafeAreaInsets();
  const { login, register } = useAuth();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setErr(''); setBusy(true);
    try {
      const p = toLatin(phone.trim());
      if (mode === 'login') await login(p, password); else await register(name.trim(), p, password);
      router.canGoBack() ? router.back() : router.replace('/');
    } catch (e: any) { setErr(e.message); }
    setBusy(false);
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: C.bg }} contentContainerStyle={{ padding: 20, paddingTop: insets.top + 24, gap: 16 }} keyboardShouldPersistTaps="handled">
      <T style={s.h1}>{mode === 'login' ? 'تسجيل الدخول' : 'إنشاء حساب'}</T>
      <T style={s.muted}>رقم جوالك لا يظهر للباحثين، ويتم التواصل عبر واتساب برسالة جاهزة.</T>
      <Card>
        <Field label="رقم الجوال"><Input keyboardType="phone-pad" autoComplete="tel" placeholder="05xxxxxxxx" maxLength={14} value={phone} onChangeText={setPhone} /></Field>
        {mode === 'register' ? <Field label="الاسم"><Input autoComplete="name" maxLength={60} value={name} onChangeText={setName} /></Field> : null}
        <Field label="كلمة السر (8 أحرف على الأقل)"><Input secureTextEntry autoComplete={mode === 'login' ? 'current-password' : 'new-password'} value={password} onChangeText={setPassword} /></Field>
        {err ? <T style={{ color: '#ffb4ae' }}>{err}</T> : null}
        <Btn title={mode === 'login' ? 'دخول' : 'إنشاء الحساب'} onPress={submit} loading={busy} />
        <Btn kind="ghost" title={mode === 'login' ? 'ليس لديك حساب؟ سجّل الآن' : 'لديك حساب؟ سجّل الدخول'} onPress={() => { setMode(mode === 'login' ? 'register' : 'login'); setErr(''); }} />
      </Card>
      <Btn kind="sec" title="إغلاق" onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} />
    </ScrollView>
  );
}
