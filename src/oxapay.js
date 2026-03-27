const axios = require('axios');

const OXAPAY_API_URL = 'https://api.oxapay.com/v1';

async function createInvoice({
  amount,
  orderId,
  description,
  callbackUrl,
  returnUrl,
}) {
  const merchantApiKey = process.env.OXAPAY_MERCHANT_API_KEY;

  const response = await axios.post(
    `${OXAPAY_API_URL}/payment/invoice`,
    {
      amount,
      currency: 'USD',
      lifetime: 60,
      fee_paid_by_payer: 1,
      callback_url: callbackUrl,
      sandbox: true,
      order_id: String(orderId),
      description: description || 'Telegram Account Purchase',
      thanks_message: 'Thank you for your purchase! Your accounts will be delivered shortly.',
    },
    {
      headers: {
        merchant_api_key: merchantApiKey,
        'Content-Type': 'application/json',
      },
    }
  );

  if (response.data && response.data.status === 200) {
    return {
      success: true,
      trackId: response.data.data.track_id,
      paymentUrl: response.data.data.payment_url,
      expiredAt: response.data.data.expired_at,
    };
  }

  return {
    success: false,
    error: response.data?.message || 'Failed to create invoice',
  };
}

module.exports = {
  createInvoice,
};
