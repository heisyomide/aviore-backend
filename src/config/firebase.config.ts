// src/config/firebase.config.ts
import * as admin from 'firebase-admin';
import * as path from 'path';
import * as fs from 'fs';

export const initializeFirebase = () => {
  if (admin.apps.length > 0) return;

  const serviceAccountVar = process.env.FIREBASE_SERVICE_ACCOUNT;
  let credential: admin.ServiceAccount;

  try {
    if (serviceAccountVar) {
      // 🚀 PRODUCTION: Use the string from Render Env Vars
      credential = JSON.parse(serviceAccountVar);
      console.log('--- FIREBASE: Using Environment Variable ---');
    } else {
      // 💻 LOCAL: Fallback to your local JSON file
      const serviceAccountPath = path.join(process.cwd(), 'serviceAccountKey.json');
      if (fs.existsSync(serviceAccountPath)) {
        credential = require(serviceAccountPath);
        console.log('--- FIREBASE: Using Local JSON File ---');
      } else {
        throw new Error('No Firebase credential found (Env Var or File)');
      }
    }

    admin.initializeApp({
      credential: admin.credential.cert(credential),
    });

    console.log('--- FIREBASE_BROADCAST_NODE_READY ---');
  } catch (error) {
    console.error('❌ Firebase Initialization Failed:', error.message);
    // Don't throw here if you want the app to start without Firebase, 
    // but usually, it's better to crash so you know it's broken.
    throw error; 
  }
};