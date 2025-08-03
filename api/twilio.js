// index.js
const express = require('express');
const bodyParser = require('body-parser');
const twilio = require('twilio');
require('dotenv').config();

const app = express();
app.use(bodyParser.urlencoded({ extended: false }));

// Twilio REST 客户端
const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

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

  res.status(200).send() // respond immediately

  // Get incoming message
  const inboundText = req.body.Body || '';  // Sender text
  const toPhone = req.body.From;            // Sender number

  console.log(`[Inbound] ${toPhone}: ${inboundText}`);

  // Send reply
  try {
    await client.messages.create({
      from: process.env.TWILIO_WHATSAPP_NUMBER, // 你的 Sandbox 号码
      to: toPhone,
      body: `[Echo] ${inboundText}`             // 原文加标签发回
    });
    console.log('Echo sent');
  } catch (err) {
    console.err('Send fail', err);
  }

});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Webhook on :${PORT}`));
