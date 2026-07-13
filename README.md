# Dil Afroze Order Manager

A mobile-first order management PWA for Dil Afroze (Natural Skin & Hair Care). Products, order building, packing slips, real-time multi-device sync, and Google Sheets sync — installable to your phone home screen.

## Live app

Once GitHub Pages is enabled for this repo (see below), the app is available at:

```
https://saira0427-max.github.io/Dil_Afroze_Order_Manager/
```

## 1. Set up multi-device sync (Firebase) — do this first

The app will not load any data until this is done — the config in `firebase-config.js` starts out with placeholder values.

Products, categories, and orders are stored in **Firebase Firestore**, a free real-time database from Google. Every device that opens the app reads and writes the same live data, so adding a product on your phone shows up instantly on a laptop or a second phone too. It also keeps working offline — changes you make without a connection are queued and sync automatically once you're back online (the one exception is creating a **brand-new** order, which needs a connection at the moment you tap Save, since it coordinates the shared DA0001/DA0002/… numbering across devices).

Because the app has no traditional login, access is protected by a single shared **PIN** instead — enter it once per device and it stays signed in.

### Create the Firebase project

1. Go to [console.firebase.google.com](https://console.firebase.google.com) and sign in with your Google account (the same one that owns the order Sheet works fine).
2. **Add project** → name it something like `dil-afroze-orders` → you can turn off Google Analytics → **Create project**.
3. In the left sidebar, **Build → Firestore Database → Create database**. Pick a location close to the UK (e.g. `europe-west2 (London)`) → start in **production mode** → **Enable**.
4. **Build → Authentication → Get started → Sign-in method** → enable **Email/Password**.
5. Still in Authentication, go to the **Users** tab → **Add user**:
   - Email: `shop@dilafroze.app` (doesn't need to be a real, working email — it's just a fixed account name)
   - Password: **this is your shop PIN** — choose something at least 6 characters (e.g. a 6-digit number)
6. Go to **Project settings** (gear icon, top left) → scroll to **Your apps** → click the **Web** icon (`</>`) → nickname it "Dil Afroze Order Manager" → **Register app** (skip Firebase Hosting). You'll be shown a `firebaseConfig` object — copy it.
7. Back in **Firestore Database → Rules**, replace the contents with what's in [`firestore.rules`](firestore.rules) in this repo, then **Publish**.

### Connect the app to your project

Open [`firebase-config.js`](firebase-config.js) in this repo and replace the placeholder `firebaseConfig` values with the ones from step 6 above (you can edit the file directly on GitHub's web UI — click the file, then the pencil/edit icon). If you'd rather not edit it yourself, send me the config values and I'll wire it in for you. Commit the change, and once GitHub Pages redeploys (usually under a minute), the app will show a PIN entry screen — enter the password you set in step 5 to unlock it on that device. Repeat on each device you want to use.

If you ever need to change the PIN, or lock out a lost/stolen device, go to Firebase Console → Authentication → Users, reset the password for that one user, then re-enter the new PIN on each of your devices (use Settings → "Sign Out of This Device" in the app first on any device you want to force back to the PIN screen).

## 2. Add the app to your iPhone home screen

1. Open the live URL above in **Safari** on your iPhone.
2. Tap the **Share** icon (square with an arrow) in the toolbar.
3. Tap **Add to Home Screen**, then **Add**.
4. The app now opens full-screen from your home screen, just like a native app.

## 3. Connect Google Sheets sync

The app posts order updates to a Google Apps Script webhook, which writes into your Google Sheet
(`https://docs.google.com/spreadsheets/d/1ccKmVjeOVZ5WVc8hn6oOfTGYMsqkJ6dfW1hof8gzr70/edit`). This is a one-way mirror for bookkeeping — the live app itself is powered by Firestore (step 1), not the Sheet.

### Deploy the Apps Script webhook

1. Open the Google Sheet above (or the sheet you want orders synced to).
2. Go to **Extensions → Apps Script**.
3. Delete any starter code in `Code.gs` and paste in the contents of [`apps-script/Code.gs`](apps-script/Code.gs) from this repo.
4. Click **Save**, then **Deploy → New deployment**.
5. Click the gear icon next to "Select type" and choose **Web app**.
6. Set:
   - **Execute as:** Me
   - **Who has access:** Anyone
7. Click **Deploy**. Authorize the script when prompted (click through the "unverified app" warning — it's your own script).
8. Copy the **Web app URL** it gives you (ends in `/exec`).

### Point the app at your webhook

1. In the app, tap the **gear icon** (top right) to open Settings.
2. Paste the Web App URL into **Google Apps Script Web App URL**.
3. Tap **Save**.

This URL is stored in Firestore too, so you only need to set it once — every device picks it up automatically. From now on, creating an order, updating its status, marking it paid/unpaid, or saving a packing-slip link will sync automatically to the "Orders" tab of your sheet, and queues updates locally to retry if you're offline when they happen.

**Note:** the sheet only receives updates for orders that were *created* after the webhook was connected (the sync matches rows by order number). Orders created before you set the URL won't backfill automatically.

## 4. Automatic packing-slip PDFs to Google Drive

Tapping **Save to Drive** on an order fills in a Google Doc template with that order's details, exports it as a PDF, saves it into a Drive folder you choose, and writes the link straight back into the app and Sheet — no copying or pasting. This is a separate, additional feature from **Print Packing Slip**, which is unchanged and still opens the full branded slip in a new browser tab for printing.

The automated Drive copy is a simpler, text-based layout (no product photos, no fancy rounded corners) — this trade-off is what makes it possible to generate reliably with no extra sign-in step. Use Print Packing Slip whenever you want the fully-styled version.

### Create the packing-slip template

1. In Google Drive, create a new **Google Doc**. Name it something like "Packing Slip Template."
2. Lay it out with these exact placeholder tokens (curly braces included) — style the text, colours, and spacing however you like, this is exactly what will appear on every generated slip:

   ```
   DIL AFROZE
   Natural Skin & Hair Care

   Order: {{ORDER_NUMBER}}          Date: {{DATE}}

   Ship To:
   {{CUSTOMER_NAME}}
   {{CUSTOMER_ADDRESS}}
   {{CUSTOMER_PHONE}}
   {{CUSTOMER_EMAIL}}
   ```

3. Insert a table (**Insert → Table → 2×2**). Put "Product" and "Amount" in the header row. In the single row below it, put `{{ITEM_LINE}}` in the left cell and `{{ITEM_AMOUNT}}` in the right cell — this one row is a template that gets duplicated once per item automatically, so leave it as exactly one row.
4. Below the table, add:

   ```
   {{DISCOUNT_LINE}}

   Total: {{TOTAL}}

   {{NOTES}}

   Thank you for your order ♥
   www.dilafroze.co.uk
   WhatsApp: 07577 756 348
   ```

5. From the Doc's URL (`https://docs.google.com/document/d/`**`THIS_PART`**`/edit`), copy the ID — you'll paste it into `Code.gs` below.
6. Create (or choose) a Drive **folder** where the generated PDFs should be saved, and copy its ID from its URL the same way (`https://drive.google.com/drive/folders/`**`THIS_PART`**).

### Wire it into the Apps Script

1. Open the same Apps Script project as before (Sheet → **Extensions → Apps Script**).
2. Replace `Code.gs` with the latest version from [`apps-script/Code.gs`](apps-script/Code.gs) in this repo, and fill in your two IDs near the top:
   ```js
   var DRIVE_FOLDER_ID = 'your folder ID here';
   var TEMPLATE_DOC_ID = 'your template Doc ID here';
   ```
3. This feature needs a couple of extra permissions, so the project needs to switch from automatic to an explicit permissions list. In the Apps Script editor, click **Project Settings** (gear icon) → check **"Show `appsscript.json` manifest file in editor"**. Then open the `appsscript.json` file that appears in the file list and replace its contents with [`apps-script/appsscript.json`](apps-script/appsscript.json) from this repo.
4. **Deploy → Manage deployments** → pencil/edit icon → **Version: New version** → **Deploy**. You'll be asked to re-authorize — this time the consent screen will list Sheets, Drive, and an external service (Firestore) — click through it (same "unverified app" warning as before, since it's your own script).

That's it — the webhook URL stays the same, nothing changes in the app's Settings. Tap **Save to Drive** on any order to try it.

**If a PDF doesn't appear after a minute:** the most common cause is the folder/template IDs not being filled in yet, or the manifest step being skipped. In the Apps Script editor, click **Executions** (left sidebar) to see the error from the most recent attempt.

## 5. Using the app

- **Products tab** — add your catalogue (name, price, description, category, optional photo). Manage categories from the "Categories" button; the 8 defaults can't be deleted, custom ones can (as long as no product uses them). Each product has an edit (pencil) and delete icon.
- **New Order tab** — fill in customer details, filter products by category, tap **Add** to add items. Use the GIFT toggle to mark free items, the pencil icon to adjust a name/price for just this order, or "Add Custom / One-off Item" for anything not in the catalogue. Save Order once items are added.
- **Orders tab** — filter by status, update delivery/payment method, mark paid, paste a Drive link manually (or let **Save to Drive** fill it in automatically — see step 4), update status, download a CSV of all orders, print a packing slip, or delete an order entirely (with confirmation — this also removes its row from the Sheet).

Data lives in Firestore and syncs in real time across every device signed in with the shop PIN. The app also works offline: browsing the catalogue and updating existing orders (status, payment, paid, notes, packing-slip link) all queue locally and sync once you're reconnected. Creating a **new** order needs an active connection at the moment you tap Save Order, since it coordinates the shared order-numbering across devices.

## 6. Branding — swapping in the real logo

No logo image file was available when this app was built, so the header and packing slip currently show a styled **"DIL AFROZE"** text wordmark as a placeholder. To use the actual brown PNG logo:

1. Add your logo file to this repo at `icons/logo.png`.
2. Commit and push (or upload via GitHub's web UI).

The app automatically detects and displays `icons/logo.png` if present — no code changes needed. The home-screen app icons (`icons/icon-192.png`, `icons/icon-512.png`, `icons/icon-512-maskable.png`) are a simple teal "DA" monogram in the meantime; swap those files (keeping the same filenames and sizes) if you'd like a custom app icon too.

## Project structure

```
index.html              App shell (Products / New Order / Orders tabs) + PIN gate markup
styles.css               Brand styling
app.js                    All app logic (Firestore sync, rendering, Sheets sync, CSV export, packing slip)
firebase-config.js        Your Firebase project config + shared-PIN account email (fill this in — see step 1)
firestore.rules           Security rules to paste into Firebase Console → Firestore → Rules
manifest.webmanifest      PWA manifest (installable to home screen)
sw.js                     Service worker (offline caching of the app shell)
icons/                    App icons + optional logo.png
apps-script/Code.gs        Google Apps Script webhook source (deploy this into your Sheet)
apps-script/appsscript.json  Manifest with OAuth scopes needed for Drive PDF generation (see step 4)
```

## Local development

This is a static site with no build step. To preview locally:

```bash
python3 -m http.server 8080
```

Then open `http://localhost:8080`.
