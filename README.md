# Dil Afroze Order Manager

A mobile-first order management PWA for Dil Afroze (Natural Skin & Hair Care). Products, order building, packing slips, and Google Sheets sync — no login, works offline, installable to your phone home screen.

## Live app

Once GitHub Pages is enabled for this repo (see below), the app is available at:

```
https://saira0427-max.github.io/Dil_Afroze_Order_Manager/
```

## 1. Add the app to your iPhone home screen

1. Open the live URL above in **Safari** on your iPhone.
2. Tap the **Share** icon (square with an arrow) in the toolbar.
3. Tap **Add to Home Screen**, then **Add**.
4. The app now opens full-screen from your home screen, just like a native app.

## 2. Connect Google Sheets sync

The app posts order updates to a Google Apps Script webhook, which writes into your Google Sheet
(`https://docs.google.com/spreadsheets/d/1ccKmVjeOVZ5WVc8hn6oOfTGYMsqkJ6dfW1hof8gzr70/edit`).

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

From now on, creating an order, updating its status, marking it paid/unpaid, or saving a packing-slip link will sync automatically to the "Orders" tab of your sheet. The app tries both a GET beacon and a POST request for maximum compatibility, and queues updates locally to retry if you're offline when they happen.

**Note:** the sheet only receives updates for orders that were *created* after the webhook was connected (the sync matches rows by order number). Orders created before you set the URL won't backfill automatically.

## 3. Using the app

- **Products tab** — add your catalogue (name, price, description, category, optional photo). Manage categories from the "Categories" button; the 8 defaults can't be deleted, custom ones can (as long as no product uses them).
- **New Order tab** — fill in customer details, filter products by category, tap **Add** to add items. Use the GIFT toggle to mark free items, the pencil icon to adjust a name/price for just this order, or "Add Custom / One-off Item" for anything not in the catalogue. Save Order once items are added.
- **Orders tab** — filter by status, update delivery/payment method, mark paid, paste a Drive link to the saved packing-slip PDF, update status, download a CSV of all orders, or print a packing slip (opens in a new tab — use the Print/Save as PDF button there).

All data is stored locally on your device (localStorage), so the app keeps working without an internet connection — sync to Sheets happens in the background whenever you're online.

## 4. Branding — swapping in the real logo

No logo image file was available when this app was built, so the header and packing slip currently show a styled **"DIL AFROZE"** text wordmark as a placeholder. To use the actual brown PNG logo:

1. Add your logo file to this repo at `icons/logo.png`.
2. Commit and push (or upload via GitHub's web UI).

The app automatically detects and displays `icons/logo.png` if present — no code changes needed. The home-screen app icons (`icons/icon-192.png`, `icons/icon-512.png`, `icons/icon-512-maskable.png`) are a simple teal "DA" monogram in the meantime; swap those files (keeping the same filenames and sizes) if you'd like a custom app icon too.

## Project structure

```
index.html              App shell (Products / New Order / Orders tabs)
styles.css               Brand styling
app.js                    All app logic (state, rendering, sync, CSV export, packing slip)
manifest.webmanifest      PWA manifest (installable to home screen)
sw.js                     Service worker (offline caching of the app shell)
icons/                    App icons + optional logo.png
apps-script/Code.gs        Google Apps Script webhook source (deploy this into your Sheet)
```

## Local development

This is a static site with no build step. To preview locally:

```bash
python3 -m http.server 8080
```

Then open `http://localhost:8080`.
