(function () {
  'use strict';

  var PDF_PAYLOAD_KEY = 'reveal-editor:pdf-payload';

  function setHref(id, href) { document.getElementById(id).href = href; }

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = function () { reject(new Error('Failed to load ' + src)); };
      document.body.appendChild(s);
    });
  }

  // Re-create <script> nodes that landed in the DOM via innerHTML so they
  // actually execute — matches the standalone HTML export's behavior.
  function activateScripts(root) {
    var scripts = root.querySelectorAll('script');
    for (var i = 0; i < scripts.length; i++) {
      var old = scripts[i];
      var fresh = document.createElement('script');
      for (var j = 0; j < old.attributes.length; j++) {
        var a = old.attributes[j];
        fresh.setAttribute(a.name, a.value);
      }
      fresh.text = old.textContent;
      old.parentNode.replaceChild(fresh, old);
    }
  }

  function render(payload) {
    var cdn = 'https://cdn.jsdelivr.net/npm/reveal.js@' + payload.version;
    setHref('reveal-css', cdn + '/dist/reveal.css');
    setHref('theme-css', cdn + '/dist/theme/' + payload.theme + '.css');
    document.title = payload.title || 'Preview';

    var slides = document.querySelector('.slides');
    slides.innerHTML = payload.sections;
    activateScripts(slides);

    loadScript(cdn + '/dist/reveal.js')
      .then(function () { return loadScript(cdn + '/plugin/notes/notes.js'); })
      .then(function () {
        var opts = Object.assign({}, payload.config || {}, { hash: false, plugins: [RevealNotes] });
        if (payload.printMode) {
          opts.controls = false;
          opts.progress = false;
        }
        var p = Reveal.initialize(opts);
        if (payload.start) {
          p.then(function () { Reveal.slide(payload.start[0], payload.start[1]); });
        }
        if (payload.printMode) {
          // Reveal auto-detects ?print-pdf in the URL and lays the deck out
          // for print. Give it a beat to load the print stylesheet and finish
          // its reflow before opening the print dialog.
          p.then(function () { setTimeout(function () { window.print(); }, 1200); });
        }
        try { window.focus(); } catch (e) {}
      })
      .catch(function (err) {
        document.body.innerHTML =
          '<pre style="color:#fff;background:#000;padding:20px;white-space:pre-wrap">' +
          'Preview failed to load reveal.js:\n' + (err && err.message || err) + '</pre>';
      });
  }

  // PDF export path: the opener stashed the payload in sessionStorage and
  // opened us with ?print-pdf in the URL (which reveal.js itself looks for).
  // Detect that and start rendering immediately instead of waiting for a
  // postMessage that's never coming.
  if (/print-pdf/i.test(window.location.search)) {
    try {
      var raw = sessionStorage.getItem(PDF_PAYLOAD_KEY);
      if (raw) {
        sessionStorage.removeItem(PDF_PAYLOAD_KEY);
        var payload = JSON.parse(raw);
        payload.printMode = true;
        render(payload);
      } else {
        document.body.textContent = 'No PDF payload found — re-open the PDF export from the editor.';
      }
    } catch (e) {
      document.body.textContent = 'Could not load PDF payload: ' + (e && e.message || e);
    }
  } else {
    window.addEventListener('message', function (ev) {
      var d = ev.data;
      if (!d || d.type !== 'render-deck') return;
      render(d);
    });
  }

  // Editor keyboard shortcuts that must work while the preview iframe has
  // focus. Keydown events never bubble across the frame boundary, so we
  // forward them to the parent via postMessage. Capture phase on document
  // runs before reveal.js's own (bubble-phase) keyboard handler.
  //
  //   Escape        -> close the preview, unless reveal's overview is open,
  //                    in which case reveal handles it (exits overview).
  //                    Fullscreen is exited by the browser before we see it.
  //   Cmd/Ctrl+P    -> close the preview (the key that opened it closes it),
  //                    and keeps the browser's print dialog from opening.
  //
  // Overview stays reachable via reveal's `O` key.
  document.addEventListener('keydown', function (e) {
    if (window.parent === window) return;              // opened standalone
    var mod = e.metaKey || e.ctrlKey;
    var isEsc = e.key === 'Escape';
    var isPrint = mod && !e.altKey && (e.key === 'p' || e.key === 'P');
    if (!isEsc && !isPrint) return;
    if (isEsc) {
      var inOverview = false;
      try { inOverview = !!(window.Reveal && Reveal.isOverview && Reveal.isOverview()); } catch (err) {}
      if (inOverview) return;                            // let reveal exit overview
    }
    e.preventDefault();
    e.stopImmediatePropagation();
    try { window.parent.postMessage({ type: 'close-preview' }, '*'); } catch (err) {}
  }, true);

  // Click handler for <a class="linked-image"> elements — open the URL in a
  // sized, centered popup window over the presentation rather than a new tab.
  // Capture phase + stopImmediatePropagation prevents any other listener from
  // also acting on the click; if a fullscreen element is active, exit it
  // first because browsers won't honor sized popup features in fullscreen.
  document.addEventListener('click', function (e) {
    var a = e.target.closest('a.linked-image');
    if (!a) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    var href = a.getAttribute('href');
    if (!href) return;
    function openWindow() {
      var w = Math.min(window.innerWidth - 80, 1200);
      var h = Math.min(window.innerHeight - 80, 800);
      var left = (window.screenX || 0) + Math.max(0, (window.innerWidth - w) / 2);
      var top = (window.screenY || 0) + Math.max(0, (window.innerHeight - h) / 2);
      var features = 'width=' + w + ',height=' + h + ',left=' + left + ',top=' + top;
      // Deliberately not calling .focus() on the popup: macOS won't raise it
      // visually anyway, and calling focus() registers it as Chrome's active
      // window — which then makes Cmd+` skip past it on the first press.
      // Without focus(), the opener stays active and Cmd+` cycles straight
      // to the buried popup on the first keystroke.
      window.open(href, 'reveal-linked-preview', features);
    }
    if (document.fullscreenElement && document.exitFullscreen) {
      Promise.resolve(document.exitFullscreen()).then(openWindow, openWindow);
    } else {
      openWindow();
    }
  }, true);
})();
