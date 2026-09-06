# Going live across devices (Firebase backend)

The three games (Float Race, Rocket MIMU, Wheel) share their state through one small
Firebase Realtime Database. Every phone, laptop and projector subscribes to the same record,
and the countdown / race / spin is derived from a server-synced clock, so everyone sees the
exact same thing at the exact same moment. No server to run, free tier is plenty.

## 1. Create the database (5 minutes)
1. Go to https://console.firebase.google.com → **Add project** → name it `mimu-sniper` → (Analytics off is fine) → Create.
2. Left menu **Build → Realtime Database → Create database** → pick a location → start in **locked mode** → Enable.
3. Open the **Rules** tab, replace everything with the rules below, click **Publish**:

```json
{
  "rules": {
    "floatz": { ".read": true, ".write": true },
    "rocket": { ".read": true, ".write": true },
    "wheel":  { ".read": true, ".write": true },
    "$other": { ".read": false, ".write": false }
  }
}
```

4. Project settings (gear icon) → **Your apps** → **</>** (Web) → nickname `site` → Register → copy the `firebaseConfig` values.

## 2. Paste the config
Open `js/config.js` and fill in `apiKey`, `authDomain`, `databaseURL`, `projectId`, `appId`.
`databaseURL` looks like `https://mimu-sniper-default-rtdb.firebaseio.com` (it is on the Realtime Database page).

That's it. Push the site. Open the race on two phones — join on one, watch the roster appear on the other.

## 3. Lock it down (recommended before a big event)
* Firebase console → **App Check** → enable for the web app (reCAPTCHA v3) and enforce it for Realtime Database. This blocks scripts that are not your site from writing.
* Change the booth passphrase (`ADMIN_PASSWORD` in `js/floatz/app.js` and `js/wheel/app.js`).
* Note: with these rules anyone on the page can technically write to the game records (that is how players join without accounts). App Check plus the passphrase-gated UI is enough for a community event; a full auth layer can be added later without touching the game code — only `js/floatz/store.js` talks to the database.

## How it works
* `js/floatz/store.js` is the only file that knows about Firebase. `Store.get/set/update/subscribe` work the same on localStorage (no config) and Firebase (config present).
* `Store.update` runs as a Firebase transaction, so two players tapping the same float at the same time can't both get it.
* `Store.now()` is the server clock; the games use it for every countdown and spin, so clock drift on a phone doesn't desync it.
* Data lives at `floatz/lobby`, `floatz/stats`, `rocket/lobby`, `rocket/stats`, `wheel/wheel`. Delete a node in the console to hard-reset a game.
