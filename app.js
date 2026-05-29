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
    undoBtn: $('#btn-undo'),
    redoBtn: $('#btn-redo'),
    frame: $('#slide-frame'),
    bgLayer: $('#slide-bg-layer'),
    bgBadge: $('#slide-bg-badge'),
    dropOverlay: $('#drop-overlay'),
    slideMenu: $('#slide-context-menu'),
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
    projectsRemoteSection: $('#projects-remote-section'),
    projectsRemoteList: $('#projects-remote-list'),
    projectsRemoteStatus: $('#projects-remote-status'),
    projectsRemoteRefresh: $('#projects-remote-refresh'),
    previewModal: $('#preview-modal'),
    previewFrame: $('#preview-frame'),
    previewClose: $('#preview-close'),
    previewTitle: $('#preview-title'),
    aboutButton: $('#btn-about'),
    aboutModal: $('#about-modal'),
    aboutClose: $('#about-close'),
    settingsButton: $('#btn-settings'),
    settingsModal: $('#settings-modal'),
    settingsClose: $('#settings-close'),
    settingsForm: $('#settings-form'),
    settingsReset: $('#settings-reset'),
    syncPill: $('#btn-sync'),
    syncModal: $('#sync-modal'),
    syncClose: $('#sync-close'),
    syncSetup: $('#sync-setup'),
    syncConnected: $('#sync-connected'),
    syncPat: $('#sync-pat'),
    syncGistId: $('#sync-gist-id'),
    syncConnect: $('#sync-connect'),
    syncNow: $('#sync-now'),
    syncReset: $('#sync-reset'),
    syncDisconnect: $('#sync-disconnect'),
    syncStatusText: $('#sync-status-text'),
    syncLast: $('#sync-last'),
    syncError: $('#sync-error'),
    syncGistLink: $('#sync-gist-link'),
    syncGistIdDisplay: $('#sync-gist-id-display'),
    syncCopyId: $('#sync-copy-id'),
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
      config: defaultRevealConfig(),
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
    if (!p.config || typeof p.config !== 'object') p.config = defaultRevealConfig();
    else p.config = { ...defaultRevealConfig(), ...p.config };
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
      const deletedIds = Array.isArray(meta?.deletedIds) ? meta.deletedIds : [];
      return { version: 1, currentProjectId, projects, deletedIds };
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
    return { version: 1, currentProjectId: p.id, projects: [p], deletedIds: [] };
  }

  function ensureDeletedIds() {
    if (!Array.isArray(library.deletedIds)) library.deletedIds = [];
  }

  function recordTombstone(id) {
    ensureDeletedIds();
    const existing = library.deletedIds.find(t => t.id === id);
    const now = Date.now();
    if (existing) existing.deletedAt = now;
    else library.deletedIds.push({ id, deletedAt: now });
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
        await idbPut(STORE_META, {
          currentProjectId: library.currentProjectId,
          deletedIds: library.deletedIds || [],
        }, META_KEY);
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
    schedulePush();
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
      renderLabelInto(label, slideLabel(slide));

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

      li.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        showSlideContextMenu(slide.id, e.clientX, e.clientY);
      });

      els.slideList.appendChild(li);
    });
  }

  // -------- Slide context menu --------
  function showSlideContextMenu(slideId, x, y) {
    const idx = state.slides.findIndex(s => s.id === slideId);
    if (idx < 0) return;
    const slide = state.slides[idx];
    const menu = els.slideMenu;
    menu.innerHTML = '';

    const items = [
      { label: 'Insert slide above', action: () => insertSlideAt(idx, slide.vertical) },
      { label: 'Insert slide below', action: () => insertSlideAt(idx + 1, slide.vertical) },
      { label: 'Duplicate', action: () => duplicateSlide(slideId) },
      { sep: true },
      {
        label: slide.vertical ? 'Make horizontal' : 'Make vertical sub-slide',
        action: () => toggleSlideVertical(slideId),
        disabled: idx === 0,
      },
      { label: 'Move up', action: () => swapSlides(idx, idx - 1), disabled: idx === 0 },
      { label: 'Move down', action: () => swapSlides(idx, idx + 1), disabled: idx === state.slides.length - 1 },
      { sep: true },
      { label: 'Delete', action: () => deleteSlide(slideId), danger: true },
    ];

    items.forEach(item => {
      if (item.sep) {
        const sep = document.createElement('span');
        sep.className = 'sep';
        menu.appendChild(sep);
      } else {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = item.label;
        if (item.danger) btn.className = 'danger';
        if (item.disabled) btn.disabled = true;
        btn.addEventListener('click', () => {
          hideSlideContextMenu();
          item.action();
        });
        menu.appendChild(btn);
      }
    });

    menu.hidden = false;
    const rect = menu.getBoundingClientRect();
    let left = x;
    let top = y;
    if (left + rect.width > window.innerWidth) left = Math.max(4, window.innerWidth - rect.width - 4);
    if (top + rect.height > window.innerHeight) top = Math.max(4, window.innerHeight - rect.height - 4);
    menu.style.left = left + 'px';
    menu.style.top = top + 'px';
  }

  function hideSlideContextMenu() {
    if (!els.slideMenu.hidden) els.slideMenu.hidden = true;
  }

  function insertSlideAt(idx, vertical = false) {
    recordHistory();
    const s = newSlide('');
    // Inherit hierarchy from the clicked slide — inserting around a vertical
    // sub-slide keeps the new slide in the same vertical group rather than
    // breaking out to a new horizontal column. Slot 0 can never be vertical.
    if (vertical && idx > 0) s.vertical = true;
    state.slides.splice(idx, 0, s);
    state.currentId = s.id;
    renderAll();
    scheduleSave();
    els.editor.focus();
  }

  function duplicateSlide(id) {
    const idx = state.slides.findIndex(x => x.id === id);
    if (idx < 0) return;
    recordHistory();
    const copy = JSON.parse(JSON.stringify(state.slides[idx]));
    copy.id = uid();
    state.slides.splice(idx + 1, 0, copy);
    state.currentId = copy.id;
    renderAll();
    scheduleSave();
  }

  function swapSlides(a, b) {
    if (a < 0 || b < 0 || a >= state.slides.length || b >= state.slides.length) return;
    recordHistory();
    [state.slides[a], state.slides[b]] = [state.slides[b], state.slides[a]];
    renderSidebar();
    scheduleSave();
  }

  function toggleSlideVertical(id) {
    const s = state.slides.find(x => x.id === id);
    if (!s) return;
    recordHistory();
    s.vertical = !s.vertical;
    if (id === state.currentId) els.vertical.checked = s.vertical;
    renderSidebar();
    scheduleSave();
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

  // Returns { icon, text } so renderers can put a Phosphor <i> next to the
  // text instead of mixing emoji into the textContent.
  function slideLabel(slide) {
    const tmp = document.createElement('div');
    tmp.innerHTML = slide.content;
    const txt = (tmp.textContent || '').trim().replace(/\s+/g, ' ');
    if (txt) return { icon: null, text: txt.length > 48 ? txt.slice(0, 48) + '…' : txt };
    const media = tmp.querySelector('img, video, iframe');
    if (media) {
      const tag = media.tagName.toLowerCase();
      return backgroundLabel({
        type: tag === 'img' ? 'image' : tag,
        value: media.getAttribute('src') || '',
      });
    }
    if (slide.background && slide.background.type && slide.background.value) {
      return backgroundLabel(slide.background);
    }
    return { icon: null, text: '(empty)' };
  }

  const BG_ICONS = {
    image: 'ph-image',
    video: 'ph-video-camera',
    iframe: 'ph-globe',
    color: 'ph-paint-brush',
  };

  function backgroundLabel(bg) {
    const type = bg.type;
    const value = String(bg.value || '');
    let hint;
    if (type === 'color') {
      hint = value.trim();
    } else if (/^data:/.test(value)) {
      const mime = (value.match(/^data:([^;,]+)/) || ['', ''])[1];
      hint = mime ? `inline ${mime}` : 'inline data';
    } else {
      hint = value;
      try {
        const u = new URL(value, window.location.href);
        hint = decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() || u.hostname);
      } catch {
        const parts = value.split(/[/\\]/).filter(Boolean);
        if (parts.length) hint = parts[parts.length - 1];
      }
    }
    if (hint.length > 40) hint = hint.slice(0, 37) + '…';
    return { icon: BG_ICONS[type] || null, text: hint };
  }

  // Renders a {icon, text} label into a DOM element, replacing its contents.
  function renderLabelInto(el, label) {
    el.replaceChildren();
    if (label.icon) {
      const i = document.createElement('i');
      i.className = 'ph ' + label.icon + ' label-icon';
      el.appendChild(i);
    }
    el.appendChild(document.createTextNode(label.text));
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
    applyEditorBackground();
  }

  // Visualizes the current slide's background in the editor: color/image as
  // a CSS background on the bg-layer, video/iframe as a real embedded
  // element, plus a small badge in the corner labeling the type. Without
  // this, slides with only a background look blank while editing.
  function applyEditorBackground() {
    const slide = currentSlide();
    const layer = els.bgLayer;
    const badge = els.bgBadge;
    layer.style.background = '';
    layer.replaceChildren();
    badge.hidden = true;
    badge.textContent = '';
    if (!slide || !slide.background.type || !slide.background.value) return;

    const { type, value } = slide.background;
    let label = type;
    if (type === 'color') {
      layer.style.background = value;
    } else if (type === 'image') {
      const safe = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      layer.style.backgroundImage = `url("${safe}")`;
    } else if (type === 'video') {
      const v = document.createElement('video');
      v.src = value;
      v.muted = true;
      v.loop = true;
      v.autoplay = true;
      v.playsInline = true;
      layer.appendChild(v);
    } else if (type === 'iframe') {
      const f = document.createElement('iframe');
      f.src = value;
      // No sandbox: Chrome's PDF viewer refuses to render inside any
      // sandboxed iframe (even with allow-same-origin) on production, so
      // we let the background iframe run at full origin to match what
      // the deck does when exported as standalone HTML.
      f.setAttribute('referrerpolicy', 'no-referrer');
      layer.appendChild(f);
    }

    const display = value.length > 80 ? value.slice(0, 77) + '…' : value;
    badge.replaceChildren();
    const iconClass = BG_ICONS[type];
    if (iconClass) {
      const i = document.createElement('i');
      i.className = 'ph ' + iconClass;
      badge.appendChild(i);
    }
    badge.appendChild(document.createTextNode(`${label}: ${display}`));
    badge.hidden = false;
  }

  // -------- Undo / redo --------
  // Snapshot-based history of the current project. Covers structural and
  // metadata changes; text typing inside slides falls back to the browser's
  // native contenteditable undo while focus is in the editor.
  const HISTORY_LIMIT = 50;
  const history = { undo: [], redo: [] };
  let textEditField = null;  // tracks active text-input session so we snapshot once per field-focus

  function snapshotProject() {
    return {
      title: state.title,
      theme: state.theme,
      currentId: state.currentId,
      slides: JSON.parse(JSON.stringify(state.slides)),
    };
  }

  function restoreProject(snap) {
    state.title = snap.title;
    state.theme = snap.theme;
    state.slides = snap.slides;
    state.currentId = snap.currentId;
    if (!state.slides.some(s => s.id === state.currentId)) {
      state.currentId = state.slides[0] && state.slides[0].id;
    }
    renderAll();
    scheduleSave();
  }

  function recordHistory() {
    captureCurrentContent();
    history.undo.push(snapshotProject());
    if (history.undo.length > HISTORY_LIMIT) history.undo.shift();
    history.redo.length = 0;
    refreshUndoButtons();
  }

  function snapshotForTextField(name) {
    if (textEditField === name) return;
    recordHistory();
    textEditField = name;
  }

  function endTextEditSession() {
    textEditField = null;
  }

  function undo() {
    if (history.undo.length === 0) return;
    captureCurrentContent();
    history.redo.push(snapshotProject());
    restoreProject(history.undo.pop());
    textEditField = null;
    refreshUndoButtons();
  }

  function redo() {
    if (history.redo.length === 0) return;
    captureCurrentContent();
    history.undo.push(snapshotProject());
    restoreProject(history.redo.pop());
    textEditField = null;
    refreshUndoButtons();
  }

  function refreshUndoButtons() {
    els.undoBtn.disabled = history.undo.length === 0;
    els.redoBtn.disabled = history.redo.length === 0;
  }

  function clearHistory() {
    history.undo.length = 0;
    history.redo.length = 0;
    textEditField = null;
    refreshUndoButtons();
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
    recordHistory();
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
    recordHistory();
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
    recordHistory();
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
        // Make sure no stale linked-image href is hanging around from a
        // canceled flow.
        delete els.fileInput.dataset.linkHref;
        els.fileInput.click();
        break;
      case 'linked-image': {
        const url = prompt(
          'Open this URL in a new window when the image is clicked:',
          'https://',
        );
        if (!url || url === 'https://') break;
        els.fileInput.dataset.linkHref = url;
        els.fileInput.click();
        break;
      }
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
    if (li) renderLabelInto(li, slideLabel(currentSlide()));
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

  async function insertImageFromFile(file, linkHref = null) {
    if (!file || !file.type.startsWith('image/')) return;
    let result;
    try {
      result = await optimizeImage(file);
    } catch (e) {
      console.warn('image optimize failed; using original', e);
      result = { dataUrl: await fileToDataUrl(file), origSize: file.size, newSize: file.size, skipped: true };
    }
    const imgTag = `<img src="${result.dataUrl}" alt="">`;
    const tag = linkHref
      ? `<a href="${escapeAttr(linkHref)}" target="_blank" rel="noopener noreferrer" class="linked-image">${imgTag}</a>`
      : imgTag;
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
  function buildDeckHtml({ standalone, startAt, project = state }) {
    const cdn = `https://cdn.jsdelivr.net/npm/reveal.js@${REVEAL_VERSION}`;
    const themeHref = `${cdn}/dist/theme/${project.theme}.css`;
    const revealCss = `${cdn}/dist/reveal.css`;
    const revealJs = `${cdn}/dist/reveal.js`;
    const notesJs = `${cdn}/plugin/notes/notes.js`;

    const sections = buildSections(project.slides);
    const cfg = { ...defaultRevealConfig(), ...(project.config || {}), hash: !!standalone };
    const cfgJson = JSON.stringify(cfg);
    const initOpts = `Object.assign(${cfgJson}, { plugins: [RevealNotes] })`;
    const startCall = startAt
      ? `.then(() => Reveal.slide(${startAt[0]}, ${startAt[1]}))`
      : '';

    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(project.title || 'Presentation')}</title>
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
      // window — which then makes the Cmd-backtick window cycler skip past
      // it on the first press. Without focus(), the opener stays active and
      // Cmd-backtick cycles straight to the buried popup on the first press.
      window.open(href, 'reveal-linked-preview', features);
    }
    if (document.fullscreenElement && document.exitFullscreen) {
      Promise.resolve(document.exitFullscreen()).then(openWindow, openWindow);
    } else {
      openWindow();
    }
  }, true);
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
      config: { ...defaultRevealConfig(), ...(state.config || {}) },
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

  function exportProjectAsHtml(id) {
    const p = library.projects.find(x => x.id === id);
    if (!p) return;
    if (state.id === id) captureCurrentContent();
    const html = buildDeckHtml({ standalone: true, project: p });
    download(html, safeFilename(p.name || p.title || 'presentation') + '.html', 'text/html');
  }

  // -------- Markdown export --------
  async function exportProjectAsMarkdown(id) {
    const p = library.projects.find(x => x.id === id);
    if (!p) return;
    if (state.id === id) captureCurrentContent();
    if (typeof TurndownService === 'undefined') {
      alert('Markdown converter (turndown) failed to load — check your network.');
      return;
    }

    // Pull every data: URI off the slides into a sibling assets/ folder so
    // the .md stays human-readable. If nothing inlined, just download .md.
    const assets = new Map(); // dataUri → { path, mime, base64 }
    const counter = { n: 1 };
    const slidesForExport = p.slides.map(s => extractDataUriAssets(s, assets, counter));
    const projectForExport = { ...p, slides: slidesForExport };
    const md = projectToMarkdown(projectForExport);
    const baseName = safeFilename(p.name || p.title || 'presentation');

    if (assets.size === 0) {
      download(md, baseName + '.md', 'text/markdown');
      return;
    }
    if (typeof JSZip === 'undefined') {
      alert('JSZip not loaded — cannot bundle markdown with images.');
      return;
    }
    const zip = new JSZip();
    zip.file(baseName + '.md', md);
    for (const asset of assets.values()) {
      zip.file(asset.path, asset.base64, { base64: true });
    }
    const blob = await zip.generateAsync({ type: 'blob' });
    download(blob, baseName + '.md.zip', 'application/zip');
  }

  function extractDataUriAssets(slide, assetMap, counter) {
    const next = { ...slide };
    if (slide.content) {
      const wrap = document.createElement('div');
      wrap.innerHTML = slide.content;
      wrap.querySelectorAll('img[src^="data:"]').forEach(img => {
        const a = ensureAsset(img.getAttribute('src') || '', assetMap, counter);
        if (a) img.setAttribute('src', a.path);
      });
      next.content = wrap.innerHTML;
    }
    if (slide.background && slide.background.value
        && /^data:/.test(slide.background.value)
        && (slide.background.type === 'image' || slide.background.type === 'video')) {
      const a = ensureAsset(slide.background.value, assetMap, counter);
      if (a) next.background = { ...slide.background, value: a.path };
    }
    return next;
  }

  function ensureAsset(dataUri, assetMap, counter) {
    if (assetMap.has(dataUri)) return assetMap.get(dataUri);
    const m = dataUri.match(/^data:([^;,]+)(?:;[^,]*)?;base64,(.+)$/);
    if (!m) return null;
    const mime = m[1];
    const base64 = m[2];
    const ext = mimeToExt(mime);
    const asset = { path: `assets/img-${counter.n++}.${ext}`, mime, base64 };
    assetMap.set(dataUri, asset);
    return asset;
  }

  function mimeToExt(mime) {
    switch (mime) {
      case 'image/jpeg': case 'image/jpg': return 'jpg';
      case 'image/png': return 'png';
      case 'image/gif': return 'gif';
      case 'image/webp': return 'webp';
      case 'image/svg+xml': return 'svg';
      case 'video/mp4': return 'mp4';
      case 'video/webm': return 'webm';
      default: return 'bin';
    }
  }

  function extToMime(ext) {
    switch ((ext || '').toLowerCase()) {
      case 'jpg': case 'jpeg': return 'image/jpeg';
      case 'png': return 'image/png';
      case 'gif': return 'image/gif';
      case 'webp': return 'image/webp';
      case 'svg': return 'image/svg+xml';
      case 'mp4': return 'video/mp4';
      case 'webm': return 'video/webm';
      default: return 'application/octet-stream';
    }
  }

  // -------- PDF export (via reveal's built-in print-pdf mode) --------
  const PDF_PAYLOAD_KEY = 'reveal-editor:pdf-payload';

  function exportProjectAsPdf(id) {
    const p = library.projects.find(x => x.id === id);
    if (!p) return;
    if (state.id === id) captureCurrentContent();

    const payload = {
      type: 'render-deck',
      version: REVEAL_VERSION,
      theme: p.theme,
      title: p.title || p.name || 'Presentation',
      sections: buildSections(p.slides),
      printMode: true,
      config: { ...defaultRevealConfig(), ...(p.config || {}) },
    };
    try {
      sessionStorage.setItem(PDF_PAYLOAD_KEY, JSON.stringify(payload));
    } catch (e) {
      alert('Could not stage PDF payload: ' + (e && e.message));
      return;
    }
    const win = window.open('preview.html?print-pdf=1', '_blank');
    if (!win) {
      alert('Popup blocked — allow pop-ups for this site, then try again.');
    }
  }

  function projectToMarkdown(p) {
    const td = new TurndownService({
      headingStyle: 'atx',
      codeBlockStyle: 'fenced',
      bulletListMarker: '-',
      // Use *** for <hr> so it can't be confused with reveal's `---` slide
      // separator.
      hr: '***',
      emDelimiter: '*',
    });
    td.keep(['iframe', 'video', 'audio']);

    const blocks = [];
    p.slides.forEach((s, i) => {
      if (i > 0) blocks.push(s.vertical ? '--' : '---');
      blocks.push(slideToMarkdown(s, td));
    });
    return blocks.join('\n\n') + '\n';
  }

  function slideToMarkdown(s, td) {
    const parts = [];
    const attrs = [];
    if (s.transition) attrs.push(`data-transition="${s.transition}"`);
    if (s.background && s.background.type && s.background.value) {
      const k = s.background.type === 'color' ? 'data-background'
        : `data-background-${s.background.type}`;
      attrs.push(`${k}="${s.background.value.replace(/"/g, '&quot;')}"`);
    }
    if (attrs.length) parts.push(`<!-- .slide: ${attrs.join(' ')} -->`);

    const body = td.turndown(s.content || '').trim();
    if (body) parts.push(body);

    const notes = (s.notes || '').trim();
    if (notes) parts.push('Note: ' + notes);

    return parts.join('\n\n');
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
    clearHistory();
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
    clearHistory();
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
    recordTombstone(id);
    if (library.projects.length === 0) {
      const fresh = blankProject();
      library.projects.push(fresh);
      state = fresh;
      library.currentProjectId = fresh.id;
      markDirty(fresh.id);
      clearHistory();
      renderAll();
    } else if (state.id === id) {
      state = library.projects[Math.max(0, idx - 1)];
      library.currentProjectId = state.id;
      clearHistory();
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
      config: p.config,
      // Preserve timestamps so the per-project last-write-wins merge in sync
      // actually compares the correct values. Without these, a pulled project
      // gets stamped Date.now() by normalizeProject and always looks "newer"
      // than the local in-progress version — overwriting unsaved edits.
      createdAt: p.createdAt,
      modifiedAt: p.modifiedAt,
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
        } else if (/\.(md|markdown)$/i.test(f.name) || f.type === 'text/markdown') {
          await importMarkdownFile(f);
          added++;
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
    // Preserve the original ID if present — required for cross-machine sync
    // to recognize this as the same project. Only allocate a fresh ID if the
    // file has none, or if the ID collides with an existing local project
    // (in which case treat as a deliberate duplicate).
    const incomingId = data.id;
    const collides = incomingId && library.projects.some(p => p.id === incomingId);
    const id = (incomingId && !collides) ? incomingId : uid();
    const p = normalizeProject({ ...data, id }, file.name.replace(/\.json$/i, ''));
    if (!p) throw new Error('Not a valid project file');
    library.projects.push(p);
    markDirty(p.id);
  }

  async function importMarkdownFile(file) {
    if (typeof marked === 'undefined') {
      throw new Error('Markdown parser (marked) not loaded');
    }
    const text = await file.text();
    const slides = parseMarkdownDeck(text);
    if (slides.length === 0) throw new Error('No slides found in markdown');
    const name = file.name.replace(/\.(md|markdown)$/i, '');
    const now = Date.now();
    const p = normalizeProject({
      id: uid(),
      name,
      title: name,
      theme: (state && state.theme) || 'black',
      slides,
      currentId: slides[0].id,
      createdAt: now,
      modifiedAt: now,
    }, name);
    if (!p) throw new Error('Failed to build project from markdown');
    library.projects.push(p);
    markDirty(p.id);
  }

  // -------- Markdown deck parsing --------
  function parseMarkdownDeck(text) {
    const slides = [];
    let buf = [];
    let nextVertical = false;

    const commit = () => {
      const chunk = buf.join('\n');
      if (chunk.trim() || slides.length > 0) {
        slides.push(parseMarkdownSlide(chunk, nextVertical));
      }
      buf = [];
    };

    const lines = text.split(/\r?\n/);
    for (const line of lines) {
      if (/^\s*---\s*$/.test(line)) {
        commit();
        nextVertical = false;
      } else if (/^\s*--\s*$/.test(line)) {
        commit();
        nextVertical = true;
      } else {
        buf.push(line);
      }
    }
    commit();
    return slides;
  }

  function parseMarkdownSlide(chunk, vertical) {
    const slide = newSlide('');
    slide.vertical = !!vertical;

    let body = chunk.replace(/^\s+|\s+$/g, '');

    const attrMatch = body.match(/^<!--\s*\.slide:\s*([^]*?)\s*-->\s*/);
    if (attrMatch) {
      applyMarkdownSlideAttrs(attrMatch[1], slide);
      body = body.slice(attrMatch[0].length);
    }

    // Pull off `Note: ...` (consumes to end — multi-line speaker notes are fine).
    const noteMatch = body.match(/(^|\n)Note:\s*([^]*)$/);
    if (noteMatch) {
      slide.notes = noteMatch[2].trim();
      body = body.slice(0, noteMatch.index).replace(/\s+$/, '');
    }

    slide.content = body.trim() ? marked.parse(body) : '';
    return slide;
  }

  function applyMarkdownSlideAttrs(attrStr, slide) {
    const re = /([\w-]+)\s*=\s*"([^"]*)"/g;
    let m;
    while ((m = re.exec(attrStr)) !== null) {
      const key = m[1];
      const val = m[2].replace(/&quot;/g, '"');
      if (key === 'data-transition') {
        slide.transition = val;
      } else if (key === 'data-background') {
        slide.background = { type: 'color', value: val };
      } else if (key.startsWith('data-background-')) {
        const type = key.slice('data-background-'.length);
        if (type === 'color' || type === 'image' || type === 'video' || type === 'iframe') {
          slide.background = { type, value: val };
        }
      }
    }
  }

  async function importZip(file) {
    if (typeof JSZip === 'undefined') {
      throw new Error('JSZip not loaded');
    }
    const zip = await JSZip.loadAsync(file);
    const all = Object.values(zip.files).filter(e => !e.dir);
    const mdEntries = all.filter(e => /\.(md|markdown)$/i.test(e.name));
    if (mdEntries.length > 0) {
      return await importMarkdownZipEntries(zip, mdEntries, all);
    }
    const jsonEntries = all.filter(e => /\.json$/i.test(e.name));
    let count = 0;
    for (const entry of jsonEntries) {
      try {
        const text = await entry.async('string');
        const data = JSON.parse(text);
        const incomingId = data.id;
        const collides = incomingId && library.projects.some(p => p.id === incomingId);
        const id = (incomingId && !collides) ? incomingId : uid();
        const p = normalizeProject({ ...data, id }, entry.name.replace(/\.json$/i, ''));
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

  async function importMarkdownZipEntries(zip, mdEntries, allEntries) {
    if (typeof marked === 'undefined') {
      throw new Error('Markdown parser (marked) not loaded');
    }
    // Pre-load every non-md entry as a possible asset, keyed by its path.
    const assetMap = new Map();
    for (const entry of allEntries) {
      if (/\.(md|markdown)$/i.test(entry.name)) continue;
      try {
        const base64 = await entry.async('base64');
        const ext = (entry.name.split('.').pop() || '').toLowerCase();
        const mime = extToMime(ext);
        assetMap.set(entry.name, `data:${mime};base64,${base64}`);
      } catch {
        // Skip unreadable entries.
      }
    }
    let count = 0;
    for (const entry of mdEntries) {
      try {
        const text = await entry.async('string');
        const slides = parseMarkdownDeck(text);
        if (slides.length === 0) continue;
        slides.forEach(s => reinlineSlideAssets(s, assetMap));
        const name = entry.name
          .replace(/^.*\//, '')
          .replace(/\.(md|markdown)$/i, '');
        const now = Date.now();
        const p = normalizeProject({
          id: uid(),
          name,
          title: name,
          theme: (state && state.theme) || 'black',
          slides,
          currentId: slides[0].id,
          createdAt: now,
          modifiedAt: now,
        }, name);
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

  function reinlineSlideAssets(slide, assetMap) {
    if (slide.content) {
      const wrap = document.createElement('div');
      wrap.innerHTML = slide.content;
      let changed = false;
      wrap.querySelectorAll('img[src]').forEach(img => {
        const src = img.getAttribute('src') || '';
        if (/^(https?:|data:|blob:|\/)/i.test(src)) return;
        if (assetMap.has(src)) {
          img.setAttribute('src', assetMap.get(src));
          changed = true;
        }
      });
      if (changed) slide.content = wrap.innerHTML;
    }
    if (slide.background && slide.background.value
        && !/^(https?:|data:|blob:|\/)/i.test(slide.background.value)
        && assetMap.has(slide.background.value)) {
      slide.background = { ...slide.background, value: assetMap.get(slide.background.value) };
    }
  }

  // -------- Reveal.js settings (per-project Reveal.initialize options) --------
  // Curated subset of https://revealjs.com/config/ — most commonly tweaked
  // options. Excludes ones we control ourselves (hash, embedded, plugins,
  // print/PDF) or that don't make sense in this editor's context.
  const REVEAL_OPTIONS = [
    { section: 'Navigation' },
    { key: 'controls', label: 'Show navigation controls', type: 'boolean', default: true },
    { key: 'progress', label: 'Show progress bar', type: 'boolean', default: true },
    { key: 'slideNumber', label: 'Slide number', type: 'select', default: false,
      help: 'Display the current slide number in a corner',
      options: [
        { value: false, label: 'Off' },
        { value: true, label: 'On (h.v / h)' },
        { value: 'h.v', label: 'h.v' },
        { value: 'h/v', label: 'h/v' },
        { value: 'c', label: 'flattened (c)' },
        { value: 'c/t', label: 'flattened (c/t)' },
      ] },
    { key: 'keyboard', label: 'Keyboard navigation', type: 'boolean', default: true },
    { key: 'touch', label: 'Touch navigation', type: 'boolean', default: true },
    { key: 'mouseWheel', label: 'Mouse wheel navigation', type: 'boolean', default: false },
    { key: 'overview', label: 'Overview mode (O key)', type: 'boolean', default: true },
    { key: 'loop', label: 'Loop slides', type: 'boolean', default: false },
    { key: 'center', label: 'Vertically center slides', type: 'boolean', default: true },
    { key: 'rtl', label: 'Right-to-left direction', type: 'boolean', default: false,
      help: 'Reverses horizontal slide navigation (Arabic, Hebrew, etc.)' },
    { key: 'navigationMode', label: 'Navigation mode', type: 'select', default: 'default',
      help: 'How keyboard and controls walk the deck',
      options: [
        { value: 'default', label: 'default (horizontal + vertical)' },
        { value: 'linear', label: 'linear (horizontal only)' },
        { value: 'grid', label: 'grid (2D navigation)' },
      ] },
    { key: 'previewLinks', label: 'Open external links in a preview iframe', type: 'boolean', default: false },

    { section: 'Transitions' },
    { key: 'transition', label: 'Default slide transition', type: 'select', default: 'slide',
      options: ['none', 'fade', 'slide', 'convex', 'concave', 'zoom'].map(v => ({ value: v, label: v })) },
    { key: 'transitionSpeed', label: 'Transition speed', type: 'select', default: 'default',
      options: ['default', 'fast', 'slow'].map(v => ({ value: v, label: v })) },
    { key: 'backgroundTransition', label: 'Background transition', type: 'select', default: 'fade',
      options: ['none', 'fade', 'slide', 'convex', 'concave', 'zoom'].map(v => ({ value: v, label: v })) },

    { section: 'Auto-advance' },
    { key: 'autoSlide', label: 'Auto-advance interval (ms, 0 = off)', type: 'number', default: 0, min: 0, step: 100 },
    { key: 'autoSlideStoppable', label: 'Stop auto-advance on user input', type: 'boolean', default: true },

    { section: 'Layout' },
    { key: 'width', label: 'Slide width (px)', type: 'number', default: 960, min: 200 },
    { key: 'height', label: 'Slide height (px)', type: 'number', default: 700, min: 200 },
    { key: 'margin', label: 'Slide margin (0–1)', type: 'number', default: 0.04, min: 0, max: 0.5, step: 0.01 },
  ];

  function defaultRevealConfig() {
    const cfg = {};
    REVEAL_OPTIONS.forEach(opt => { if (opt.key) cfg[opt.key] = opt.default; });
    return cfg;
  }

  function openSettingsModal() {
    renderSettingsForm();
    els.settingsModal.hidden = false;
  }

  function closeSettingsModal() {
    els.settingsModal.hidden = true;
    endTextEditSession();
  }

  function renderSettingsForm() {
    const cfg = state.config || (state.config = defaultRevealConfig());
    const form = els.settingsForm;
    form.innerHTML = '';
    REVEAL_OPTIONS.forEach(opt => {
      if (opt.section) {
        const h = document.createElement('h4');
        h.textContent = opt.section;
        form.appendChild(h);
        return;
      }
      const row = document.createElement('div');
      row.className = 'settings-row';
      const label = document.createElement('label');
      label.htmlFor = `cfg-${opt.key}`;
      label.textContent = opt.label;
      if (opt.help) {
        const help = document.createElement('span');
        help.className = 'help';
        help.textContent = opt.help;
        label.appendChild(help);
      }
      row.appendChild(label);

      const input = makeConfigInput(opt, cfg[opt.key]);
      input.id = `cfg-${opt.key}`;
      input.addEventListener('change', () => {
        snapshotForTextField('settings');
        cfg[opt.key] = readConfigInput(opt, input);
        scheduleSave();
      });
      row.appendChild(input);
      form.appendChild(row);
    });
  }

  function makeConfigInput(opt, value) {
    if (opt.type === 'boolean') {
      const el = document.createElement('input');
      el.type = 'checkbox';
      el.checked = !!value;
      return el;
    }
    if (opt.type === 'select') {
      const el = document.createElement('select');
      opt.options.forEach(o => {
        const option = document.createElement('option');
        // Stringify value so booleans/numbers survive the round trip.
        option.value = JSON.stringify(o.value);
        option.textContent = o.label;
        if (o.value === value) option.selected = true;
        el.appendChild(option);
      });
      return el;
    }
    // number
    const el = document.createElement('input');
    el.type = 'number';
    if (typeof opt.min === 'number') el.min = String(opt.min);
    if (typeof opt.max === 'number') el.max = String(opt.max);
    if (typeof opt.step === 'number') el.step = String(opt.step);
    el.value = value;
    return el;
  }

  function readConfigInput(opt, input) {
    if (opt.type === 'boolean') return input.checked;
    if (opt.type === 'select') return JSON.parse(input.value);
    const n = parseFloat(input.value);
    return Number.isFinite(n) ? n : opt.default;
  }

  function resetSettings() {
    if (!confirm('Reset all reveal.js settings for this deck to their defaults?')) return;
    snapshotForTextField('settings');
    state.config = defaultRevealConfig();
    renderSettingsForm();
    scheduleSave();
  }

  // -------- Projects modal --------
  function openProjectsModal() {
    captureCurrentContent();
    saveLibrary();
    renderProjectsList();
    refreshRemoteProjectsList();
    els.projectsModal.hidden = false;
  }

  function closeProjectsModal() {
    els.projectsModal.hidden = true;
  }

  // -------- Gist contents in Projects modal --------
  async function refreshRemoteProjectsList() {
    const section = els.projectsRemoteSection;
    if (sync.status === 'off' || !sync.gistId) {
      section.hidden = true;
      return;
    }
    section.hidden = false;
    els.projectsRemoteStatus.textContent = 'Fetching gist…';
    els.projectsRemoteList.innerHTML = '';
    try {
      const remote = await gistGet(sync.gistId);
      const files = remote.files || {};
      const items = [];
      for (const name of Object.keys(files)) {
        if (name === SYNC_LIBRARY_FILE) continue;
        const file = files[name];
        let parsed = null;
        try { parsed = JSON.parse(file.content); } catch {}
        if (!parsed) continue;
        const idFromName = name.replace(/\.json$/i, '');
        const id = parsed.id || idFromName;
        items.push({
          id,
          filename: name,
          name: parsed.name || parsed.title || '(untitled)',
          title: parsed.title || parsed.name || '(untitled)',
          modifiedAt: parsed.modifiedAt || 0,
          slideCount: Array.isArray(parsed.slides) ? parsed.slides.length : 0,
        });
      }
      items.sort((a, b) => (b.modifiedAt || 0) - (a.modifiedAt || 0));
      renderRemoteProjects(items);
    } catch (e) {
      els.projectsRemoteStatus.textContent = 'Failed to fetch gist: ' + (e.message || e);
      els.projectsRemoteList.innerHTML = '';
    }
  }

  function renderRemoteProjects(items) {
    const list = els.projectsRemoteList;
    list.innerHTML = '';
    if (items.length === 0) {
      els.projectsRemoteStatus.textContent = 'No projects on the gist yet.';
      return;
    }
    const localById = new Map(library.projects.map(p => [p.id, p]));
    // Index local projects by lowercased name for duplicate detection.
    const localByName = new Map();
    for (const lp of library.projects) {
      const key = (lp.name || lp.title || '').trim().toLowerCase();
      if (!key) continue;
      if (!localByName.has(key)) localByName.set(key, []);
      localByName.get(key).push(lp);
    }

    let matches = 0, orphans = 0, dupes = 0;
    for (const r of items) {
      const li = document.createElement('li');
      const local = localById.get(r.id);
      const nameKey = (r.name || '').trim().toLowerCase();
      const sameNameLocals = localByName.get(nameKey) || [];
      const sameNameDifferentId = sameNameLocals.some(lp => lp.id !== r.id);

      const name = document.createElement('div');
      name.className = 'proj-name';
      name.textContent = r.title || r.name;
      name.title = r.name;
      // Make it look like text (not editable) — it's read-only here.
      name.style.background = 'transparent';
      name.style.border = '1px solid transparent';

      const meta = document.createElement('div');
      meta.className = 'proj-meta';
      const idSpan = document.createElement('span');
      idSpan.className = 'proj-id';
      idSpan.textContent = `id ${r.id.slice(0, 8)}…`;
      idSpan.title = r.id;
      meta.textContent = `${r.slideCount} slide${r.slideCount === 1 ? '' : 's'} · ${formatRelative(r.modifiedAt)} · `;
      meta.appendChild(idSpan);

      const tag = document.createElement('span');
      tag.className = 'proj-tag';
      if (local) {
        tag.classList.add('match');
        tag.textContent = 'synced';
        matches++;
      } else if (sameNameDifferentId) {
        tag.classList.add('duplicate');
        tag.textContent = 'duplicate id';
        dupes++;
      } else {
        tag.classList.add('orphan');
        tag.textContent = 'remote only';
        orphans++;
      }
      name.appendChild(tag);

      li.appendChild(name);
      li.appendChild(meta);
      list.appendChild(li);
    }
    const parts = [`${items.length} project${items.length === 1 ? '' : 's'} on gist`];
    if (matches) parts.push(`${matches} synced`);
    if (dupes) parts.push(`${dupes} same-name but different id`);
    if (orphans) parts.push(`${orphans} remote-only`);
    els.projectsRemoteStatus.textContent = parts.join(' · ');
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

    const exportJsonBtn = document.createElement('button');
    exportJsonBtn.type = 'button';
    exportJsonBtn.textContent = '.json';
    exportJsonBtn.title = 'Download as .json (re-importable project file)';
    exportJsonBtn.addEventListener('click', () => exportProjectAsJson(p.id));

    const exportHtmlBtn = document.createElement('button');
    exportHtmlBtn.type = 'button';
    exportHtmlBtn.textContent = '.html';
    exportHtmlBtn.title = 'Download as standalone reveal.js HTML';
    exportHtmlBtn.addEventListener('click', () => exportProjectAsHtml(p.id));

    const exportMdBtn = document.createElement('button');
    exportMdBtn.type = 'button';
    exportMdBtn.textContent = '.md';
    exportMdBtn.title = 'Download as reveal.js Markdown';
    exportMdBtn.addEventListener('click', () => exportProjectAsMarkdown(p.id));

    const exportPdfBtn = document.createElement('button');
    exportPdfBtn.type = 'button';
    exportPdfBtn.textContent = '.pdf';
    exportPdfBtn.title = 'Open print-to-PDF view in a new tab';
    exportPdfBtn.addEventListener('click', () => exportProjectAsPdf(p.id));

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'danger';
    delBtn.textContent = '×';
    delBtn.title = 'Delete project';
    delBtn.addEventListener('click', () => deleteProject(p.id));

    actions.appendChild(openBtn);
    actions.appendChild(dupBtn);
    actions.appendChild(exportJsonBtn);
    actions.appendChild(exportHtmlBtn);
    actions.appendChild(exportMdBtn);
    actions.appendChild(exportPdfBtn);
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
      // Light mode shows a moon (click to go dark); dark mode shows a sun
      // (click to go light). Phosphor icon classes are toggled on the <i>.
      const icon = els.themeToggle.querySelector('i');
      if (icon) {
        icon.classList.toggle('ph-moon', light);
        icon.classList.toggle('ph-sun', !light);
      }
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

  // -------- Sync via GitHub Gist --------
  const SYNC_STORAGE = {
    pat: 'reveal-editor:sync:pat',
    gistId: 'reveal-editor:sync:gist',
    lastSync: 'reveal-editor:sync:lastSync',
  };
  const SYNC_LIBRARY_FILE = '_library.json';
  const SYNC_AUTO_PUSH_MS = 3000;

  const sync = {
    pat: null,
    gistId: null,
    status: 'off',     // 'off' | 'idle' | 'syncing' | 'error'
    lastSync: null,
    error: null,
    pushTimer: null,
    inFlight: null,
  };

  function loadSyncConfig() {
    try {
      sync.pat = localStorage.getItem(SYNC_STORAGE.pat) || null;
      sync.gistId = localStorage.getItem(SYNC_STORAGE.gistId) || null;
      const last = localStorage.getItem(SYNC_STORAGE.lastSync);
      sync.lastSync = last ? parseInt(last, 10) : null;
    } catch {}
    sync.status = (sync.pat && sync.gistId) ? 'idle' : 'off';
    updateSyncPill();
  }

  function persistSyncConfig() {
    try {
      if (sync.pat) localStorage.setItem(SYNC_STORAGE.pat, sync.pat);
      else localStorage.removeItem(SYNC_STORAGE.pat);
      if (sync.gistId) localStorage.setItem(SYNC_STORAGE.gistId, sync.gistId);
      else localStorage.removeItem(SYNC_STORAGE.gistId);
      if (sync.lastSync) localStorage.setItem(SYNC_STORAGE.lastSync, String(sync.lastSync));
      else localStorage.removeItem(SYNC_STORAGE.lastSync);
    } catch {}
  }

  function syncDisconnect() {
    sync.pat = null;
    sync.gistId = null;
    sync.lastSync = null;
    sync.status = 'off';
    sync.error = null;
    persistSyncConfig();
    updateSyncPill();
    renderSyncModal();
  }

  const SYNC_ICONS = {
    off: 'ph-cloud-slash',
    syncing: 'ph-spinner-gap',
    error: 'ph-cloud-warning',
    ok: 'ph-cloud-check',
    idle: 'ph-cloud',
  };

  function updateSyncPill() {
    const pill = els.syncPill;
    pill.classList.remove('is-syncing', 'is-error', 'is-ok');
    let label, iconKey;
    if (sync.status === 'off') {
      label = 'Sync: off';
      iconKey = 'off';
    } else if (sync.status === 'syncing') {
      label = 'Syncing…';
      iconKey = 'syncing';
      pill.classList.add('is-syncing');
    } else if (sync.status === 'error') {
      label = 'Sync error';
      iconKey = 'error';
      pill.classList.add('is-error');
    } else {
      label = sync.lastSync ? `Synced ${formatRelative(sync.lastSync)}` : 'Sync: ready';
      const fresh = sync.lastSync && Date.now() - sync.lastSync < 60000;
      iconKey = fresh ? 'ok' : 'idle';
      if (fresh) pill.classList.add('is-ok');
    }
    const icon = pill.querySelector('.sync-icon');
    const labelEl = pill.querySelector('.sync-label');
    if (icon) {
      // Reset to base classes, then add the state icon.
      icon.className = 'ph sync-icon ' + SYNC_ICONS[iconKey];
    }
    if (labelEl) labelEl.textContent = label;
    else pill.textContent = label;
  }

  async function gistFetch(path, init = {}) {
    if (!sync.pat) throw new Error('No personal access token configured.');
    const r = await fetch(`https://api.github.com${path}`, {
      ...init,
      headers: {
        'Authorization': `Bearer ${sync.pat}`,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...(init.headers || {}),
      },
    });
    if (!r.ok) {
      const body = await r.text().catch(() => '');
      const msg = (() => {
        try { return JSON.parse(body).message; } catch { return body; }
      })();
      throw new Error(`GitHub API ${r.status}: ${msg || r.statusText}`);
    }
    if (r.status === 204) return null;
    return await r.json();
  }

  async function gistGet(id) { return gistFetch(`/gists/${id}`); }
  async function gistPatch(id, files) {
    return gistFetch(`/gists/${id}`, { method: 'PATCH', body: JSON.stringify({ files }) });
  }
  async function gistCreate(files, description) {
    return gistFetch('/gists', {
      method: 'POST',
      body: JSON.stringify({ description, public: false, files }),
    });
  }

  function buildLibraryGistFile() {
    return {
      content: JSON.stringify({
        version: 1,
        currentProjectId: library.currentProjectId,
        deletedIds: library.deletedIds || [],
        generatedAt: Date.now(),
      }, null, 2),
    };
  }

  function buildProjectGistFiles() {
    const files = {};
    for (const p of library.projects) {
      files[`${p.id}.json`] = { content: JSON.stringify(serializeProject(p), null, 2) };
    }
    return files;
  }

  function parseProjectFromGist(file, idFromFilename) {
    if (!file || typeof file.content !== 'string') return null;
    try {
      const data = JSON.parse(file.content);
      data.id = data.id || idFromFilename;
      return normalizeProject(data, data.name || data.title);
    } catch {
      return null;
    }
  }

  function parseLibraryGist(file) {
    if (!file || typeof file.content !== 'string') return { deletedIds: [], currentProjectId: null };
    try {
      const data = JSON.parse(file.content);
      return {
        deletedIds: Array.isArray(data.deletedIds) ? data.deletedIds : [],
        currentProjectId: data.currentProjectId || null,
      };
    } catch {
      return { deletedIds: [], currentProjectId: null };
    }
  }

  function mergeTombstones(local, remote) {
    const merged = new Map();
    for (const t of local) merged.set(t.id, t);
    for (const t of remote) {
      const ex = merged.get(t.id);
      if (!ex || (t.deletedAt || 0) > (ex.deletedAt || 0)) merged.set(t.id, t);
    }
    return Array.from(merged.values());
  }

  // Pull the gist and merge it with the local library.
  async function syncPull() {
    const remote = await gistGet(sync.gistId);
    const files = remote.files || {};
    const libFile = files[SYNC_LIBRARY_FILE];
    const remoteLib = parseLibraryGist(libFile);
    ensureDeletedIds();

    const remoteProjects = [];
    for (const name of Object.keys(files)) {
      if (name === SYNC_LIBRARY_FILE) continue;
      const idFromName = name.replace(/\.json$/i, '');
      const p = parseProjectFromGist(files[name], idFromName);
      if (p) remoteProjects.push(p);
    }

    const tombstones = mergeTombstones(library.deletedIds, remoteLib.deletedIds);
    const tombMap = new Map(tombstones.map(t => [t.id, t.deletedAt || 0]));

    const localById = new Map(library.projects.map(p => [p.id, p]));

    // Remove local projects whose remote tombstone is newer than local modifiedAt.
    for (const p of [...library.projects]) {
      const ts = tombMap.get(p.id);
      if (ts && ts > (p.modifiedAt || 0)) {
        const idx = library.projects.indexOf(p);
        if (idx >= 0) library.projects.splice(idx, 1);
        deleteProjectRecord(p.id);
        localById.delete(p.id);
      }
    }

    // Merge each remote project into local.
    for (const rp of remoteProjects) {
      const ts = tombMap.get(rp.id);
      if (ts && ts > (rp.modifiedAt || 0)) continue; // tombstoned newer than remote — skip
      const lp = localById.get(rp.id);
      if (!lp) {
        library.projects.push(rp);
        markDirty(rp.id);
      } else if ((rp.modifiedAt || 0) > (lp.modifiedAt || 0)) {
        // Replace local fields in place (state may still reference lp).
        Object.assign(lp, rp);
        if (state && state.id === lp.id) renderAll();
      }
    }

    // Make sure we still have a current project after deletions.
    if (library.projects.length === 0) {
      const fresh = blankProject();
      library.projects.push(fresh);
      state = fresh;
      library.currentProjectId = fresh.id;
      markDirty(fresh.id);
      renderAll();
    } else if (!library.projects.some(p => p.id === library.currentProjectId)) {
      state = library.projects[0];
      library.currentProjectId = state.id;
      renderAll();
    } else if (state) {
      // Refresh sidebar in case projects were added/removed.
      renderSidebar();
    }
    library.deletedIds = tombstones;
    metaDirty = true;
    await flushDirty();
  }

  // Push the local library to the gist, including null entries for files that
  // should be removed on the remote (tombstoned or renamed).
  async function syncPush(remoteSnapshot) {
    const files = buildProjectGistFiles();
    files[SYNC_LIBRARY_FILE] = buildLibraryGistFile();

    // Mark files to delete on remote: tombstoned IDs that still exist as files.
    if (remoteSnapshot && remoteSnapshot.files) {
      const localIds = new Set(library.projects.map(p => p.id));
      for (const name of Object.keys(remoteSnapshot.files)) {
        if (name === SYNC_LIBRARY_FILE) continue;
        const id = name.replace(/\.json$/i, '');
        if (!localIds.has(id)) files[name] = null;
      }
    } else {
      // No snapshot — best effort: delete tombstoned file names.
      for (const t of library.deletedIds || []) {
        files[`${t.id}.json`] = null;
      }
    }
    await gistPatch(sync.gistId, files);
  }

  async function syncNow({ silent = false } = {}) {
    if (sync.status === 'off') return;
    if (sync.inFlight) return sync.inFlight;
    if (sync.pushTimer) { clearTimeout(sync.pushTimer); sync.pushTimer = null; }
    sync.status = 'syncing';
    sync.error = null;
    updateSyncPill();
    renderSyncModal();
    captureCurrentContent();
    if (state) markDirty(state.id);
    await flushDirty();

    sync.inFlight = (async () => {
      try {
        // Pull first, then push the merged state — keeps both sides in lockstep.
        // On silent (auto) syncs, protect the open project from being clobbered
        // by remote state — prevents the user's in-progress edits from being
        // reverted mid-stream. Manual "Sync now" still replaces everything.
        const remoteBefore = await gistGet(sync.gistId);
        applyPulledGist(remoteBefore, { protectOpen: silent });
        await syncPush(remoteBefore);
        sync.lastSync = Date.now();
        sync.status = 'idle';
        sync.error = null;
        persistSyncConfig();
      } catch (e) {
        sync.status = 'error';
        sync.error = e.message || String(e);
        if (!silent) console.warn('sync failed:', e);
      } finally {
        sync.inFlight = null;
        updateSyncPill();
        renderSyncModal();
      }
    })();
    return sync.inFlight;
  }

  // Pulled-gist application split out so syncNow can reuse the fetched data.
  // `protectOpen` skips replacing the currently-open project even if remote
  // looks newer — protects in-progress edits from clock-skew or simultaneous
  // edits on another machine during an auto-push cycle.
  function applyPulledGist(remote, { protectOpen = false } = {}) {
    if (!remote || !remote.files) return;
    const files = remote.files;
    const remoteLib = parseLibraryGist(files[SYNC_LIBRARY_FILE]);
    ensureDeletedIds();

    const remoteProjects = [];
    for (const name of Object.keys(files)) {
      if (name === SYNC_LIBRARY_FILE) continue;
      const idFromName = name.replace(/\.json$/i, '');
      const p = parseProjectFromGist(files[name], idFromName);
      if (p) remoteProjects.push(p);
    }

    const tombstones = mergeTombstones(library.deletedIds, remoteLib.deletedIds);
    const tombMap = new Map(tombstones.map(t => [t.id, t.deletedAt || 0]));
    const localById = new Map(library.projects.map(p => [p.id, p]));
    const openId = state && state.id;

    for (const p of [...library.projects]) {
      if (protectOpen && p.id === openId) continue;
      const ts = tombMap.get(p.id);
      if (ts && ts > (p.modifiedAt || 0)) {
        const idx = library.projects.indexOf(p);
        if (idx >= 0) library.projects.splice(idx, 1);
        deleteProjectRecord(p.id);
        localById.delete(p.id);
      }
    }
    for (const rp of remoteProjects) {
      const ts = tombMap.get(rp.id);
      if (ts && ts > (rp.modifiedAt || 0)) continue;
      const lp = localById.get(rp.id);
      if (!lp) {
        library.projects.push(rp);
        markDirty(rp.id);
      } else if ((rp.modifiedAt || 0) > (lp.modifiedAt || 0)) {
        if (protectOpen && lp.id === openId) continue;
        Object.assign(lp, rp);
        if (state && state.id === lp.id) renderAll();
      }
    }
    if (library.projects.length === 0) {
      const fresh = blankProject();
      library.projects.push(fresh);
      state = fresh;
      library.currentProjectId = fresh.id;
      markDirty(fresh.id);
      renderAll();
    } else if (!library.projects.some(p => p.id === library.currentProjectId)) {
      state = library.projects[0];
      library.currentProjectId = state.id;
      renderAll();
    } else {
      renderSidebar();
    }
    library.deletedIds = tombstones;
    metaDirty = true;
  }

  // Hard-reset: replace the gist with local state, dropping anything remote-only.
  async function syncResetGist() {
    if (!confirm('Replace the remote gist with this browser\'s state? Anything on the gist that isn\'t local will be deleted.')) return;
    sync.status = 'syncing';
    updateSyncPill();
    renderSyncModal();
    try {
      const remote = await gistGet(sync.gistId);
      // Mark every existing remote file null, then add local files back.
      const files = {};
      for (const name of Object.keys(remote.files || {})) files[name] = null;
      Object.assign(files, buildProjectGistFiles(), { [SYNC_LIBRARY_FILE]: buildLibraryGistFile() });
      await gistPatch(sync.gistId, files);
      sync.lastSync = Date.now();
      sync.status = 'idle';
      sync.error = null;
      persistSyncConfig();
    } catch (e) {
      sync.status = 'error';
      sync.error = e.message || String(e);
    }
    updateSyncPill();
    renderSyncModal();
  }

  // Schedule a debounced push after local edits.
  function schedulePush() {
    if (sync.status === 'off') return;
    clearTimeout(sync.pushTimer);
    sync.pushTimer = setTimeout(() => {
      sync.pushTimer = null;
      syncNow({ silent: true });
    }, SYNC_AUTO_PUSH_MS);
  }

  // -------- Sync modal --------
  function openSyncModal() {
    renderSyncModal();
    els.syncModal.hidden = false;
  }

  function closeSyncModal() {
    els.syncModal.hidden = true;
  }

  function renderSyncModal() {
    const configured = !!(sync.pat && sync.gistId);
    els.syncSetup.hidden = configured;
    els.syncConnected.hidden = !configured;
    if (configured) {
      els.syncStatusText.textContent = sync.status;
      els.syncLast.textContent = sync.lastSync ? formatRelative(sync.lastSync) : 'never';
      els.syncGistLink.href = `https://gist.github.com/${sync.gistId}`;
      els.syncGistIdDisplay.textContent = sync.gistId;
      if (sync.error) {
        els.syncError.hidden = false;
        els.syncError.textContent = sync.error;
      } else {
        els.syncError.hidden = true;
        els.syncError.textContent = '';
      }
      els.syncNow.disabled = sync.status === 'syncing';
    } else {
      els.syncPat.value = '';
      els.syncGistId.value = '';
    }
  }

  async function syncConnect() {
    const pat = els.syncPat.value.trim();
    const gistId = els.syncGistId.value.trim();
    if (!pat) { alert('Paste a personal access token first.'); return; }
    sync.pat = pat;
    sync.gistId = gistId || null;
    sync.status = 'syncing';
    sync.error = null;
    updateSyncPill();
    try {
      // Validate the token by hitting /user.
      await gistFetch('/user');
      if (!sync.gistId) {
        const created = await gistCreate(
          { [SYNC_LIBRARY_FILE]: buildLibraryGistFile(), ...buildProjectGistFiles() },
          'Reveal Editor projects (sync)',
        );
        sync.gistId = created.id;
      }
      persistSyncConfig();
      sync.status = 'idle';
      renderSyncModal();
      await syncNow();
    } catch (e) {
      sync.pat = null;
      sync.gistId = gistId || null;
      sync.status = 'off';
      sync.error = e.message || String(e);
      persistSyncConfig();
      updateSyncPill();
      renderSyncModal();
      alert('Connection failed: ' + sync.error);
    }
  }

  // -------- Wiring --------
  function wire() {
    els.deckTitle.addEventListener('input', () => {
      snapshotForTextField('deckTitle');
      state.title = els.deckTitle.value;
      // Keep the project name (shown in the Projects list) aligned with the
      // deck title — users rename via either.
      state.name = els.deckTitle.value;
      scheduleSave();
    });
    els.deckTitle.addEventListener('blur', endTextEditSession);
    els.themeSelect.addEventListener('change', () => {
      recordHistory();
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
      if (btn === els.undoBtn) { undo(); return; }
      if (btn === els.redoBtn) { redo(); return; }
      const cmd = btn.dataset.cmd;
      const arg = btn.dataset.arg || null;
      const action = btn.dataset.action;
      if (cmd || action) recordHistory();
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

    els.transition.addEventListener('change', () => {
      recordHistory();
      currentSlide().transition = els.transition.value;
      scheduleSave();
    });
    els.bgType.addEventListener('change', () => {
      recordHistory();
      const slide = currentSlide();
      slide.background.type = els.bgType.value;
      if (!els.bgType.value) slide.background.value = '';
      refreshBgValueField();
      els.bgValue.value = slide.background.value || '';
      applyEditorBackground();
      scheduleSave();
    });
    els.bgValue.addEventListener('input', () => {
      snapshotForTextField('bgValue');
      currentSlide().background.value = els.bgValue.value;
      applyEditorBackground();
      scheduleSave();
    });
    els.bgValue.addEventListener('blur', endTextEditSession);
    els.vertical.addEventListener('change', () => {
      recordHistory();
      currentSlide().vertical = els.vertical.checked;
      renderSidebar();
      scheduleSave();
    });
    els.notes.addEventListener('input', () => {
      snapshotForTextField('notes');
      const slide = currentSlide();
      slide.notes = els.notes.value;
      if (isNotesPanelOpen() && els.notesPanelText.value !== slide.notes) {
        els.notesPanelText.value = slide.notes;
      }
      scheduleSave();
    });
    els.notes.addEventListener('blur', endTextEditSession);

    els.fileInput.addEventListener('change', () => {
      const file = els.fileInput.files && els.fileInput.files[0];
      const linkHref = els.fileInput.dataset.linkHref || null;
      delete els.fileInput.dataset.linkHref;
      if (file) insertImageFromFile(file, linkHref);
      els.fileInput.value = '';
    });

    $('#btn-preview').addEventListener('click', () => showPreview());
    $('#btn-preview-here').addEventListener('click', () => showPreview({ fromCurrent: true }));
    $('#btn-new').addEventListener('click', () => createProject());
    els.previewClose.addEventListener('click', closePreview);
    els.themeToggle.addEventListener('click', toggleUiTheme);
    els.notesPopout.addEventListener('click', toggleNotesPanel);
    els.notesPanelClose.addEventListener('click', closeNotesPanel);
    els.notesPanelText.addEventListener('input', () => {
      snapshotForTextField('notes');
      const slide = currentSlide();
      if (!slide) return;
      slide.notes = els.notesPanelText.value;
      if (els.notes.value !== slide.notes) els.notes.value = slide.notes;
      scheduleSave();
    });
    els.notesPanelText.addEventListener('blur', endTextEditSession);

    // About modal
    els.aboutButton.addEventListener('click', () => { els.aboutModal.hidden = false; });
    els.aboutClose.addEventListener('click', () => { els.aboutModal.hidden = true; });
    els.aboutModal.addEventListener('click', (e) => {
      if (e.target === els.aboutModal) els.aboutModal.hidden = true;
    });

    // Settings modal
    els.settingsButton.addEventListener('click', openSettingsModal);
    els.settingsClose.addEventListener('click', closeSettingsModal);
    els.settingsReset.addEventListener('click', resetSettings);
    els.settingsModal.addEventListener('click', (e) => {
      if (e.target === els.settingsModal) closeSettingsModal();
    });

    // Sync modal
    els.syncPill.addEventListener('click', openSyncModal);
    els.syncClose.addEventListener('click', closeSyncModal);
    els.syncModal.addEventListener('click', (e) => {
      if (e.target === els.syncModal) closeSyncModal();
    });
    els.syncConnect.addEventListener('click', syncConnect);
    els.syncNow.addEventListener('click', () => syncNow());
    els.syncCopyId.addEventListener('click', async () => {
      if (!sync.gistId) return;
      try {
        await navigator.clipboard.writeText(sync.gistId);
        const original = els.syncCopyId.textContent;
        els.syncCopyId.textContent = 'Copied';
        setTimeout(() => { els.syncCopyId.textContent = original; }, 1200);
      } catch {
        // Clipboard API needs a secure context or permission — fall back to
        // selecting the text so the user can copy it manually.
        const range = document.createRange();
        range.selectNodeContents(els.syncGistIdDisplay);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
      }
    });
    els.syncReset.addEventListener('click', syncResetGist);
    els.syncDisconnect.addEventListener('click', () => {
      if (confirm('Disconnect sync? The token and gist ID will be cleared from this browser. Your data and the gist itself stay where they are.')) {
        syncDisconnect();
      }
    });

    // Projects modal
    els.projectsButton.addEventListener('click', openProjectsModal);
    els.projectsClose.addEventListener('click', closeProjectsModal);
    els.projectsNew.addEventListener('click', newProject);
    els.projectsExportAll.addEventListener('click', exportAllAsZip);
    els.projectsRemoteRefresh.addEventListener('click', refreshRemoteProjectsList);
    els.projectsImportInput.addEventListener('change', () => {
      const files = els.projectsImportInput.files;
      if (files && files.length) importFiles(files);
      els.projectsImportInput.value = '';
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      const mod = e.metaKey || e.ctrlKey;
      const inEditor = e.target === els.editor || els.editor.contains(e.target);
      if (mod && e.key === 's') { e.preventDefault(); saveProject(); }
      else if (mod && e.shiftKey && e.key === 'Enter') { e.preventDefault(); addSlide(); }
      else if (mod && e.shiftKey && (e.key === 'P' || e.key === 'p')) {
        e.preventDefault(); showPreview({ fromCurrent: true });
      }
      else if (mod && e.key === 'p') { e.preventDefault(); showPreview(); }
      // Undo/redo: only when focus is OUTSIDE the slide editor, so the
      // browser's native contenteditable undo keeps working for typing.
      else if (mod && !inEditor && e.shiftKey && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault(); redo();
      }
      else if (mod && !inEditor && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault(); undo();
      }
      else if (mod && !inEditor && (e.key === 'y' || e.key === 'Y')) {
        e.preventDefault(); redo();
      }
      else if (e.key === 'Escape') {
        if (!els.slideMenu.hidden) hideSlideContextMenu();
        else if (!els.previewModal.hidden) closePreview();
        else if (!els.projectsModal.hidden) closeProjectsModal();
        else if (!els.settingsModal.hidden) closeSettingsModal();
        else if (!els.syncModal.hidden) closeSyncModal();
        else if (!els.aboutModal.hidden) els.aboutModal.hidden = true;
        else if (isNotesPanelOpen()) closeNotesPanel();
      }
    });

    // Dismiss the slide context menu on outside click, scroll, or window blur.
    document.addEventListener('mousedown', (e) => {
      if (els.slideMenu.hidden) return;
      if (!els.slideMenu.contains(e.target)) hideSlideContextMenu();
    });
    window.addEventListener('scroll', hideSlideContextMenu, true);
    window.addEventListener('blur', hideSlideContextMenu);

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
  loadSyncConfig();
  if (sync.status === 'idle') {
    // Auto-pull on load so this browser starts with the latest remote state.
    syncNow({ silent: true });
  }
})();
