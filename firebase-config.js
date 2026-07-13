/**
 * Dil Afroze Order Manager — Firebase configuration.
 *
 * Replace the placeholder values below with your own Firebase project's
 * web app config (Firebase Console → Project settings → General → Your apps → SDK setup).
 * See README.md "Multi-device sync (Firebase)" for the full setup walkthrough.
 *
 * These values are safe to keep in this public repo — Firebase web app
 * config is not a secret. Access is protected by the Firestore security
 * rules + the PIN sign-in (Firebase Authentication), not by hiding these.
 */
var firebaseConfig = {
  apiKey: "AIzaSyDE_E1nF6_J2dBEU9hk3lGIg1zS9CVsqRc",
  authDomain: "dil-afroze-orders.firebaseapp.com",
  projectId: "dil-afroze-orders",
  storageBucket: "dil-afroze-orders.firebasestorage.app",
  messagingSenderId: "731055011285",
  appId: "1:731055011285:web:a7f752dab24a4715b4f95c"
};

// The single shared account used for the PIN gate. This does not need to be
// a real, deliverable email address — it's just a fixed username under the
// hood. The "password" for this account (set in Firebase Console →
// Authentication → Users) is the PIN your team enters on each device.
var DA_SHARED_AUTH_EMAIL = "shop@dilafroze.app";

firebase.initializeApp(firebaseConfig);
var daAuth = firebase.auth();
var daDb = firebase.firestore();
daDb.enablePersistence({ synchronizeTabs: true }).catch(function (err) {
  console.warn('Firestore offline persistence unavailable:', err.code);
});
