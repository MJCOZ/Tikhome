import { Redirect } from 'expo-router';

// رابط العودة من صفحة الدفع (tikhome://billing): نعرض صفحة حسابي التي تتحقق من الحالة
export default function BillingReturn() {
  return <Redirect href="/me" />;
}
