(function () {
  'use strict';

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
        var p = Reveal.initialize({
          hash: false,
          controls: true,
          progress: true,
          plugins: [RevealNotes],
        });
        if (payload.start) {
          p.then(function () { Reveal.slide(payload.start[0], payload.start[1]); });
        }
        try { window.focus(); } catch (e) {}
      })
      .catch(function (err) {
        document.body.innerHTML =
          '<pre style="color:#fff;background:#000;padding:20px;white-space:pre-wrap">' +
          'Preview failed to load reveal.js:\n' + (err && err.message || err) + '</pre>';
      });
  }

  window.addEventListener('message', function (ev) {
    var d = ev.data;
    if (!d || d.type !== 'render-deck') return;
    render(d);
  });
})();
