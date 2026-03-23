// src/config/firebase.config.ts
import * as admin from 'firebase-admin';
import * as path from 'path';

export const initializeFirebase = () => {
  const serviceAccountPath = path.join(process.cwd(), 'serviceAccountKey.json');
  
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccountPath),
    });
    console.log('--- FIREBASE_BROADCAST_NODE_READY ---');
  }
};