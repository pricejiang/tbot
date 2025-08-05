require('dotenv').config();
const { setDefaultResultOrder } = require('dns');
setDefaultResultOrder('ipv4first');

const express      = require('express');
const bodyParser   = require('body-parser');
const twilio       = require('twilio');
const { OpenAI }   = require('openai');
const admin        = require('firebase-admin');
const { db }       = require('../firebase'); 

// ---------- clients ----------
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
const client  = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN,
)

// ---------- Constants ----------
const SYSTEM_PROMPT =
  'You are an enthusiastic travel assistant. Answer briefly (≤80 words) unless user asks for detail.';
const MSG_LIMIT          = 10;        // 最近 N 条上下文
const SUMMARY_TOKEN_MAX  = 2000;      // 超过则摘要
const SUMMARY_MAX_TOKENS = 150;

const app = express();
app.use(bodyParser.urlencoded({ extended: false }));

// ---------- Signature Validation ---------- 
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

// Token estimation
const roughTokens = str => Math.ceil(str.length / 4);  // 粗略：4 字符≈1 token

// Twilio signature check (安全 & 幂等)
app.post('/twilio', async (req, res) => {
  if (!isValid(req)) {
    console.log('invalid signature');
    return res.status(403).send('invalid signature');
  }

  // Get incoming message
  const inboundText = req.body.Body?.trim() || '';  // Sender text
  const chatId = req.body.From;            // Sender number

  console.log(`[Inbound] ${chatId}: ${inboundText}`);

  // Write the incoming message into firestore
  await db.collection('chats').doc(chatId).collection('messages').add({
    sender: 'user',
    text: inboundText,
    ts: admin.firestore.FieldValue.serverTimestamp()
  });

  // Read most recent N messages 
  const snap = await db.collection('chats').doc(chatId).collection('messages').orderBy('ts', 'desc').limit(MSG_LIMIT).get();

  let history = snap.docs.reverse().map(d => d.data());

  // Make summary based on them 
  let totalTokens = history.reduce((n,m) => n + roughTokens(m.text), 0);
  if (totalTokens > SUMMARY_TOKEN_MAX) {
    const summaryResp = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL, 
      temperature: 0, 
      messages: [
        { role:'system', content:'Summarize the following dialog in ≤150 tokens' },
        { role:'user',   content: history.map(m=>`${m.sender}: ${m.text}`).join('\n') }
      ],
      max_tokens: SUMMARY_MAX_TOKENS,
    });
    const summary = summaryResp.choices[0].message.content.trim();

    await db.collection('chats').doc(chatId).set({ summary, lastUpdated: Date.now() }, { merge: true });

    history = history.slice(-3);
    history.unshift({ sender: 'system', text: `Summary: ${summary}`});
    totalTokens = history.reduce((n,m) => n + roughTokens(m.text), 0);
  }

  // Build the prompt and call OpenAI
  const promptMsgs = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...history.map(m => ({
      role: m.sender === 'user' ? 'user' : 'assistant',
      content: m.text
    })),
    { role: 'user', content: inboundText },
  ]

  // 1. 调 GPT-4o Mini
  let reply = '⚠️ AI response failed'
  try {
    const completion = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL,
      temperature: 0.3,
      messages: promptMsgs,
      max_tokens: 150
    })
    reply = completion.choices[0].message.content.trim();
    console.log('GPT4-mini:', reply)
  } catch (e) {
    console.error('OpenAI error', e)
  }

  // Send reply
  try {
    await client.messages.create({
      from: process.env.TWILIO_WHATSAPP_NUMBER,
      to: chatId,
      body: reply
    });
    console.log('GPT4-mini reply sent');

    // Record assistant message
    await db.collection('chats').doc(chatId).collection('messages').add({
      sender: 'assistant',
      text: reply,
      ts: admin.firestore.FieldValue.serverTimestamp(),
    });

    return res.status(200).send();      // ★ 最后再回应 Vercel
  } catch (e) {
    console.error('Send fail', e);
    return res.status(500).send();
  }

});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Webhook on :${PORT}`));
