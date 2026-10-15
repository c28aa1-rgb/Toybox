# Firebase setup

Toybox Takedown uses Firebase project `toybox-takedown`, with a Standard Cloud Firestore database planned in `us-east1` and Anonymous Authentication. The browser signs in anonymously; the game server verifies its ID token and is the only Firestore client.

Each `players/{uid}` document stores the display name, loadout, lifetime kills/deaths/wins, and earned hat unlock IDs. Firestore rules deny all browser reads and writes. The server validates name/loadout edits, checks hat unlocks against lifetime kills, and records match stats from its own simulation events.

## Server credentials

The server needs Google Application Default Credentials with Firestore read/write access and Firebase Authentication user lookup access (the server also checks whether tokens have been revoked). For local development, point ADC at a service account file kept outside the repository:

```sh
export FIREBASE_PROJECT_ID=toybox-takedown
export GOOGLE_APPLICATION_CREDENTIALS=/absolute/path/to/service-account.json
npm run dev
```

For the Render service, add `FIREBASE_PROJECT_ID=toybox-takedown` and add `FIREBASE_SERVICE_ACCOUNT_JSON` as a secret environment variable containing the service account JSON. The server accepts ADC locally or that secret in production. Never commit the service account file or JSON.

Anonymous users retain their profile in that browser through Firebase Auth persistence. Clearing browser storage creates a new anonymous account; permanent cross-device accounts need an account-linking sign-in flow.
