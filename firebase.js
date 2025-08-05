// ---- firebase.js ----
const admin = require('firebase-admin');

if (!admin.apps.length) {
  const svc = JSON.parse(
    Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT, 'base64').toString()
  );
  admin.initializeApp({
    credential: admin.credential.cert(svc),
    projectId: process.env.FIREBASE_PROJECT_ID
  });
}

module.exports = { db: admin.firestore() };
