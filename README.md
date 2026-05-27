# Reveal Editor

A browser-based WYSIWYG editor for [reveal.js](https://revealjs.com) presentations. No build, no backend, no install — everything runs client-side in the browser, and your decks live in your own browser's storage.

**Live demo:** `https://slides.samplereality.com`

<!-- Optional: drop a screenshot here once you have one.
     ![Screenshot of the editor](docs/screenshot.png)
-->

## What it does

- **Visual slide editing** with a familiar contenteditable surface. Toolbar for headings, lists, blockquotes, code, links, images, and horizontal rules. Source-mode toggle for raw HTML when you want it.
- **Live theme preview.** The editor mirrors whatever reveal theme you pick (Black, White, Solarized, Sky, etc.) so the fonts and colors you see while editing match the rendered deck.
- **Real `r-fit-text` and `r-stretch`.** The editor scales them in place just like reveal does at runtime — type a long headline and it shrinks to fit; resize the slide and the stretch element re-flows.
- **Smart fragments.** A type dropdown in the toolbar (fade-up, grow, highlight-red, …) live-binds to whichever fragment the cursor is in. Change the dropdown to retype an existing fragment, click the button to toggle the whole thing on or off.
- **Backgrounds.** Per-slide color, image, video, or iframe backgrounds. URLs only — no embedding required.
- **Vertical sub-slides.** Check "Vertical sub-slide" to nest under the previous one; reveal will lay them out as a vertical group.
- **Speaker notes side panel.** Opens to the right of the slide so you can see the slide and notes at the same time. Notes also appear in the deck's reveal speaker view (press `S` during a preview).
- **Reveal.js settings, per deck.** A **Settings…** button in the topbar opens a modal with a curated set of [reveal.js config options](https://revealjs.com/config/) (controls, progress, slide numbering, default transition, auto-advance, slide dimensions, etc.). Settings are stored on the project, travel with `.json` export/import, and apply to the live preview, the standalone HTML export, and the PDF export.
- **Multiple projects** with a Projects modal — open, duplicate, rename, delete, or export any of them.
- **Import / Export.** Every saved project gets four per-row export buttons in the Projects modal:
  - **`.json`** — re-importable project file (preserves everything, including backgrounds, transitions, and fragments).
  - **`.html`** — standalone reveal.js deck with the notes plugin pre-wired.
  - **`.md`** — reveal.js Markdown (slides separated by `---`, vertical sub-slides by `--`, speaker notes after `Note:`, slide attributes in `<!-- .slide: ... -->` comments). Round-trippable for most content; very HTML-heavy slides may lose formatting on export. If the deck contains inline images (data URIs from paste/drop), the download becomes a `.md.zip` with the markdown plus an `assets/` folder of extracted image files; importing that `.md.zip` re-inlines the assets.
  - **`.pdf`** — opens the deck in reveal's `?print-pdf` view in a new tab and triggers the browser print dialog (Save as PDF).
  - And **Export all (.zip)** for bundling every project as `.json` files in one archive.
  - Imports accept `.json`, `.zip`, or `.md` files (drop multiple at once).
- **Image optimization on paste/drop.** Large photos get resized to 1920 px on the longest side and re-encoded as JPEG (quality 0.85) before storage — typical 5 MB phone photo lands as ~250 KB. Small icons and SVGs are left untouched.

## How it stores your work

Projects are saved to your browser's **IndexedDB**, which on modern browsers grants gigabytes per origin (vs. localStorage's ~5 MB). Each project is a separate IDB record, so editing one doesn't touch the others.

Side effects worth knowing:

- Different browser or device = different IDB. Projects don't follow you. Use **Export all (.zip)** to move them.
- Clearing site data in your browser deletes everything. Export a backup if it matters.
- Two tabs editing the same project = last write wins. Avoid it.

If you're upgrading from an older single-slot version, your previous deck migrates automatically on first load.

## Hosting it yourself

It's a folder of static files. Drop it on any HTTPS host.

### GitHub Pages

This repo is set up for it. Pages serves from the root of `main`; a `CNAME` file at the root pins the custom domain.

### Apache (e.g. Reclaim Hosting / cPanel)

Upload everything including `.htaccess`. It enforces HTTPS, sets security headers, blocks dotfiles, and applies a Content-Security-Policy that allows the reveal CDN and Google Fonts.

### Locally for development

```bash
python3 -m http.server 8000
# then open http://localhost:8000/
```

## Keyboard shortcuts

| | |
| --- | --- |
| `Cmd/Ctrl + S` | flush save |
| `Cmd/Ctrl + Shift + Enter` | new slide after current |
| `Cmd/Ctrl + P` | preview from start |
| `Cmd/Ctrl + Shift + P` | preview from current slide |
| `Escape` | close whatever modal is open |
| `↑` `↓` `←` `→` *(in preview)* | navigate |
| `S` *(in preview)* | speaker view |
| `F` *(in preview)* | fullscreen |
| `O` *(in preview)* | slide overview |
| `B` *(in preview)* | black out the screen |

## Security notes

Slide content is arbitrary HTML — including `<script>` and `<iframe>` because that's what reveal supports.

- **Preview iframe.** The preview iframe carries no `sandbox` attribute. We tried — `allow-scripts allow-same-origin` got close, but Chrome's built-in PDF viewer refuses to render inside any sandboxed iframe on production (works on `localhost`, fails on real domains), and PDF iframe backgrounds are a feature we wanted. Slide scripts in the preview therefore run at the editor's full origin: a `<script>` in an imported deck can reach `window.parent`, read your IndexedDB, navigate the top window, etc. On a same-origin host the sandbox wouldn't have added meaningful protection here anyway.
- **Two-CSP design.** The editor itself runs under a strict CSP (its own origin, jsdelivr, Google Fonts; no inline scripts). The preview lives in a separate `preview.html` page that's loaded into the iframe and gets the deck data via `postMessage` — so its more permissive CSP (needed for arbitrary slide HTML) is isolated from the editor's at the CSP level. The same CSP is enforced via `.htaccess` on Apache hosts and a `<meta>` tag on static hosts. JSZip is pinned with a subresource-integrity hash.

Practical upshot: **only import project files from sources you trust.** Imported HTML is rendered with `innerHTML`, and an `<img onerror="...">` inside an imported deck will fire when you preview it. Because the preview iframe runs at the editor's origin, that script can read your entire project library and navigate the editor anywhere. If that's a concern for you, host `preview.html` on a separate subdomain — then it's a genuinely different origin and slide scripts can't reach the editor.

## Tech stack

- Vanilla JS, no framework, no build step.
- [reveal.js 5.1.0](https://revealjs.com) — loaded from jsdelivr at runtime, also referenced in exported decks.
- [JSZip 3.10.1](https://stuk.github.io/jszip/) — for the `.zip` import/export, pinned via SRI.
- [turndown 7.2.0](https://github.com/mixmark-io/turndown) and [marked 13.0.3](https://marked.js.org/) — HTML↔Markdown conversion for the `.md` import/export, both pinned via SRI.

The editor is five small files: `index.html`, `app.js`, `styles.css` for the editor itself, plus `preview.html` + `preview.js` for the sandboxed preview page. About 1,500 lines of JS for everything you see.

## License

MIT License — see [LICENSE](LICENSE)
