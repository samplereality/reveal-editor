# Reveal Editor

A browser-based WYSIWYG editor for [reveal.js](https://revealjs.com) presentations. There's no build or backend. Reveal Editor easily installs on Reclaim Hosting or any other shared hosting service. Everything runs client-side in the browser, and decks live in your own browser's storage. 

**Live demo:** `https://slides.samplereality.com`

[Screenshot of the editor](reveal-editor.jpg)

## What it does

- **Visual slide editing**
- **Live theme preview.**
- **Reveal.js formatting tools*** like `r-fit-text`, `r-stretch`, and `fragments`
- **Slide Backgrounds.** Per-slide color, image, video, or iframe backgrounds. Embed entire webpages with just a URL.
- **Vertical sub-slides.** Check "Vertical sub-slide" to nest under the previous one; reveal will lay them out as a vertical group.
- **Speaker notes side panel.** Opens to the right of the slide so you can see the slide and notes at the same time. Notes also appear in the deck's reveal speaker view (press `S` during a preview).
- **Reveal.js settings, per deck.** Control [reveal.js config options](https://revealjs.com/config/). Settings are stored on the project, travel with `.json` export/import, and apply to the live preview, the standalone HTML export, and the PDF export.
- **Multiple projects** with a Projects modal — open, duplicate, rename, delete, or export any of them.
- **Import / Export.** Import from .json or .md. Export formats include .json, .html, .md, and .pdf
- **Image optimization on paste/drop.** Large photos get resized to 1920 px on the longest side and re-encoded as JPEG (quality 0.85) before storage. Small icons and SVGs are left untouched.

## How it stores your work

Projects are saved to your browser's **IndexedDB**. Each project is a separate IDB record, so editing one doesn't touch the others.

Side effects worth knowing:

- Different browser or device = different IDB. Projects don't follow you unless you set up [sync](#syncing-across-browsers).
- Clearing site data in your browser deletes everything. Export a backup if it matters.
- Two tabs editing the same project = last write wins. Avoid it.

## Syncing across browsers

If you bounce between machines, the **Sync** pill in the top bar lets you mirror your projects to a private GitHub Gist. The gist is the source of truth across machines; each browser pulls on load and auto-pushes a few seconds after every edit.

**Setup, once per browser:**

1. Click the **Sync: off** pill in the topbar.
2. Follow the link to create a [personal access token](https://github.com/settings/tokens/new?scopes=gist&description=Reveal+Editor+Sync) with the `gist` scope only — nothing else. Copy the token.
3. Paste the token. Leave **Existing gist ID** blank to create a new private gist, or paste an ID if you already set up another machine.
4. Click **Connect**. The first push uploads your current projects; on subsequent machines, the first pull brings them down.

**Linking a second machine:** open the Sync modal on the first machine and copy the gist ID shown there (there's a Copy button next to it). On the second machine, generate a *separate* PAT — recommended, since each token can be revoked independently if a machine is lost or compromised — paste the new token plus the gist ID, and click Connect. A single PAT shared across machines also works if you'd rather manage one token.

**Behavior:**

- Auto-pull on load, auto-push ~3 seconds after edits stop. Per-project merges use `modifiedAt` — newest wins.
- **Auto-sync never overwrites the project you're currently editing**, even if the remote claims to be newer — this protects in-progress edits from being clobbered by a stale state from another machine or by clock-skew between devices. Background projects still merge normally. To force-update the open project from remote, click **Sync now** or reload the editor.
- Deletions sync via tombstones — delete on one machine, the project disappears on the other after its next sync.
- One gist file per project (`<uid>.json`) plus a `_library.json` for metadata. Same shape as the manual `.json` export, so you can also pull the gist from GitHub if you need a backup.
- A **Reset gist** button replaces remote state with this browser's state — useful if the gist gets into a weird mixed state.
- A **Disconnect** button clears the token and gist ID from this browser. Your data stays where it is; the next browser/sync still works.

**Caveats:**

- The gist PAT lives in `localStorage`. Any XSS on this site could exfiltrate it. The `gist` scope limits the damage — an attacker could only read/write your gists, not your repos or anything else.
- If you edit on both machines simultaneously, last-write-wins per project means one set of edits gets overwritten. Sync once before starting on a new machine.
- GitHub's API rate limit is 5,000 requests/hour for authenticated users, far more than this editor will ever use.

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

- **Preview iframe.** The preview iframe carries no `sandbox` attribute. I tried — `allow-scripts allow-same-origin` got close, but Chrome's built-in PDF viewer refuses to render inside any sandboxed iframe on production (works on `localhost`, fails on real domains), and PDF iframe backgrounds are a feature I wanted. Slide scripts in the preview therefore run at the editor's full origin: a `<script>` in an imported deck can reach `window.parent`, read your IndexedDB, navigate the top window, etc. On a same-origin host the sandbox wouldn't have added meaningful protection here anyway.
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