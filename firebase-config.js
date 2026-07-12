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
  apiKey: "REPLACE_WITH_YOUR_API_KEY",
  authDomain: "REPLACE_WITH_YOUR_PROJECT.firebaseapp.com",
  projectId: "REPLACE_WITH_YOUR_PROJECT_ID",
  storageBucket: "REPLACE_WITH_YOUR_PROJECT.appspot.com",
  messagingSenderId: "REPLACE_WITH_YOUR_SENDER_ID",
  appId: "REPLACE_WITH_YOUR_APP_ID"
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
