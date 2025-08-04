const twilio = require('twilio');
const { setDefaultResultOrder } = require('dns');
const express = require('express');
const bodyParser = require('body-parser');
require('dotenv').config();

setDefaultResultOrder('ipv4first');

const { OpenAI } = require('openai');     // openai SDK 也支持 CJS

// ---------- clients ----------
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
const client  = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN,
)

// ---------- helper ----------
const SYSTEM_PROMPT = `You are an enthusiastic travel assistant.
Answer briefly (≤80 words) unless user asks for detail.`

const app = express();
app.use(bodyParser.urlencoded({ extended: false }));

function isValid(req) {
  const sig = req.header('X-Twilio-Signature');       // Twilio 置入的 HMAC 签名
  const url = process.env.PUBLIC_URL + '/twilio';     // 你在 Twilio Console 配的完整回调 URL
  return twilio.validateRequest(
    process.env.TWILIO_AUTH_TOKEN, 
    sig,
    url,
    req.body                       // Twilio form-data
  );
}

// Twilio signature check (安全 & 幂等)
app.post('/twilio', async (req, res) => {
  if (!isValid(req)) {
    console.log('invalid signature');
    return res.status(403).send('invalid signature');
  }

  // Get incoming message
  const inboundText = req.body.Body || '';  // Sender text
  const toPhone = req.body.From;            // Sender number

  console.log(`[Inbound] ${toPhone}: ${inboundText}`);

  // 1. 调 GPT-4o Mini
  let reply = '⚠️ AI response failed'
  try {
    const completion = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL,
      temperature: 0.3,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user',   content: inboundText }
      ],
      max_tokens: 150
    })
    reply = completion.choices[0].message.content.trim()
    console.log('GPT4-mini:', reply)
  } catch (e) {
    console.error('OpenAI error', e)
  }

  // Send reply
  try {
    await client.messages.create({
      from: process.env.TWILIO_WHATSAPP_NUMBER,
      to: toPhone,
      body: reply
    });
    console.log('GPT4-mini reply sent');
    return res.status(200).send();      // ★ 最后再回应 Vercel
  } catch (e) {
    console.error('Send fail', e);
    return res.status(500).send();
  }

});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Webhook on :${PORT}`));
