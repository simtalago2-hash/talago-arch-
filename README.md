# Talago Arch

A personal drafting sketchbook. It opens on a red notebook cover that flips to your pages. Each page is a dotted Moleskine-style grid where lines snap straight from point A to point B, heavier at the ends.

## Features

- **Red notebook cover** fills the screen and flips open on launch. It reopens on the last page you were on.
- **Contents page** lists your projects. Tap **+ New project**, open a project, then tap **+ New sketch**.
- **Full-screen sketch pages** with dot grid, no border.
- **Auto-straightened lines**: drag anywhere and you get a clean straight line from start to finish, heavier at both ends. Three pen weights (Fine / Med / Bold).
- **Ortho mode** (button or **O**): lines lock to horizontal, vertical, or 45°.
- **Snap** (button or **G**): endpoints snap to grid dots. Line ends also snap to existing line endpoints, and in ortho mode a line stops where it lines up with an existing endpoint.
- **Grid spacing**: set what one dot-to-dot space represents, from 1' to 20' in ½' steps. The drawing doesn't rescale. Lengths show live while drawing, and **Dims** (or **D**) shows dimensions on every line.
- **Eraser** (or **E**), **undo / redo** (Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z).
- **Pan and zoom**: two-finger drag / pinch on touch, scroll wheel or trackpad on desktop. Press **F** to fit the drawing to the screen. With an Apple Pencil or stylus, one finger pans so your palm won't draw.
- **Share with ChatGPT**: the Share button sends a PNG plus a text description (coordinates and lengths in feet) to any app, including ChatGPT. The ⋯ menu can also copy the text version or download a PNG.
- **Back up / restore** the whole notebook as a JSON file from the Contents page.
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
| `styles.css` | Moleskine-style look (Cormorant Garamond + Architects Daughter, bundled in `fonts/`) |
| `app.js` | Storage, navigation, drawing engine, export/share |
| `sw.js` | Offline cache + update handling |
| `manifest.webmanifest`, `icons/` | Home-screen install and the red "Ta" icon |
| `.github/workflows/pages.yml` | Deploys to GitHub Pages |
