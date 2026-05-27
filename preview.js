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
})();
