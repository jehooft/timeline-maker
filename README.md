# Timeline Maker — standalone

This is the same app, set up to run as an ordinary website — no Claude needed.

## Try it locally

You need [Node.js](https://nodejs.org) installed (any recent version).

```sh
npm install
npm run dev
```

Then open the address it prints (usually http://localhost:5173). That's it —
the whole app, running in your own browser, saving to your own browser's storage.

## Share it with someone else

The easiest way is to give them a link rather than a folder of files. Any of
these work and have a free tier:

- **[Vercel](https://vercel.com)** — drag the `timeline-maker` folder onto
  their web dashboard, or `npx vercel` from inside it.
- **[Netlify](https://netlify.com)** — same idea; drag-and-drop deploy is on
  their site.
- **[GitHub Pages](https://pages.github.com)** — a workflow is already set up
  in `.github/workflows/deploy.yml`: push to `main`, then enable Pages once
  under Settings → Pages → Source → "GitHub Actions". Every push after that
  rebuilds and republishes automatically.

All three build the app to a handful of static files (HTML, CSS, JS) — there is
no server-side code and no database, so hosting is free and simple.

## Building it yourself

```sh
npm run build      # writes static files to dist/
npm run preview    # serves that build locally, to check it before sharing
```

## What each person's copy remembers

Storage is per browser, per device — it uses the browser's own local storage,
the same mechanism every website uses to remember you. That means:

- Your friend's timelines live only in *their* browser. You won't see each
  other's work unless one of you exports a file and sends it to the other.
- Clearing browser data, using a different browser, or a different device
  starts fresh.
- **Export is the real backup.** Use the Timelines → Export JSON button
  regularly if a timeline matters — it downloads a single file that can be
  imported back in, on any device, any time.

## Project layout

```
src/
  time.js, ticks.js, model.js       the timeline logic (no browser APIs)
  storage.js                        saving and loading — uses localStorage
  csv.js                            import/export as CSV
  App.jsx, index.jsx                the app itself
  ui/                               panels, editor, search, etc.
```

If you want to change something, `src/App.jsx` is the file that draws the
timeline and handles clicks and dragging; `src/model.js` is the file that knows
what an event or an era *is*. Nothing else needs a browser to run — you can
test the logic with plain Node.js (see `test.mjs` in the full source package).
