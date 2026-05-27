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
- **Multiple projects** with a Projects modal — open, duplicate, rename, delete, or export any of them.
- **Import / Export.** Save the current deck as standalone HTML (with reveal + the notes plugin pre-wired), or export individual projects as `.json`, or every project at once as a `.zip`. Imports accept either a single `.json` or a `.zip` archive.
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

Slide content is arbitrary HTML — including `<script>` and `<iframe>` because that's what reveal supports. The editor takes two precautions:

- **Previews are sandboxed.** The preview iframe uses `sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"`, which gives it a unique opaque origin. A script inside a slide can't read the editor's IndexedDB, can't touch `window.parent`, can't navigate the host page.
- **Two-CSP design.** The editor itself runs under a strict CSP (its own origin, jsdelivr, Google Fonts; no inline scripts). The preview lives in a separate `preview.html` page that's loaded into the sandboxed iframe and gets the deck data via `postMessage` — so its more permissive CSP (needed for arbitrary slide HTML) is isolated from the editor's. The same CSP is enforced via `.htaccess` on Apache hosts and a `<meta>` tag on static hosts. JSZip is pinned with a subresource-integrity hash.

That said: **only import project files from sources you trust.** Imported HTML is rendered with `innerHTML`, and an `<img onerror="...">` inside an imported deck will fire when you preview it. The sandbox limits the blast radius (no access to your library), but the script still runs.

## Tech stack

- Vanilla JS, no framework, no build step.
- [reveal.js 5.1.0](https://revealjs.com) — loaded from jsdelivr at runtime, also referenced in exported decks.
- [JSZip 3.10.1](https://stuk.github.io/jszip/) — for the `.zip` import/export, pinned via SRI.

The editor is five small files: `index.html`, `app.js`, `styles.css` for the editor itself, plus `preview.html` + `preview.js` for the sandboxed preview page. About 1,500 lines of JS for everything you see.

## License

MIT License — see [LICENSE](LICENSE)
