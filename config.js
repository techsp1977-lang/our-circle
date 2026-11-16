// ─────────────────────────────────────────────────────────────
// App settings. The SETUP guide tells you exactly what to paste here.
// While FIREBASE.apiKey still says "PASTE", the app runs in DEMO MODE:
// sample family data, saved only in this browser.
// ─────────────────────────────────────────────────────────────
export const APP_NAME = 'Our Circle';          // product name (rename any time)
export const APP_TAGLINE = 'Stay close. Remember what matters.';

export const FIREBASE = {
  apiKey: 'AIzaSyA1_ETAFw4Z6BX133aosUXi3CBXPIIyAFI',
  authDomain: 'our-circle-3da6a.firebaseapp.com',
  projectId: 'our-circle-3da6a',
  storageBucket: 'our-circle-3da6a.firebasestorage.app',
  messagingSenderId: '753441050650',
  appId: '1:753441050650:web:5ce803849fb0ad1cd001a3',
};

export const DEMO_MODE = FIREBASE.apiKey.startsWith('PASTE');

// Default number of days before a "check in with this household" nudge.
export const DEFAULT_CHECKIN_DAYS = 7;
