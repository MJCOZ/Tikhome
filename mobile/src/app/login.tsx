import { useEffect, useState } from 'react';
import { Linking, ScrollView } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api, setToken } from '../lib/api';
import { useAuth } from '../lib/auth';
import { toLatin } from '../lib/format';
import { C } from '../lib/theme';
import { Btn, Card, Field, Input, T, s } from '../components/ui';

export default function Login() {
  const insets = useSafeAreaInsets();
  const { login, register, refresh } = useAuth();
  const [mode, setMode] = useState<'login' | 'register' | 'forgot'>('login');
  const [code, setCode] = useState('');
  const [support, setSupport] = useState<string | null>(null);
  useEffect(() => { if (mode === 'forgot') api<{ whatsapp: string | null }>('/api/auth/support').then((d) => setSupport(d.whatsapp)).catch(() => {}); }, [mode]);
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setErr(''); setBusy(true);
    try {
      const p = toLatin(phone.trim());
      if (mode === 'login') await login(p, password);
      else if (mode === 'register') await register(name.trim(), p, password);
      else {
        const d = await api<{ token: string }>('/api/auth/reset', { method: 'POST', body: { phone: p, code: toLatin(code.trim()), new_password: password } });
        await setToken(d.token); await refresh();
      }
      router.canGoBack() ? router.back() : router.replace('/');
    } catch (e: any) { setErr(e.message); }
    setBusy(false);
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: C.bg }} contentContainerStyle={{ padding: 20, paddingTop: insets.top + 24, gap: 16 }} keyboardShouldPersistTaps="handled">
      <T style={s.h1}>{mode === 'login' ? 'تسجيل الدخول' : mode === 'register' ? 'إنشاء حساب' : 'استعادة كلمة السر'}</T>
      <T style={s.muted}>{mode === 'forgot' ? 'لأمان حسابك، يرسل لك فريق الدعم رمزاً من 6 أرقام على واتساب رقمك المسجّل.' : 'رقم جوالك لا يظهر للباحثين، ويتم التواصل عبر واتساب برسالة جاهزة.'}</T>
      <Card>
        <Field label="رقم الجوال"><Input keyboardType="phone-pad" autoComplete="tel" placeholder="05xxxxxxxx" maxLength={14} value={phone} onChangeText={setPhone} /></Field>
        {mode === 'register' ? <Field label="الاسم"><Input autoComplete="name" maxLength={60} value={name} onChangeText={setName} /></Field> : null}
        {mode === 'forgot' ? (
          <>
            {support ? <Btn kind="sec" title="اطلب رمزاً من الدعم عبر واتساب" onPress={() => Linking.openURL(`https://wa.me/${support}?text=${encodeURIComponent('نسيت كلمة السر في Tikhome. رقم حسابي: ' + phone)}`)} />
              : <T style={s.muted}>تواصل مع إدارة المنصة لطلب رمز الاستعادة.</T>}
            <Field label="رمز الاستعادة"><Input keyboardType="number-pad" autoComplete="one-time-code" maxLength={6} placeholder="6 أرقام" value={code} onChangeText={setCode} /></Field>
          </>
        ) : null}
        <Field label={mode === 'forgot' ? 'كلمة السر الجديدة (8 أحرف على الأقل)' : 'كلمة السر (8 أحرف على الأقل)'}><Input secureTextEntry autoComplete={mode === 'login' ? 'current-password' : 'new-password'} value={password} onChangeText={setPassword} /></Field>
        {err ? <T style={{ color: '#ffb4ae' }}>{err}</T> : null}
        <Btn title={mode === 'login' ? 'دخول' : mode === 'register' ? 'إنشاء الحساب' : 'تغيير كلمة السر'} onPress={submit} loading={busy} />
        <Btn kind="ghost" title={mode === 'login' ? 'ليس لديك حساب؟ سجّل الآن' : 'لديك حساب؟ سجّل الدخول'} onPress={() => { setMode(mode === 'login' ? 'register' : 'login'); setErr(''); }} />
        {mode === 'login' ? <Btn kind="ghost" title="نسيت كلمة السر؟" onPress={() => { setMode('forgot'); setErr(''); }} /> : null}
      </Card>
      <Btn kind="sec" title="إغلاق" onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} />
    </ScrollView>
  );
}
