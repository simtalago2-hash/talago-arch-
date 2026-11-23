# Talago Arch

A personal drafting sketchbook. It opens on a red notebook cover that flips to your pages. Each page is a dotted Moleskine-style grid where lines snap straight from point A to point B, heavier at the ends.

## Features

- **Red notebook cover** fills the screen and flips open on launch. It reopens on the last page you were on. The book icon on the Contents page closes the notebook again.
- **Table of contents** is laid out like a Moleskine diary page: each project is an entry under a row of dots, with its number, name, sketch count and sketch names. Tap **+ Add project** to add one. Open a project and tap **+ New sketch**. Long-press a project (or use ⋯ inside it) to rename, reorder or delete it.
- **Full-screen sketch pages** with a dot grid and no border.
- **Tools** (bottom toolbar):
  - **Straight line** (L): drag and you get a clean line from A to B, heavier at both ends.
  - **Pencil** (P): freehand strokes.
  - **Eraser** (E).
  - **Hand** (H): pan.
  - **Hatch** (T): draw a loop around an area to tone it, after Ching. Tap Hatch again to choose diagonal hatching (either direction), crosshatching or layered crosshatching, and a light, medium or dark value (set by stroke spacing). Strokes are freehand, not ruled, each with a pen hit at both ends. With Snap on, the loop is straightened and its corners land on grid dots (or half-grid dots when zoomed in) and existing line ends. Hatching drawn in plan stays on the plan; hatching drawn in axo stays with that axo view. Tap inside a hatch with the eraser to remove it.
  - **Pen**: ink colour, Ching line weights (major/primary for cuts and profiles, secondary for elevations and corners, grid/layout for construction) and line types (solid, dashed above cut, dashed below cut, centerline).
  - **Ortho** (O): lines lock to horizontal, vertical or 45°.
  - **Grid**: spacing from 1' to 20' in ½' steps.
- **Axonometric view**: tap **Axo** at the top (or press A) and your plan rotates and rises into an axo view.
  - **Drafting along the axes**: with Ortho on, which axo switches on for you, a line locks to the closest axis: x, y, vertical height, or the plan 45°s. You measure along it in grid units, so a vertical line from a plan corner becomes a wall of real height, and its top corners snap so you can connect them.
  - **Ortho off**: a line stays level with the corner it started from.
  - **Angles**: tap **Axo** again for 45°/45° (plan oblique, the default), 30°/60°, 60°/30° or isometric. Use the rotate button (R) to view from the next corner.
  - **Back in plan**: anything drawn above the ground shows lighter.
  - **Measurements**: dimensions and the ChatGPT text use true 3D lengths, with heights as z.
- **Half-grid dots**: zoom in and lighter dots appear halfway between the main ones (including diagonally). While they show, line ends snap to them and lengths step in half-grid increments, e.g. 6" on a 1' grid.
- **Snap** (G, in the ⋯ menu): line ends land on grid dots and existing endpoints. In ortho mode a line also stops where it lines up with an existing endpoint.
- **Hand-drafted style**: every line has a slight, natural waver, like a pencil pulled by hand. It fades out at the ends so corners still meet exactly, and the stored geometry stays precise.
- **Dimensions**: length and angle show live while drawing. **Show dimensions** (D) labels every line in feet and inches, based on the grid spacing. The drawing itself isn't rescaled.
- **Landscape**: on a phone turned sideways, the toolbar moves to a vertical strip on the right so the page stays clear.
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
