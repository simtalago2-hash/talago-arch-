# Talago Arch

A personal drafting sketchbook. It opens on a red notebook cover that flips to your pages. Each page is a dotted Moleskine-style grid where lines snap straight from point A to point B, heavier at the ends.

## Features

- **Red notebook cover** fills the screen and flips open on launch. It reopens on the last page you were on. The book icon on the Contents page closes the notebook again.
- **Table of contents** is laid out like a Moleskine diary page: each project is an entry under a row of dots, with its number, name, sketch count and sketch names. Tap **+ Add project** to add one. Open a project and tap **+ New sketch**. Long-press a project (or use ⋯ inside it) to rename, reorder or delete it.
- **Full-screen sketch pages** with a dot grid and no border.
- **Tools** (bottom toolbar):
  - **Straight line** (L): drag and you get a clean line from A to B, heavier at both ends.
  - **Pencil** (P): freehand strokes.
  - **Annotate** (A): tap the tool again to switch between modes.
    - **Dimension**: drag between two points to get an architectural dimension (extension lines, slash ticks, value above). It snaps like lines and measures true 3D length in axo. Drag a dimension line to move it out.
    - **Note**: tap to place a note, or drag from what it points to so it gets a leader and arrowhead. Tap a note to edit or delete it, or drag it to move it. Notes come in small, medium and large.
    - **Lettering**: all notes and dimensions are written in capitals in a hand-lettered blueprint font.
  - **Eraser** (E).
  - **Hand** (H): pan.
  - **Hatch** (T): draw a loop around an area to tone it, after Ching. Tap Hatch again to choose diagonal hatching (either direction), crosshatching or layered crosshatching, and a light, medium or dark value (set by stroke spacing). Strokes are freehand, not ruled, each with a pen hit at both ends. With Snap on, the loop is straightened and its corners land on grid dots (or half-grid dots when zoomed in) and existing line ends. Hatching drawn in plan stays on the plan; hatching drawn in axo stays with that axo view. Tap inside a hatch with the eraser to remove it.
  - **Pen**: ink colour, Ching line weights (major/primary for cuts and profiles, secondary for elevations and corners, grid/layout for construction) and line types (solid, dashed above cut, dashed below cut, centerline).
  - **Ortho** (O): lines lock to horizontal, vertical or 45°.
  - **Grid**: spacing from 1 to 20 in 0.5 steps. Units are left open: 3.5 can mean inches or feet, whatever you have in mind.
- **Axonometric view**: tap **Axo** at the top (or press A) and your plan rotates and rises into an axo view.
  - **Drafting along the axes**: with Ortho on, which axo switches on for you, a line locks to the closest axis: x, y, vertical height, or the plan 45°s. You measure along it in grid units, so a vertical line from a plan corner becomes a wall of real height, and its top corners snap so you can connect them.
  - **Ortho off**: a line stays level with the corner it started from.
  - **Angles**: tap **Axo** again for 45°/45° (plan oblique, the default), 30°/60°, 60°/30° or isometric. Use the rotate button (R) to view from the next corner.
  - **Back in plan**: anything drawn above the ground shows lighter.
  - **Measurements**: dimensions and the ChatGPT text use true 3D lengths, with heights as z.
- **Half-grid dots**: zoom in and lighter dots appear halfway between the main ones (including diagonally). While they show, line ends snap to them and lengths step in half-grid increments, e.g. 0.5 on a grid of 1.
- **Snap** (G, in the ⋯ menu): line ends land on grid dots and existing endpoints. In ortho mode a line also stops where it lines up with an existing endpoint.
- **Hand-drafted style**: every line has a slight, natural waver, like a pencil pulled by hand. It fades out at the ends so corners still meet exactly, and the stored geometry stays precise.
- **Dimensions**: length and angle show live while drawing. **Show dimensions** (D) labels every line with its length as a plain number in grid units (e.g. 3.5), based on the grid spacing. The drawing itself isn't rescaled.
- **Landscape**: on a phone turned sideways, the toolbar moves to a vertical strip on the right so the page stays clear.
- **Undo / redo / clear** at the top. Zoom − / % / + and full screen at the bottom (tap the % to fit the drawing), plus a "Saved to notebook" status. Pinch to zoom and two fingers to pan on touch. With an Apple Pencil, one finger pans.
- **Share with ChatGPT**: the Share button sends a PNG plus a text description (coordinates and lengths, unitless) to any app, including ChatGPT. The ✦ button on the Contents page copies a summary of the whole notebook.
- **Projects have two sections**: **Sketches** and **Schedules**, shown as tabs under the project, each with its own list and add button. The app remembers which tab you were on.
- **Schedules**: **+ New schedule** creates an editable gantt in the sketchbook style.
  - **Default**: design (SD → DD → CD with approval milestones ◆), permit (submitted ◆ → plan review → building permit issued ◆) and construction trades (site prep, foundations, framing, roofing, MEP rough-in, drywall, finishes, punch list, substantial completion ◆).
  - **Auto-scheduling**: every task starts when everything it follows has finished (plus optional lag). Rows auto-orient by phase and start date, and hand-drawn arrows show the links.
  - **Editing**: tap a task to edit its name, trade, phase, task or milestone, duration, what it **follows** and what it **precedes** (choices that would create a loop are disabled). Drag a bar's end to change its duration, or slide it to add lag. **+ Task** adds project-specific trades.
  - **Views and export**: day, week and month zoom (keeps your place). Set the project start date, copy as text for ChatGPT, or export CSV.
- **Export for Rhino (DXF)** (⋯ menu, or a sketch's ⋯ on the project page): choose what one grid unit means (inches, feet, millimetres, centimetres, metres or unitless) and the file opens in Rhino at true size.
  - **What comes across**: straight lines become line curves with true 3D heights; pencil strokes become smooth NURBS curves; hatches become real, editable hatches with their patterns and spacing.
  - **Layers and linetypes**: Ching's weights become layers (TA Major 0.50 mm, TA Secondary 0.25 mm, TA Layout 0.13 mm); dimensions and notes go on a TA Annotation layer as lines and text and line types become linetypes (dashed, hidden, center).
  - **3D model or axo drawing**: export the true 3D model, or, when you have an axo, a flat axo drawing as shown, including face hatching.
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
| `schedule.js` | Project schedules: auto-scheduled gantt, task editor, CSV/text export |
| `dxf.js` | DXF export for Rhino (curves, hatches, layers, linetypes, units) |
| `sw.js` | Offline cache + update handling |
| `manifest.webmanifest`, `icons/` | Home-screen install and the red "Ta" icon |
| `.github/workflows/pages.yml` | Deploys to GitHub Pages |
