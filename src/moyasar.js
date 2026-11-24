'use strict';
// عميل Moyasar: ننشئ فاتورة (صفحة دفع مستضافة لدى ميسّر تدعم مدى وApple Pay والبطاقات)
// ثم نتحقق من حالتها من خادم ميسّر مباشرة؛ لا نثق أبداً بما يصل من المتصفح أو من الـ webhook.
const API = (process.env.MOYASAR_API_URL || 'https://api.moyasar.com/v1').replace(/\/+$/, '');

function createMoyasar({ secretKey = process.env.MOYASAR_SECRET_KEY, apiUrl = API } = {}) {
  const enabled = !!secretKey;
  const auth = 'Basic ' + Buffer.from(String(secretKey || '') + ':').toString('base64');
  async function call(method, path, body) {
    let r;
    try {
      r = await fetch(apiUrl + path, {
        method,
        headers: { Authorization: auth, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch { throw new Error('تعذّر الاتصال ببوابة الدفع'); }
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      console.error('Moyasar error', r.status, JSON.stringify(data).slice(0, 500));
      throw new Error('رفضت بوابة الدفع الطلب');
    }
    return data;
  }
  return {
    enabled,
    // amount بالهللة (ريال × 100)
    createInvoice: ({ amount, description, successUrl, backUrl, callbackUrl, metadata }) =>
      call('POST', '/invoices', { amount, currency: 'SAR', description, success_url: successUrl, back_url: backUrl, callback_url: callbackUrl, metadata }),
    getInvoice: (id) => call('GET', '/invoices/' + encodeURIComponent(id)),
  };
}

module.exports = { createMoyasar };
