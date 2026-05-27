// Reveal Editor — a small browser GUI for building reveal.js decks.
(async () => {
  'use strict';

  const REVEAL_VERSION = '5.1.0';
  const LIBRARY_KEY = 'reveal-editor:library:v1';
  const LEGACY_STORAGE_KEY = 'reveal-editor:project:v1';
  const THEME_KEY = 'reveal-editor:ui-theme';

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  const uid = () => 'id-' + Math.random().toString(36).slice(2, 10);

  const els = {
    deckTitle: $('#deck-title'),
    themeSelect: $('#theme-select'),
    slideList: $('#slide-list'),
    addSlide: $('#btn-add-slide'),
    editor: $('#slide-editor'),
    source: $('#slide-source'),
    toggleSource: $('#toggle-source'),
    toolbar: $('#toolbar'),
    frame: $('#slide-frame'),
    dropOverlay: $('#drop-overlay'),
    transition: $('#slide-transition'),
    bgType: $('#slide-bg-type'),
    bgValue: $('#slide-bg-value'),
    bgLabel: $('#slide-bg-label'),
    vertical: $('#slide-vertical'),
    fragmentType: $('#fragment-type'),
    notes: $('#slide-notes'),
    status: $('#status'),
    fileInput: $('#file-input'),
    projectsButton: $('#btn-projects'),
    projectsModal: $('#projects-modal'),
    projectsClose: $('#projects-close'),
    projectsList: $('#projects-list'),
    projectsNew: $('#projects-new'),
    projectsExportAll: $('#projects-export-all'),
    projectsImportInput: $('#projects-import-input'),
    previewModal: $('#preview-modal'),
    previewFrame: $('#preview-frame'),
    previewClose: $('#preview-close'),
    previewTitle: $('#preview-title'),
    aboutButton: $('#btn-about'),
    aboutModal: $('#about-modal'),
    aboutClose: $('#about-close'),
    themeToggle: $('#btn-theme-toggle'),
    notesPopout: $('#btn-notes-popout'),
    notesPanel: $('#notes-panel'),
    notesPanelText: $('#notes-panel-text'),
    notesPanelClose: $('#notes-panel-close'),
    notesPanelSlide: $('#notes-panel-slide'),
  };

  const FRAGMENT_TYPES = [
    'fade-out', 'fade-up', 'fade-down', 'fade-left', 'fade-right',
    'fade-in-then-out', 'fade-in-then-semi-out',
    'grow', 'shrink', 'strike',
    'highlight-red', 'highlight-green', 'highlight-blue', 'highlight-current-red'
  ];

  const BG_PLACEHOLDERS = {
    color: '#000, rebeccapurple, linear-gradient(...)',
    image: 'https://example.com/photo.jpg',
    video: 'https://example.com/loop.mp4',
    iframe: 'https://example.com/',
  };

  // -------- State --------
  function newSlide(content = '<h2>New slide</h2>') {
    return {
      id: uid(),
      content,
      notes: '',
      transition: '',
      background: { type: '', value: '' },
      vertical: false,
    };
  }

  function migrateSlide(s) {
    if (!s || typeof s !== 'object') return s;
    if (s.background === undefined) {
      const legacy = s.backgroundColor;
      s.background = legacy
        ? { type: 'color', value: String(legacy) }
        : { type: '', value: '' };
      delete s.backgroundColor;
    } else if (typeof s.background !== 'object' || s.background === null) {
      s.background = { type: '', value: '' };
    }
    if (!s.background.type) s.background.type = '';
    if (!s.background.value) s.background.value = '';
    if (typeof s.vertical !== 'boolean') s.vertical = false;
    return s;
  }

  function blankProject(name) {
    const first = newSlide('<h1>My presentation</h1><p>Subtitle or intro</p>');
    const now = Date.now();
    return {
      id: uid(),
      name: name || 'Untitled presentation',
      createdAt: now,
      modifiedAt: now,
      title: name || 'Untitled presentation',
      theme: 'black',
      slides: [first],
      currentId: first.id,
    };
  }

  function normalizeProject(p, fallbackName) {
    if (!p || typeof p !== 'object') return null;
    if (!Array.isArray(p.slides) || p.slides.length === 0) return null;
    p.slides.forEach(migrateSlide);
    if (!p.currentId || !p.slides.some(s => s.id === p.currentId)) {
      p.currentId = p.slides[0].id;
    }
    if (!p.id) p.id = uid();
    if (!p.title) p.title = fallbackName || 'Untitled presentation';
    if (!p.name) p.name = p.title;
    if (!p.theme) p.theme = 'black';
    const now = Date.now();
    if (!p.createdAt) p.createdAt = now;
    if (!p.modifiedAt) p.modifiedAt = now;
    return p;
  }

  // -------- Library (multi-project storage, IndexedDB-backed) --------
  let library = null;          // { version, currentProjectId, projects: [...] }
  let state = null;            // current project entry (reference into library.projects)
  let sourceMode = false;
  let saveTimer = null;

  const DB_NAME = 'reveal-editor';
  const DB_VERSION = 1;
  const STORE_META = 'meta';
  const STORE_PROJECTS = 'projects';
  const META_KEY = 'state';

  let db = null;
  let dbReady = null;       // promise resolved once db is open (or null if it failed)
  const dirtyProjects = new Set();   // ids of projects that need flushing
  let metaDirty = false;

  function openDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const d = e.target.result;
        if (!d.objectStoreNames.contains(STORE_META)) d.createObjectStore(STORE_META);
        if (!d.objectStoreNames.contains(STORE_PROJECTS)) d.createObjectStore(STORE_PROJECTS, { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function idbGet(storeName, key) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly');
      const req = tx.objectStore(storeName).get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  function idbGetAll(storeName) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly');
      const req = tx.objectStore(storeName).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }
  function idbPut(storeName, value, key) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      const req = key !== undefined ? store.put(value, key) : store.put(value);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  function idbDelete(storeName, key) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      const req = tx.objectStore(storeName).delete(key);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  // Open the DB and assemble the in-memory library, migrating from
  // localStorage on first run if needed.
  async function loadLibrary() {
    try {
      db = await openDb();
    } catch (e) {
      console.warn('IndexedDB unavailable, falling back to in-memory only:', e);
      return freshLibrary();
    }

    // Already-migrated case: pull projects + meta from IDB.
    const existing = await idbGetAll(STORE_PROJECTS);
    if (existing.length > 0) {
      const meta = await idbGet(STORE_META, META_KEY);
      const projects = existing.map(p => normalizeProject(p)).filter(Boolean);
      let currentProjectId = meta?.currentProjectId;
      if (!projects.some(p => p.id === currentProjectId)) currentProjectId = projects[0].id;
      // Sort: keep stable but newest first as a default presentation order.
      projects.sort((a, b) => (b.modifiedAt || 0) - (a.modifiedAt || 0));
      return { version: 1, currentProjectId, projects };
    }

    // First-run migration from the multi-project localStorage key.
    try {
      const raw = localStorage.getItem(LIBRARY_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.projects) && parsed.projects.length > 0) {
          const projects = parsed.projects.map(p => normalizeProject(p)).filter(Boolean);
          for (const p of projects) await idbPut(STORE_PROJECTS, p);
          let currentProjectId = parsed.currentProjectId;
          if (!projects.some(p => p.id === currentProjectId)) currentProjectId = projects[0].id;
          await idbPut(STORE_META, { currentProjectId }, META_KEY);
          try { localStorage.removeItem(LIBRARY_KEY); } catch {}
          return { version: 1, currentProjectId, projects };
        }
      }
    } catch (e) { console.warn('library migration failed:', e); }

    // Second-run migration: legacy single-slot key.
    try {
      const legacy = localStorage.getItem(LEGACY_STORAGE_KEY);
      if (legacy) {
        const p = normalizeProject(JSON.parse(legacy));
        if (p) {
          await idbPut(STORE_PROJECTS, p);
          await idbPut(STORE_META, { currentProjectId: p.id }, META_KEY);
          try { localStorage.removeItem(LEGACY_STORAGE_KEY); } catch {}
          return { version: 1, currentProjectId: p.id, projects: [p] };
        }
      }
    } catch (e) { console.warn('legacy migration failed:', e); }

    // Truly fresh — create one blank project and persist it.
    const lib = freshLibrary();
    try {
      await idbPut(STORE_PROJECTS, lib.projects[0]);
      await idbPut(STORE_META, { currentProjectId: lib.currentProjectId }, META_KEY);
    } catch {}
    return lib;
  }

  function freshLibrary() {
    const p = blankProject();
    return { version: 1, currentProjectId: p.id, projects: [p] };
  }

  // Mark a project (or the current one) for the next flush.
  function markDirty(projectId) {
    dirtyProjects.add(projectId || (state && state.id));
    metaDirty = true;
  }

  // Flush whatever's dirty to IndexedDB. Called by scheduleSave / saveProject.
  async function flushDirty() {
    if (!db) return;
    try {
      // Snapshot the dirty set so concurrent edits during await don't lose us
      // entries that were marked after this run started.
      const ids = Array.from(dirtyProjects);
      dirtyProjects.clear();
      const wasMetaDirty = metaDirty;
      metaDirty = false;

      for (const id of ids) {
        const p = library.projects.find(x => x.id === id);
        if (!p) continue;
        p.modifiedAt = Date.now();
        await idbPut(STORE_PROJECTS, p);
      }
      if (wasMetaDirty) {
        await idbPut(STORE_META, { currentProjectId: library.currentProjectId }, META_KEY);
      }
      setStatus('Saved', true);
    } catch (e) {
      setStatus('Save failed: ' + (e.name === 'QuotaExceededError'
        ? 'browser storage is full'
        : (e.message || String(e))), false);
    }
  }

  // Compatibility shim. Most code paths call saveProject()/saveLibrary() —
  // route them through the dirty-tracking flush.
  function saveProject() {
    if (state) markDirty(state.id);
    flushDirty();
  }
  function saveLibrary() { saveProject(); }

  async function deleteProjectRecord(id) {
    if (!db) return;
    try { await idbDelete(STORE_PROJECTS, id); } catch (e) { console.warn('delete failed', e); }
  }

  function scheduleSave() {
    setStatus('Saving…', false);
    if (state) markDirty(state.id);
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { saveTimer = null; flushDirty(); }, 400);
  }

  function setStatus(text, ok) {
    els.status.textContent = text;
    els.status.classList.toggle('saved', !!ok);
  }

  // -------- Rendering --------
  function currentSlide() {
    return state.slides.find(s => s.id === state.currentId) || state.slides[0];
  }

  function renderSidebar() {
    els.slideList.innerHTML = '';
    state.slides.forEach((slide, idx) => {
      const li = document.createElement('li');
      li.dataset.id = slide.id;
      li.draggable = true;
      if (slide.id === state.currentId) li.classList.add('active');
      if (slide.vertical && idx > 0) li.classList.add('vertical');

      const num = document.createElement('span');
      num.className = 'num';
      num.textContent = slideNumber(idx);

      const label = document.createElement('span');
      label.className = 'label';
      label.textContent = slideLabel(slide);

      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'del';
      del.title = 'Delete slide';
      del.textContent = '×';
      del.addEventListener('click', (e) => {
        e.stopPropagation();
        deleteSlide(slide.id);
      });

      li.appendChild(num);
      li.appendChild(label);
      li.appendChild(del);

      li.addEventListener('click', () => selectSlide(slide.id));

      li.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/x-slide-id', slide.id);
        e.dataTransfer.effectAllowed = 'move';
      });
      li.addEventListener('dragover', (e) => {
        if (e.dataTransfer.types.includes('text/x-slide-id')) {
          e.preventDefault();
          li.classList.add('drag-over');
        }
      });
      li.addEventListener('dragleave', () => li.classList.remove('drag-over'));
      li.addEventListener('drop', (e) => {
        e.preventDefault();
        li.classList.remove('drag-over');
        const fromId = e.dataTransfer.getData('text/x-slide-id');
        if (fromId && fromId !== slide.id) moveSlide(fromId, slide.id);
      });

      els.slideList.appendChild(li);
    });
  }

  function slideNumber(idx) {
    let h = 0;
    let v = 0;
    for (let i = 0; i <= idx; i++) {
      if (i === 0 || !state.slides[i].vertical) {
        h++;
        v = 0;
      } else {
        v++;
      }
    }
    return v > 0 ? `${h}.${v}` : String(h);
  }

  function slideLabel(slide) {
    const tmp = document.createElement('div');
    tmp.innerHTML = slide.content;
    const txt = (tmp.textContent || '').trim().replace(/\s+/g, ' ');
    return txt ? (txt.length > 48 ? txt.slice(0, 48) + '…' : txt) : '(empty)';
  }

  function renderEditor() {
    const slide = currentSlide();
    if (sourceMode) {
      els.source.value = slide.content;
    } else {
      els.editor.innerHTML = slide.content;
      decorateFragments();
    }
    els.transition.value = slide.transition || '';
    els.bgType.value = slide.background.type || '';
    els.bgValue.value = slide.background.value || '';
    refreshBgValueField();
    els.vertical.checked = !!slide.vertical;
    els.notes.value = slide.notes || '';
    syncNotesPanel();
    applySlideEffects();
  }

  function refreshBgValueField() {
    const type = els.bgType.value;
    els.bgValue.disabled = !type;
    els.bgValue.placeholder = type ? BG_PLACEHOLDERS[type] : 'Pick a background type first';
    els.bgLabel.textContent = type === 'image' ? 'Image URL'
      : type === 'video' ? 'Video URL'
      : type === 'iframe' ? 'Iframe URL'
      : type === 'color' ? 'Color / CSS'
      : 'Value';
  }

  function decorateFragments() {
    els.editor.querySelectorAll('.fragment').forEach((el, idx) => {
      const type = FRAGMENT_TYPES.find(t => el.classList.contains(t));
      const explicit = el.getAttribute('data-fragment-index');
      const label = explicit != null ? explicit : String(idx + 1);
      el.setAttribute('data-fragment-label', type ? `${label} ${type}` : label);
    });
  }

  function renderAll() {
    els.deckTitle.value = state.title;
    els.themeSelect.value = state.theme;
    applyDeckTheme(state.theme);
    renderSidebar();
    renderEditor();
  }

  // -------- Live theme + sizing in the editor preview --------

  // Loads the chosen reveal theme's CSS so its --r-* custom properties are
  // available everywhere; .slide-frame styles consume them.
  function applyDeckTheme(theme) {
    let link = document.getElementById('deck-theme-css');
    if (!link) {
      link = document.createElement('link');
      link.id = 'deck-theme-css';
      link.rel = 'stylesheet';
      // After the theme CSS loads, font metrics and sizes may change.
      link.addEventListener('load', applySlideEffects);
      document.head.appendChild(link);
    }
    const url = `https://cdn.jsdelivr.net/npm/reveal.js@${REVEAL_VERSION}/dist/theme/${theme}.css`;
    if (link.getAttribute('href') !== url) link.setAttribute('href', url);
  }

  // Reveal's r-fit-text scales an element's font-size to fill the slide width;
  // r-stretch fills the slide's remaining vertical space. The editor uses the
  // same conventions so the preview matches what the deck will render.
  function applySlideEffects() {
    if (sourceMode) return;
    els.editor.querySelectorAll('.r-fit-text').forEach(fitTextElement);
    els.editor.querySelectorAll('.r-stretch').forEach(stretchElement);
  }

  function fitTextElement(el) {
    const container = els.editor;
    if (!container || !container.clientWidth) return;
    const padX = parseFloat(getComputedStyle(container).paddingLeft) +
                 parseFloat(getComputedStyle(container).paddingRight);
    const available = container.clientWidth - padX;
    if (available <= 0) return;
    // Binary search on font-size so el.scrollWidth fits available width.
    let lo = 8, hi = 600;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      el.style.fontSize = mid + 'px';
      if (el.scrollWidth <= available) lo = mid;
      else hi = mid - 1;
    }
    el.style.fontSize = lo + 'px';
  }

  function stretchElement(el) {
    const container = els.editor;
    if (!container) return;
    const cs = getComputedStyle(container);
    const padY = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
    const available = container.clientHeight - padY;
    if (available <= 0) return;
    // Briefly collapse so siblings measure naturally, then take what's left.
    el.style.height = '0px';
    let usedByOthers = 0;
    Array.from(container.children).forEach(child => {
      if (child === el) return;
      const r = child.getBoundingClientRect();
      usedByOthers += r.height;
    });
    const target = Math.max(40, available - usedByOthers - 8);
    el.style.height = target + 'px';
  }

  // -------- Slide operations --------
  function selectSlide(id) {
    captureCurrentContent();
    state.currentId = id;
    renderAll();
    scheduleSave();
  }

  function addSlide({ atEnd = false } = {}) {
    captureCurrentContent();
    const s = newSlide('');
    if (atEnd) {
      state.slides.push(s);
    } else {
      const idx = state.slides.findIndex(x => x.id === state.currentId);
      state.slides.splice(idx + 1, 0, s);
    }
    state.currentId = s.id;
    renderAll();
    scheduleSave();
    els.editor.focus();
  }

  function deleteSlide(id) {
    if (state.slides.length === 1) {
      // Reset the only slide instead of deleting
      state.slides[0] = newSlide('');
      state.currentId = state.slides[0].id;
    } else {
      const idx = state.slides.findIndex(s => s.id === id);
      state.slides.splice(idx, 1);
      if (state.currentId === id) {
        state.currentId = state.slides[Math.max(0, idx - 1)].id;
      }
    }
    renderAll();
    scheduleSave();
  }

  function moveSlide(fromId, beforeId) {
    const fromIdx = state.slides.findIndex(s => s.id === fromId);
    if (fromIdx < 0) return;
    const [moved] = state.slides.splice(fromIdx, 1);
    const toIdx = state.slides.findIndex(s => s.id === beforeId);
    state.slides.splice(toIdx, 0, moved);
    renderSidebar();
    scheduleSave();
  }

  function captureCurrentContent() {
    const slide = currentSlide();
    if (!slide) return;
    if (sourceMode) {
      slide.content = els.source.value;
    } else {
      slide.content = cleanEditorContent(els.editor);
    }
  }

  function cleanEditorContent(root) {
    const clone = root.cloneNode(true);
    clone.querySelectorAll('[data-fragment-label]').forEach(el => {
      el.removeAttribute('data-fragment-label');
    });
    return clone.innerHTML;
  }

  // -------- Toolbar / editing --------
  function execCmd(cmd, arg = null) {
    els.editor.focus();
    document.execCommand(cmd, false, arg);
    onEditorInput();
  }

  function wrapSelection(tag, className) {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;
    const range = sel.getRangeAt(0);
    const node = document.createElement(tag);
    if (className) node.className = className;
    try {
      node.appendChild(range.extractContents());
      range.insertNode(node);
      sel.removeAllRanges();
      const r = document.createRange();
      r.selectNodeContents(node);
      sel.addRange(r);
    } catch (e) {
      console.warn(e);
    }
    onEditorInput();
  }

  function insertHTMLAtCursor(html) {
    els.editor.focus();
    if (!document.execCommand('insertHTML', false, html)) {
      // Fallback
      const sel = window.getSelection();
      if (sel && sel.rangeCount) {
        const range = sel.getRangeAt(0);
        range.deleteContents();
        const wrap = document.createElement('div');
        wrap.innerHTML = html;
        const frag = document.createDocumentFragment();
        while (wrap.firstChild) frag.appendChild(wrap.firstChild);
        range.insertNode(frag);
      } else {
        els.editor.insertAdjacentHTML('beforeend', html);
      }
    }
    onEditorInput();
  }

  function handleToolbarAction(action) {
    switch (action) {
      case 'blockquote':
        execCmd('formatBlock', 'blockquote');
        break;
      case 'code-inline':
        wrapSelection('code');
        break;
      case 'code-block': {
        const sel = window.getSelection();
        const text = sel && !sel.isCollapsed ? sel.toString() : 'code here';
        insertHTMLAtCursor(`<pre><code>${escapeHtml(text)}</code></pre><p></p>`);
        break;
      }
      case 'link': {
        const url = prompt('Link URL:', 'https://');
        if (url) execCmd('createLink', url);
        break;
      }
      case 'image':
        els.fileInput.click();
        break;
      case 'hr':
        insertHTMLAtCursor('<hr><p></p>');
        break;
      case 'fragment':
        toggleFragment();
        break;
      case 'fit-text':
        toggleBlockClass('r-fit-text');
        break;
      case 'stretch':
        toggleBlockClass('r-stretch');
        break;
    }
  }

  const BLOCK_TAGS = new Set([
    'li', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'blockquote', 'pre', 'img', 'iframe', 'video', 'div',
  ]);

  function blockFromRange(range) {
    if (!range) return null;
    let node = range.startContainer;
    // Caret sitting at an offset within the editor itself (e.g. between two
    // block siblings): step into the child at that offset so we can find a
    // surrounding block.
    if (node === els.editor) {
      node = els.editor.childNodes[range.startOffset]
          || els.editor.childNodes[range.startOffset - 1]
          || els.editor.firstElementChild;
    }
    if (node && node.nodeType === Node.TEXT_NODE) node = node.parentNode;
    while (node && node !== els.editor && node !== document.body) {
      if (node.nodeType === Node.ELEMENT_NODE
          && BLOCK_TAGS.has(node.tagName.toLowerCase())
          && els.editor.contains(node)) {
        return node;
      }
      node = node.parentNode;
    }
    if (els.editor.firstElementChild
        && BLOCK_TAGS.has(els.editor.firstElementChild.tagName.toLowerCase())) {
      return els.editor.firstElementChild;
    }
    return null;
  }

  // Prefer the cached "last good" range over the live selection here.
  // Clicking a toolbar button may have shifted focus and reset the live
  // selection to the editor's default caret position, but lastEditorRange
  // still reflects where the user actually was last.
  function getSelectedBlock() {
    return blockFromRange(lastEditorRange)
        || blockFromRange(currentEditorRange())
        || wrapBareEditorContent();
  }

  // Chrome's contenteditable lets you type bare text/inline nodes directly
  // into the editor div without ever creating a block. r-fit-text and
  // r-stretch need a block to attach to, so if we find ourselves in that
  // state, wrap whatever's there in a <div>.
  function wrapBareEditorContent() {
    if (els.editor.childNodes.length === 0) return null;  // empty editor
    if (els.editor.children.length > 0) return null;       // already has blocks
    const wrapper = document.createElement('div');
    while (els.editor.firstChild) wrapper.appendChild(els.editor.firstChild);
    els.editor.appendChild(wrapper);
    return wrapper;
  }

  // The live selection range when it's inside the editor, else the last range
  // we remembered while it was. This survives focus shifts to the toolbar.
  let lastEditorRange = null;
  function currentEditorRange() {
    const sel = window.getSelection();
    if (sel && sel.rangeCount) {
      const r = sel.getRangeAt(0);
      if (els.editor.contains(r.startContainer) || r.startContainer === els.editor) {
        return r;
      }
    }
    return lastEditorRange;
  }
  let restoringSelection = false;
  function rememberEditorRange() {
    if (restoringSelection) return;
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const r = sel.getRangeAt(0);
    if (els.editor.contains(r.startContainer) || r.startContainer === els.editor) {
      lastEditorRange = r.cloneRange();
    }
  }

  // Re-focus the editor and put the live selection back where it was. Any
  // toolbar action that reads the selection should call this first — the
  // mousedown handler tries to keep focus in place, but some browsers still
  // shift focus to the button briefly and drop the live range.
  function restoreEditorSelection() {
    if (!lastEditorRange) return;
    restoringSelection = true;
    try {
      const snapshot = lastEditorRange.cloneRange();
      const sel = window.getSelection();
      if (sel) {
        sel.removeAllRanges();
        sel.addRange(snapshot);
      }
      if (document.activeElement !== els.editor) {
        els.editor.focus();
        if (sel) {
          sel.removeAllRanges();
          sel.addRange(snapshot);
        }
      }
    } finally {
      setTimeout(() => { restoringSelection = false; }, 0);
    }
  }

  function toggleBlockClass(cls) {
    const block = getSelectedBlock();
    if (!block) {
      setStatus(`Place the cursor in a block first to apply ${cls}`, false);
      return;
    }
    block.classList.toggle(cls);
    // Clear inline sizes that applySlideEffects may have set when the class
    // is being removed, otherwise the block keeps its fit/stretch geometry.
    if (!block.classList.contains(cls)) {
      if (cls === 'r-fit-text') block.style.fontSize = '';
      if (cls === 'r-stretch') block.style.height = '';
    }
    onEditorInput();
    // Bring focus + caret back to the editor so the user can keep editing.
    restoreEditorSelection();
  }

  function fragmentFromRange(range) {
    if (!range) return null;
    let node = range.startContainer;
    if (node === els.editor) {
      node = els.editor.childNodes[range.startOffset]
          || els.editor.childNodes[range.startOffset - 1]
          || null;
    }
    if (node && node.nodeType === Node.TEXT_NODE) node = node.parentNode;
    if (!node || !els.editor.contains(node)) return null;
    while (node && node !== els.editor) {
      if (node.nodeType === Node.ELEMENT_NODE && node.classList.contains('fragment')) {
        return node;
      }
      node = node.parentNode;
    }
    return null;
  }
  function getActiveFragment() {
    // For the live-bound dropdown we use the live selection (so it reacts
    // immediately as the user moves the caret). Other call sites can prefer
    // lastEditorRange.
    return fragmentFromRange(currentEditorRange());
  }

  function getFragmentTypeOf(el) {
    return el ? (FRAGMENT_TYPES.find(t => el.classList.contains(t)) || '') : '';
  }

  function setFragmentTypeOn(el, type) {
    if (!el) return;
    FRAGMENT_TYPES.forEach(t => el.classList.remove(t));
    if (type) el.classList.add(type);
  }

  // Keeps the dropdown's selected option in sync with the fragment under the
  // cursor. If no fragment is active, the dropdown reverts to the user's last
  // manually chosen default (stored on the element).
  function syncFragmentDropdown() {
    if (sourceMode) return;
    const frag = getActiveFragment();
    const target = frag
      ? getFragmentTypeOf(frag)
      : (els.fragmentType.dataset.userDefault || '');
    if (els.fragmentType.value !== target) {
      els.fragmentType.value = target;
    }
    els.fragmentType.classList.toggle('bound', !!frag);
    els.fragmentType.title = frag
      ? "Changing this updates this fragment's animation"
      : 'Animation for the next fragment you add';
  }

  function toggleFragment() {
    const type = els.fragmentType.value;
    // For fragment work we DO need the live selection — wrapping spans
    // around a highlighted range uses range.extractContents. Restore the
    // cached selection first so the wrap honours what the user selected
    // before clicking.
    restoreEditorSelection();
    const sel = window.getSelection();
    const activeFrag = fragmentFromRange(lastEditorRange) || getActiveFragment();
    const block = getSelectedBlock();

    // 1. Cursor is already inside a fragment → remove it.
    //    (Inline span: unwrap. Block-level: strip the classes.)
    if (activeFrag) {
      if (activeFrag.tagName.toLowerCase() === 'span') {
        const parent = activeFrag.parentNode;
        while (activeFrag.firstChild) parent.insertBefore(activeFrag.firstChild, activeFrag);
        parent.removeChild(activeFrag);
        parent.normalize();
      } else {
        activeFrag.classList.remove('fragment');
        FRAGMENT_TYPES.forEach(t => activeFrag.classList.remove(t));
      }
      onEditorInput();
      syncFragmentDropdown();
      return;
    }

    // 2. Non-collapsed selection inside a block → wrap selection in a span.
    const hasInlineSelection = sel && !sel.isCollapsed && block
      && !rangeCoversBlock(sel.getRangeAt(0), block);

    if (hasInlineSelection) {
      const span = document.createElement('span');
      span.className = 'fragment';
      if (type) span.classList.add(type);
      try {
        const range = sel.getRangeAt(0);
        span.appendChild(range.extractContents());
        range.insertNode(span);
        const r = document.createRange();
        r.selectNodeContents(span);
        r.collapse(false);
        sel.removeAllRanges();
        sel.addRange(r);
      } catch (e) {
        console.warn(e);
      }
      onEditorInput();
      syncFragmentDropdown();
      return;
    }

    // 3. No fragment, no selection → apply to the nearest block.
    if (!block) {
      setStatus('Place the cursor in a block to fragment it', false);
      return;
    }
    block.classList.add('fragment');
    if (type) block.classList.add(type);
    onEditorInput();
    syncFragmentDropdown();
  }

  function rangeCoversBlock(range, block) {
    if (!range || !block) return false;
    const r = document.createRange();
    r.selectNodeContents(block);
    return range.toString().trim() === r.toString().trim();
  }

  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  function onEditorInput() {
    captureCurrentContent();
    if (!sourceMode) {
      decorateFragments();
      applySlideEffects();
    }
    // Update sidebar label
    const li = els.slideList.querySelector(`li[data-id="${state.currentId}"] .label`);
    if (li) li.textContent = slideLabel(currentSlide());
    scheduleSave();
  }

  // -------- Image drop / paste --------
  // Defaults tuned for 1080p slides on a 16:9 deck. Photos shrink ~10–30×;
  // anything below skipBelow is left alone (icons, screenshots, diagrams).
  const IMAGE_OPTIMIZE = {
    maxDim: 1920,
    quality: 0.85,
    skipBelow: 200 * 1024,
  };

  function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(r.error);
      r.readAsDataURL(file);
    });
  }

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(r.error);
      r.readAsDataURL(blob);
    });
  }

  function loadImageFromFile(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
      img.src = url;
    });
  }

  function formatBytes(n) {
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(0) + ' KB';
    return (n / 1024 / 1024).toFixed(2) + ' MB';
  }

  // Returns { dataUrl, origSize, newSize, skipped }. On any failure we fall
  // through to the original file so the user always gets their image.
  async function optimizeImage(file) {
    const orig = file.size;
    const pass = async () => ({ dataUrl: await fileToDataUrl(file), origSize: orig, newSize: orig, skipped: true });

    if (orig <= IMAGE_OPTIMIZE.skipBelow) return pass();
    // SVG: vector, don't rasterize. GIF: probably animated, canvas drops frames.
    if (file.type === 'image/svg+xml' || file.type === 'image/gif') return pass();

    let img;
    try { img = await loadImageFromFile(file); } catch { return pass(); }

    let w = img.naturalWidth, h = img.naturalHeight;
    if (!w || !h) return pass();
    const longest = Math.max(w, h);
    if (longest > IMAGE_OPTIMIZE.maxDim) {
      const scale = IMAGE_OPTIMIZE.maxDim / longest;
      w = Math.round(w * scale);
      h = Math.round(h * scale);
    }

    // Preserve transparency for PNGs; everything else re-encodes as JPEG.
    const outType = (file.type === 'image/png') ? 'image/png' : 'image/jpeg';
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (outType === 'image/jpeg') {
      // JPEG has no alpha — paint white behind transparent sources.
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, w, h);
    }
    ctx.drawImage(img, 0, 0, w, h);

    const blob = await new Promise(r => canvas.toBlob(r, outType, IMAGE_OPTIMIZE.quality));
    if (!blob || blob.size >= orig) return pass();
    return { dataUrl: await blobToDataUrl(blob), origSize: orig, newSize: blob.size, skipped: false };
  }

  async function insertImageFromFile(file) {
    if (!file || !file.type.startsWith('image/')) return;
    let result;
    try {
      result = await optimizeImage(file);
    } catch (e) {
      console.warn('image optimize failed; using original', e);
      result = { dataUrl: await fileToDataUrl(file), origSize: file.size, newSize: file.size, skipped: true };
    }
    const tag = `<img src="${result.dataUrl}" alt="">`;
    if (sourceMode) {
      const ta = els.source;
      const pos = ta.selectionStart;
      const before = ta.value.slice(0, pos);
      const after = ta.value.slice(ta.selectionEnd);
      ta.value = before + tag + after;
      ta.selectionStart = ta.selectionEnd = pos + tag.length;
      onEditorInput();
    } else {
      insertHTMLAtCursor(tag);
    }
    if (!result.skipped) {
      const saved = Math.round((1 - result.newSize / result.origSize) * 100);
      setStatus(`Image: ${formatBytes(result.origSize)} → ${formatBytes(result.newSize)} (${saved}% smaller)`, true);
    }
  }

  let dragDepth = 0;
  function setupDropZone() {
    const target = els.frame;
    const isFileDrag = (e) => e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');

    target.addEventListener('dragenter', (e) => {
      if (!isFileDrag(e)) return;
      e.preventDefault();
      dragDepth++;
      els.dropOverlay.hidden = false;
    });
    target.addEventListener('dragover', (e) => {
      if (!isFileDrag(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    });
    target.addEventListener('dragleave', (e) => {
      if (!isFileDrag(e)) return;
      dragDepth = Math.max(0, dragDepth - 1);
      if (dragDepth === 0) els.dropOverlay.hidden = true;
    });
    target.addEventListener('drop', (e) => {
      if (!isFileDrag(e)) return;
      e.preventDefault();
      dragDepth = 0;
      els.dropOverlay.hidden = true;
      const files = Array.from(e.dataTransfer.files || []);
      files.filter(f => f.type.startsWith('image/')).forEach(insertImageFromFile);
    });
  }

  function setupPaste() {
    els.editor.addEventListener('paste', (e) => {
      const items = e.clipboardData && e.clipboardData.items;
      if (!items) return;
      for (const item of items) {
        if (item.kind === 'file' && item.type.startsWith('image/')) {
          e.preventDefault();
          insertImageFromFile(item.getAsFile());
          return;
        }
      }
    });
  }

  // -------- Preview / Export --------
  function buildDeckHtml({ standalone, startAt }) {
    const cdn = `https://cdn.jsdelivr.net/npm/reveal.js@${REVEAL_VERSION}`;
    const themeHref = `${cdn}/dist/theme/${state.theme}.css`;
    const revealCss = `${cdn}/dist/reveal.css`;
    const revealJs = `${cdn}/dist/reveal.js`;
    const notesJs = `${cdn}/plugin/notes/notes.js`;

    const sections = buildSections(state.slides);
    const initOpts = `{ hash: ${standalone ? 'true' : 'false'}, controls: true, progress: true, plugins: [RevealNotes] }`;
    const startCall = startAt
      ? `.then(() => Reveal.slide(${startAt[0]}, ${startAt[1]}))`
      : '';

    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(state.title || 'Presentation')}</title>
<link rel="stylesheet" href="${revealCss}">
<link rel="stylesheet" href="${themeHref}" id="theme">
</head>
<body>
<div class="reveal"><div class="slides">
${sections}
</div></div>
<script src="${revealJs}"><\/script>
<script src="${notesJs}"><\/script>
<script>
  Reveal.initialize(${initOpts})${startCall};
<\/script>
</body>
</html>`;
  }

  function slidePosition(id) {
    let h = -1;
    let v = 0;
    for (let i = 0; i < state.slides.length; i++) {
      if (i === 0 || !state.slides[i].vertical) {
        h++;
        v = 0;
      } else {
        v++;
      }
      if (state.slides[i].id === id) return [h, v];
    }
    return [0, 0];
  }

  function escapeAttr(s) {
    return String(s).replace(/"/g, '&quot;');
  }

  function buildSections(slides) {
    // Group consecutive vertical:true slides under the preceding horizontal one.
    const groups = [];
    slides.forEach((s, i) => {
      if (s.vertical && i > 0 && groups.length > 0) {
        groups[groups.length - 1].push(s);
      } else {
        groups.push([s]);
      }
    });
    return groups.map(g => g.length === 1
      ? renderSection(g[0])
      : `<section>\n${g.map(renderSection).join('\n')}\n</section>`
    ).join('\n');
  }

  function renderSection(s) {
    const attrs = [];
    if (s.transition) attrs.push(`data-transition="${escapeAttr(s.transition)}"`);
    if (s.background && s.background.type && s.background.value) {
      const attr = s.background.type === 'color' ? 'data-background'
        : `data-background-${s.background.type}`;
      attrs.push(`${attr}="${escapeAttr(s.background.value)}"`);
    }
    const notes = s.notes ? `<aside class="notes">${escapeHtml(s.notes)}</aside>` : '';
    const head = attrs.length ? `<section ${attrs.join(' ')}>` : '<section>';
    return `${head}${s.content}${notes}</section>`;
  }

  function showPreview({ fromCurrent = false } = {}) {
    captureCurrentContent();
    const startAt = fromCurrent ? slidePosition(state.currentId) : null;
    const payload = {
      type: 'render-deck',
      version: REVEAL_VERSION,
      theme: state.theme,
      title: state.title || 'Presentation',
      sections: buildSections(state.slides),
      start: startAt,
    };
    els.previewTitle.textContent = fromCurrent
      ? `Preview — from slide ${slideNumber(state.slides.findIndex(s => s.id === state.currentId))}`
      : 'Preview';
    els.previewModal.hidden = false;
    // Force a fresh load so reveal.js re-initializes cleanly each time.
    els.previewFrame.addEventListener('load', () => {
      try {
        els.previewFrame.contentWindow?.postMessage(payload, '*');
        els.previewFrame.contentWindow?.focus();
      } catch {}
    }, { once: true });
    els.previewFrame.src = 'preview.html?t=' + Date.now();
  }

  function closePreview() {
    els.previewModal.hidden = true;
    els.previewFrame.removeAttribute('src');
  }

  function exportHtml() {
    captureCurrentContent();
    const html = buildDeckHtml({ standalone: true });
    download(html, (state.title || 'presentation') + '.html', 'text/html');
  }

  function download(content, filename, type) {
    const blob = (content instanceof Blob) ? content : new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // -------- Project library ops --------
  function switchProject(id) {
    if (!id || id === state.id) return;
    const p = library.projects.find(x => x.id === id);
    if (!p) return;
    captureCurrentContent();
    markDirty(state.id);          // flush whatever was edited in the outgoing project
    state = p;
    library.currentProjectId = id;
    metaDirty = true;
    renderAll();
    flushDirty();
  }

  function createProject(name) {
    captureCurrentContent();
    if (state) markDirty(state.id);
    const p = blankProject(name);
    library.projects.push(p);
    state = p;
    library.currentProjectId = p.id;
    markDirty(p.id);
    metaDirty = true;
    renderAll();
    flushDirty();
    renderProjectsList();
  }

  function newProject() {
    createProject();
    closeProjectsModal();
  }

  function duplicateProject(id) {
    const p = library.projects.find(x => x.id === id);
    if (!p) return;
    captureCurrentContent();
    if (state) markDirty(state.id);
    const copy = JSON.parse(JSON.stringify(p));
    copy.id = uid();
    copy.name = (p.name || p.title || 'Untitled') + ' (copy)';
    copy.title = copy.name;
    copy.createdAt = Date.now();
    copy.modifiedAt = Date.now();
    copy.slides.forEach(s => { s.id = uid(); });
    copy.currentId = copy.slides[0].id;
    library.projects.push(copy);
    markDirty(copy.id);
    flushDirty();
    renderProjectsList();
  }

  function deleteProject(id) {
    const idx = library.projects.findIndex(x => x.id === id);
    if (idx < 0) return;
    const p = library.projects[idx];
    if (!confirm(`Delete "${p.name || p.title}"? This can't be undone.`)) return;
    library.projects.splice(idx, 1);
    deleteProjectRecord(id);
    if (library.projects.length === 0) {
      const fresh = blankProject();
      library.projects.push(fresh);
      state = fresh;
      library.currentProjectId = fresh.id;
      markDirty(fresh.id);
      renderAll();
    } else if (state.id === id) {
      state = library.projects[Math.max(0, idx - 1)];
      library.currentProjectId = state.id;
      renderAll();
    }
    metaDirty = true;
    flushDirty();
    renderProjectsList();
  }

  function renameProject(id, newName) {
    const p = library.projects.find(x => x.id === id);
    if (!p) return;
    const trimmed = (newName || '').trim() || 'Untitled presentation';
    p.name = trimmed;
    p.title = trimmed;
    p.modifiedAt = Date.now();
    if (state.id === id) {
      els.deckTitle.value = trimmed;
    }
    markDirty(id);
    flushDirty();
    renderProjectsList();
  }

  function exportProjectAsJson(id) {
    const p = library.projects.find(x => x.id === id);
    if (!p) return;
    if (state.id === id) captureCurrentContent();
    const json = JSON.stringify(serializeProject(p), null, 2);
    download(json, safeFilename(p.name || p.title || 'presentation') + '.json', 'application/json');
  }

  // Strip the project entry down to the fields that make sense in a file.
  function serializeProject(p) {
    return {
      name: p.name,
      title: p.title,
      theme: p.theme,
      slides: p.slides,
      currentId: p.currentId,
    };
  }

  function safeFilename(s) {
    return String(s || 'untitled').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 80) || 'untitled';
  }

  async function exportAllAsZip() {
    if (typeof JSZip === 'undefined') {
      alert('Could not load JSZip — check your internet connection.');
      return;
    }
    captureCurrentContent();
    saveLibrary();
    const zip = new JSZip();
    const used = new Map();
    for (const p of library.projects) {
      let base = safeFilename(p.name || p.title || 'untitled');
      const n = (used.get(base) || 0) + 1;
      used.set(base, n);
      const filename = (n === 1 ? base : `${base}-${n}`) + '.json';
      zip.file(filename, JSON.stringify(serializeProject(p), null, 2));
    }
    const blob = await zip.generateAsync({ type: 'blob' });
    const stamp = new Date().toISOString().slice(0, 10);
    download(blob, `reveal-editor-projects-${stamp}.zip`, 'application/zip');
  }

  async function importFiles(fileList) {
    const files = Array.from(fileList || []);
    let added = 0;
    const errors = [];
    for (const f of files) {
      try {
        if (/\.zip$/i.test(f.name) || f.type === 'application/zip') {
          added += await importZip(f);
        } else {
          await importJsonFile(f);
          added++;
        }
      } catch (e) {
        errors.push(`${f.name}: ${e.message || e}`);
      }
    }
    if (added > 0) {
      saveLibrary();
      renderProjectsList();
      setStatus(`Imported ${added} project${added === 1 ? '' : 's'}`, true);
    }
    if (errors.length) {
      alert('Some files could not be imported:\n\n' + errors.join('\n'));
    }
  }

  async function importJsonFile(file) {
    const text = await file.text();
    const data = JSON.parse(text);
    const p = normalizeProject({ ...data, id: uid() }, file.name.replace(/\.json$/i, ''));
    if (!p) throw new Error('Not a valid project file');
    library.projects.push(p);
    markDirty(p.id);
  }

  async function importZip(file) {
    if (typeof JSZip === 'undefined') {
      throw new Error('JSZip not loaded');
    }
    const zip = await JSZip.loadAsync(file);
    const entries = Object.values(zip.files).filter(e => !e.dir && /\.json$/i.test(e.name));
    let count = 0;
    for (const entry of entries) {
      try {
        const text = await entry.async('string');
        const data = JSON.parse(text);
        const p = normalizeProject({ ...data, id: uid() }, entry.name.replace(/\.json$/i, ''));
        if (p) {
          library.projects.push(p);
          markDirty(p.id);
          count++;
        }
      } catch {
        // Skip malformed entries.
      }
    }
    return count;
  }

  // -------- Projects modal --------
  function openProjectsModal() {
    captureCurrentContent();
    saveLibrary();
    renderProjectsList();
    els.projectsModal.hidden = false;
  }

  function closeProjectsModal() {
    els.projectsModal.hidden = true;
  }

  function renderProjectsList() {
    const list = els.projectsList;
    list.innerHTML = '';
    // Sort: most recently modified first.
    const projects = library.projects.slice().sort((a, b) => (b.modifiedAt || 0) - (a.modifiedAt || 0));
    if (projects.length === 0) {
      const empty = document.createElement('li');
      empty.className = 'projects-empty';
      empty.textContent = 'No projects yet — create one.';
      list.appendChild(empty);
      return;
    }
    for (const p of projects) {
      list.appendChild(renderProjectRow(p));
    }
  }

  function renderProjectRow(p) {
    const li = document.createElement('li');
    if (p.id === state.id) li.classList.add('active');

    const name = document.createElement('input');
    name.type = 'text';
    name.className = 'proj-name';
    name.value = p.name || p.title || 'Untitled';
    name.title = 'Rename';
    name.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); name.blur(); }
      else if (e.key === 'Escape') { name.value = p.name || p.title || ''; name.blur(); }
    });
    name.addEventListener('change', () => renameProject(p.id, name.value));

    const meta = document.createElement('div');
    meta.className = 'proj-meta';
    const slideCount = (p.slides || []).length;
    meta.textContent = `${slideCount} slide${slideCount === 1 ? '' : 's'} · ${formatRelative(p.modifiedAt)}${p.id === state.id ? ' · open' : ''}`;

    const actions = document.createElement('div');
    actions.className = 'proj-actions';

    const openBtn = document.createElement('button');
    openBtn.type = 'button';
    openBtn.textContent = 'Open';
    openBtn.disabled = p.id === state.id;
    openBtn.addEventListener('click', () => {
      switchProject(p.id);
      closeProjectsModal();
    });

    const dupBtn = document.createElement('button');
    dupBtn.type = 'button';
    dupBtn.textContent = 'Duplicate';
    dupBtn.addEventListener('click', () => duplicateProject(p.id));

    const exportBtn = document.createElement('button');
    exportBtn.type = 'button';
    exportBtn.textContent = '.json';
    exportBtn.title = 'Download this project as .json';
    exportBtn.addEventListener('click', () => exportProjectAsJson(p.id));

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'danger';
    delBtn.textContent = '×';
    delBtn.title = 'Delete project';
    delBtn.addEventListener('click', () => deleteProject(p.id));

    actions.appendChild(openBtn);
    actions.appendChild(dupBtn);
    actions.appendChild(exportBtn);
    actions.appendChild(delBtn);

    li.appendChild(name);
    li.appendChild(meta);
    li.appendChild(actions);
    return li;
  }

  function formatRelative(ts) {
    if (!ts) return 'never';
    const ms = Date.now() - ts;
    const sec = Math.floor(ms / 1000);
    if (sec < 60) return 'just now';
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min} min ago`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr} hr ago`;
    const day = Math.floor(hr / 24);
    if (day < 30) return `${day} day${day === 1 ? '' : 's'} ago`;
    return new Date(ts).toLocaleDateString();
  }

  // -------- UI theme --------
  function applyUiTheme(mode) {
    const light = mode === 'light';
    document.body.classList.toggle('light', light);
    if (els.themeToggle) {
      els.themeToggle.textContent = light ? '☾' : '☀';
      els.themeToggle.title = light ? 'Switch to dark mode' : 'Switch to light mode';
    }
  }

  function toggleUiTheme() {
    const next = document.body.classList.contains('light') ? 'dark' : 'light';
    applyUiTheme(next);
    try { localStorage.setItem(THEME_KEY, next); } catch {}
  }

  function loadUiTheme() {
    let mode = null;
    try { mode = localStorage.getItem(THEME_KEY); } catch {}
    if (mode !== 'light' && mode !== 'dark') {
      mode = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches
        ? 'light' : 'dark';
    }
    applyUiTheme(mode);
  }

  // -------- Notes side panel --------
  function isNotesPanelOpen() {
    return !els.notesPanel.hidden;
  }

  function syncNotesPanel() {
    if (!isNotesPanelOpen()) return;
    const slide = currentSlide();
    if (!slide) return;
    if (els.notesPanelText.value !== (slide.notes || '')) {
      els.notesPanelText.value = slide.notes || '';
    }
    els.notesPanelSlide.textContent = slideNumber(
      state.slides.findIndex(s => s.id === state.currentId)
    );
  }

  function openNotesPanel() {
    syncNotesPanel();
    els.notesPanel.hidden = false;
    document.body.classList.add('notes-open');
    if (currentSlide()) els.notesPanelText.value = currentSlide().notes || '';
    setTimeout(() => els.notesPanelText.focus(), 0);
  }

  function closeNotesPanel() {
    els.notesPanel.hidden = true;
    document.body.classList.remove('notes-open');
  }

  function toggleNotesPanel() {
    if (isNotesPanelOpen()) closeNotesPanel();
    else openNotesPanel();
  }

  // -------- Wiring --------
  function wire() {
    els.deckTitle.addEventListener('input', () => {
      state.title = els.deckTitle.value;
      // Keep the project name (shown in the Projects list) aligned with the
      // deck title — users rename via either.
      state.name = els.deckTitle.value;
      scheduleSave();
    });
    els.themeSelect.addEventListener('change', () => {
      state.theme = els.themeSelect.value;
      applyDeckTheme(state.theme);
      scheduleSave();
    });

    els.addSlide.addEventListener('click', () => addSlide());

    // Double-clicking the empty area below the slide list appends a new
    // slide at the end of the deck.
    els.slideList.addEventListener('dblclick', (e) => {
      if (e.target === els.slideList) addSlide({ atEnd: true });
    });

    els.editor.addEventListener('input', onEditorInput);
    els.source.addEventListener('input', onEditorInput);

    document.addEventListener('selectionchange', () => {
      rememberEditorRange();
      syncFragmentDropdown();
    });

    els.fragmentType.addEventListener('change', () => {
      const frag = getActiveFragment();
      if (frag) {
        // Update the currently-selected fragment in place.
        setFragmentTypeOn(frag, els.fragmentType.value);
        onEditorInput();
      } else {
        // No active fragment: remember the user's choice as the default for
        // the next fragment, and stop syncFragmentDropdown from overwriting
        // it on the next selectionchange.
        els.fragmentType.dataset.userDefault = els.fragmentType.value;
      }
    });

    // Stop toolbar buttons from stealing focus from the editor — otherwise
    // contenteditable loses its selection before the click handler runs.
    els.toolbar.addEventListener('mousedown', (e) => {
      if (e.target.closest('button')) e.preventDefault();
    });

    els.toolbar.addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;
      const cmd = btn.dataset.cmd;
      const arg = btn.dataset.arg || null;
      const action = btn.dataset.action;
      if (cmd) {
        execCmd(cmd, arg);
      } else if (action) {
        handleToolbarAction(action);
      }
    });

    els.toggleSource.addEventListener('click', () => {
      captureCurrentContent();
      sourceMode = !sourceMode;
      els.editor.hidden = sourceMode;
      els.source.hidden = !sourceMode;
      els.toggleSource.style.background = sourceMode ? '#3a4663' : '';
      renderEditor();
    });

    els.transition.addEventListener('change', () => { currentSlide().transition = els.transition.value; scheduleSave(); });
    els.bgType.addEventListener('change', () => {
      const slide = currentSlide();
      slide.background.type = els.bgType.value;
      if (!els.bgType.value) slide.background.value = '';
      refreshBgValueField();
      els.bgValue.value = slide.background.value || '';
      scheduleSave();
    });
    els.bgValue.addEventListener('input', () => {
      currentSlide().background.value = els.bgValue.value;
      scheduleSave();
    });
    els.vertical.addEventListener('change', () => {
      currentSlide().vertical = els.vertical.checked;
      renderSidebar();
      scheduleSave();
    });
    els.notes.addEventListener('input', () => {
      const slide = currentSlide();
      slide.notes = els.notes.value;
      if (isNotesPanelOpen() && els.notesPanelText.value !== slide.notes) {
        els.notesPanelText.value = slide.notes;
      }
      scheduleSave();
    });

    els.fileInput.addEventListener('change', () => {
      const file = els.fileInput.files && els.fileInput.files[0];
      if (file) insertImageFromFile(file);
      els.fileInput.value = '';
    });

    $('#btn-preview').addEventListener('click', () => showPreview());
    $('#btn-preview-here').addEventListener('click', () => showPreview({ fromCurrent: true }));
    $('#btn-export-html').addEventListener('click', exportHtml);
    $('#btn-new').addEventListener('click', () => createProject());
    els.previewClose.addEventListener('click', closePreview);
    els.themeToggle.addEventListener('click', toggleUiTheme);
    els.notesPopout.addEventListener('click', toggleNotesPanel);
    els.notesPanelClose.addEventListener('click', closeNotesPanel);
    els.notesPanelText.addEventListener('input', () => {
      const slide = currentSlide();
      if (!slide) return;
      slide.notes = els.notesPanelText.value;
      if (els.notes.value !== slide.notes) els.notes.value = slide.notes;
      scheduleSave();
    });

    // About modal
    els.aboutButton.addEventListener('click', () => { els.aboutModal.hidden = false; });
    els.aboutClose.addEventListener('click', () => { els.aboutModal.hidden = true; });
    els.aboutModal.addEventListener('click', (e) => {
      if (e.target === els.aboutModal) els.aboutModal.hidden = true;
    });

    // Projects modal
    els.projectsButton.addEventListener('click', openProjectsModal);
    els.projectsClose.addEventListener('click', closeProjectsModal);
    els.projectsNew.addEventListener('click', newProject);
    els.projectsExportAll.addEventListener('click', exportAllAsZip);
    els.projectsImportInput.addEventListener('change', () => {
      const files = els.projectsImportInput.files;
      if (files && files.length) importFiles(files);
      els.projectsImportInput.value = '';
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key === 's') { e.preventDefault(); saveProject(); }
      else if (mod && e.shiftKey && e.key === 'Enter') { e.preventDefault(); addSlide(); }
      else if (mod && e.shiftKey && (e.key === 'P' || e.key === 'p')) {
        e.preventDefault(); showPreview({ fromCurrent: true });
      }
      else if (mod && e.key === 'p') { e.preventDefault(); showPreview(); }
      else if (e.key === 'Escape') {
        if (!els.previewModal.hidden) closePreview();
        else if (!els.projectsModal.hidden) closeProjectsModal();
        else if (!els.aboutModal.hidden) els.aboutModal.hidden = true;
        else if (isNotesPanelOpen()) closeNotesPanel();
      }
    });

    setupDropZone();
    setupPaste();

    let resizeTimer = null;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(applySlideEffects, 80);
    });

    window.addEventListener('beforeunload', () => {
      // Only flush if there's a pending debounced save. Saving unconditionally
      // would overwrite localStorage with whatever's currently in memory even
      // when the user hasn't actually edited anything.
      if (saveTimer != null) {
        captureCurrentContent();
        saveProject();
      }
    });
  }

  // -------- Init --------
  loadUiTheme();
  setStatus('Loading…', false);
  library = await loadLibrary();
  state = library.projects.find(p => p.id === library.currentProjectId) || library.projects[0];
  renderAll();
  wire();
  setStatus('Ready', true);
})();
