// index.js
const express = require('express');
const bodyParser = require('body-parser');
const twilio = require('twilio');
require('dotenv').config();

const app = express();
app.use(bodyParser.urlencoded({ extended: false }));

// Twilio signature check (安全 & 幂等)
app.post('/twilio', (req, res) => {
  const twilioSignature = req.header('X-Twilio-Signature');
  const url = process.env.PUBLIC_URL + '/twilio';
  if (!twilio.validateRequest(
        process.env.TWILIO_AUTH_TOKEN,
        twilioSignature,
        url,
        req.body
      )) {
    return res.status(403).send('Invalid signature');
  }

  console.log('Inbound msg:', req.body.Body);
  // 暂存任务载荷，后续会推到 Cloud Tasks；此处只秒回
  res.status(200).send('ACK');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Webhook on :${PORT}`));
