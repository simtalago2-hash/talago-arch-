# Talago Arch

A personal drafting sketchbook. It opens on a red notebook cover that flips to your pages. Each page is a dotted Moleskine-style grid where lines snap straight from point A to point B, heavier at the ends.

## Features

- **Red notebook cover** fills the screen and flips open on launch. It reopens on the last page you were on. The book icon on the Contents page closes the notebook again.
- **Table of contents** lists your projects with **+ Add project**. Open a project and tap **+ New sketch**. Long-press a project (or use ⋯ inside it) to rename, reorder or delete it.
- **Full-screen sketch pages** with a dot grid and no border.
- **Tools** (bottom toolbar):
  - **Straight line** (L): drag and you get a clean line from A to B, heavier at both ends.
  - **Pencil** (P): freehand strokes.
  - **Eraser** (E).
  - **Hand** (H): pan.
  - **Pen colour and weight**.
  - **Ortho** (O): lines lock to horizontal, vertical or 45°.
  - **Grid**: spacing from 1' to 20' in ½' steps.
- **Snap** (G, in the ⋯ menu): line ends land on grid dots and existing endpoints. In ortho mode a line also stops where it lines up with an existing endpoint.
- **Dimensions**: length and angle show live while drawing. **Show dimensions** (D) labels every line in feet and inches, based on the grid spacing. The drawing itself isn't rescaled.
- **Undo / redo / clear** at the top. Zoom − / % / + and full screen at the bottom (tap the % to fit the drawing), plus a "Saved to notebook" status. Pinch to zoom and two fingers to pan on touch. With an Apple Pencil, one finger pans.
- **Share with ChatGPT**: the Share button sends a PNG plus a text description (coordinates and lengths in feet) to any app, including ChatGPT. The ✦ button on the Contents page copies a summary of the whole notebook.
- **Back up / restore** the notebook as a file (✦ menu).
- **Works offline** and installs to your home screen as an app.

## Install on your phone

The app is a Progressive Web App (PWA): no app store needed.

1. **One-time setup (GitHub Pages):** in this repo go to **Settings → Pages → Build and deployment → Source: GitHub Actions**. Then merge to `main` (or run the "Deploy Talago Arch to GitHub Pages" workflow manually). Your app URL will be `https://<your-username>.github.io/talago-arch-/`.
   GitHub Pages on a private repo needs a paid GitHub plan. Otherwise make the repo public, or host the files on any static host (Netlify, Cloudflare Pages, Vercel).
2. **iPhone:** open the URL in Safari → Share → **Add to Home Screen**.
   **Android:** open in Chrome → menu → **Install app** (or tap **Install app** on the Contents page).

## Updates

Every push to `main` redeploys. The workflow stamps the commit hash into `sw.js`, so the installed app sees a new version and shows **"A new version is ready, Update"**. Tap it to reload. Your sketches are kept.

Sketches are stored on the device. Use **Back up notebook** to move them between devices.

## Run locally

No build step:

```sh
python3 -m http.server 8000
# open http://localhost:8000
```

## Files

| File | Purpose |
| --- | --- |
| `index.html` | App shell: cover, contents, project and sketch views |
| `styles.css` | Look and layout (Helvetica Neue on Apple devices, bundled Inter elsewhere) |
| `app.js` | Storage, navigation, drawing engine, export/share |
| `sw.js` | Offline cache + update handling |
| `manifest.webmanifest`, `icons/` | Home-screen install and the red "Ta" icon |
| `.github/workflows/pages.yml` | Deploys to GitHub Pages |
