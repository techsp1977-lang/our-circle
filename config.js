// ─────────────────────────────────────────────────────────────
// App settings. The SETUP guide tells you exactly what to paste here.
// While FIREBASE.apiKey still says "PASTE", the app runs in DEMO MODE:
// sample family data, saved only in this browser.
// ─────────────────────────────────────────────────────────────
export const APP_NAME = 'Our Circle';          // product name (rename any time)
export const APP_TAGLINE = 'Stay close. Remember what matters.';

export const FIREBASE = {
  apiKey: 'PASTE_API_KEY',
  authDomain: 'PASTE_PROJECT_ID.firebaseapp.com',
  projectId: 'PASTE_PROJECT_ID',
  storageBucket: 'PASTE_PROJECT_ID.firebasestorage.app',
  messagingSenderId: 'PASTE_SENDER_ID',
  appId: 'PASTE_APP_ID',
};

export const DEMO_MODE = FIREBASE.apiKey.startsWith('PASTE');

// Default number of days before a "check in with this household" nudge.
export const DEFAULT_CHECKIN_DAYS = 7;
