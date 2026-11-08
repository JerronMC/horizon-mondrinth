(() => {
  'use strict';

  const API = 'https://api.modrinth.com/v2';
  const state = {
    activeTab: 'home',
    discoverySort: 'downloads',
    catalogue: { query: '', offset: 0, total: 0, loading: false, projects: [] },
    selectedProject: null,
    currentArchive: null,
    extractedEntries: [],
    sourceFile: null,
    sourceType: '',
    sourceReport: null,
    toastTimer: null
  };

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const els = {
    pages: $$('.page'),
    crumb: $('#pageCrumb'),
    homePopular: $('#homePopular'),
    discoveryResults: $('#discoveryResults'),
    discoveryCount: $('#discoveryCount'),
    catalogueResults: $('#catalogueResults'),
    catalogueCount: $('#catalogueCount'),
    catalogueHeading: $('#catalogueHeading'),
    catalogueSubheading: $('#catalogueSubheading'),
    loadMore: $('#loadMoreButton'),
    modal: $('#projectModal'),
    modalBody: $('#modalBody'),
    toast: $('#toast'),
    fileInput: $('#modFileInput'),
    fileStatus: $('#fileStatus'),
    inspectionReport: $('#inspectionReport'),
    preview: $('#manifestPreview code'),
    exportButton: $('#exportHmodButton'),
    exportFeedback: $('#exportFeedback')
  };

  const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const safeURL = value => {
    try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) ? url.href : ''; }
    catch { return ''; }
  };
  const compactNumber = value => {
    const n = Number(value || 0);
    if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
    if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
    if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
    return n.toLocaleString();
  };
  const humanDate = value => {
    if (!value) return 'Unknown date';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? 'Unknown date' : date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  };

  function showToast(message) {
    els.toast.textContent = message;
    els.toast.classList.add('show');
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(() => els.toast.classList.remove('show'), 2600);
  }

  function switchTab(tab) {
    if (!['home', 'discovery', 'modrinth', 'convert'].includes(tab)) return;
    state.activeTab = tab;
    els.pages.forEach(page => page.classList.toggle('active', page.dataset.page === tab));
    $$('.nav-item, .mobile-nav-item').forEach(button => button.classList.toggle('active', button.dataset.tab === tab));
    els.crumb.textContent = tab === 'convert' ? 'Convert' : tab === 'modrinth' ? 'Modrinth' : tab[0].toUpperCase() + tab.slice(1);
    window.scrollTo({ top: 0, behavior: 'smooth' });
    if (tab === 'discovery' && !els.discoveryResults.dataset.loaded) loadDiscovery(state.discoverySort);
    if (tab === 'modrinth' && !els.catalogueResults.dataset.loaded) searchCatalogue({ reset: true });
  }

  document.addEventListener('click', event => {
    const tabButton = event.target.closest('[data-tab]');
    if (tabButton) { event.preventDefault(); switchTab(tabButton.dataset.tab); }
  });

  function getFacets({ loader = '', version = '' } = {}) {
    const facets = [['project_type:mod']];
    if (loader) facets.push([`categories:${loader}`]);
    if (version) facets.push([`versions:${version}`]);
    return JSON.stringify(facets);
  }

  async function apiGet(path) {
    const response = await fetch(`${API}${path}`, { headers: { 'Accept': 'application/json' } });
    if (!response.ok) {
      let detail = '';
      try { const body = await response.json(); detail = body.description || body.error || ''; } catch { /* no response body */ }
      throw new Error(detail || `Modrinth API error (${response.status})`);
    }
    return response.json();
  }

  async function fetchProjects({ query = '', sort = 'downloads', loader = '', version = '', offset = 0, limit = 30 } = {}) {
    const params = new URLSearchParams({
      query,
      facets: getFacets({ loader, version }),
      index: sort,
      offset: String(offset),
      limit: String(limit)
    });
    return apiGet(`/search?${params.toString()}`);
  }

  function projectCard(project) {
    const icon = safeURL(project.icon_url);
    const tags = (project.display_categories || project.categories || []).slice(0, 3).map(tag => `<span class="tiny-tag">${escapeHTML(tag)}</span>`).join('');
    return `<article class="mod-card" data-project-id="${escapeHTML(project.project_id)}" tabindex="0" role="button" aria-label="View ${escapeHTML(project.title)}">
      <div class="mod-card-top">
        ${icon ? `<img class="mod-icon" src="${escapeHTML(icon)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : `<div class="mod-icon mod-icon-placeholder">${escapeHTML((project.title || '?').slice(0, 1).toUpperCase())}</div>`}
        <div class="mod-title-wrap"><div class="mod-title">${escapeHTML(project.title)}</div><div class="mod-author">by ${escapeHTML(project.author || 'Unknown author')}</div></div>
      </div>
      <p class="mod-desc">${escapeHTML(project.description || 'No description provided.')}</p>
      <div class="mod-card-meta"><span class="download-count"><span>↓</span>${compactNumber(project.downloads)} downloads</span><div class="tag-row">${tags || '<span class="tiny-tag">Minecraft mod</span>'}</div></div>
    </article>`;
  }

  function renderProjectGrid(container, projects, emptyText = 'No projects found. Try changing your filters.') {
    container.innerHTML = projects.length ? projects.map(projectCard).join('') : `<div class="empty-state">${escapeHTML(emptyText)}</div>`;
  }

  async function loadHomePopular() {
    try {
      const result = await fetchProjects({ sort: 'downloads', limit: 6 });
      renderProjectGrid(els.homePopular, result.hits || [], 'No popular projects are available right now.');
    } catch (error) {
      els.homePopular.innerHTML = `<div class="empty-state">${escapeHTML(error.message)}. Check your internet connection.</div>`;
    }
  }

  async function loadDiscovery(sort = 'downloads') {
    state.discoverySort = sort;
    $$('.segment').forEach(button => button.classList.toggle('active', button.dataset.discoverySort === sort));
    els.discoveryResults.innerHTML = '<div class="loading-card"><span class="loader"></span>Finding projects...</div>';
    els.discoveryResults.dataset.loaded = '';
    try {
      const result = await fetchProjects({ sort, limit: 30 });
      renderProjectGrid(els.discoveryResults, result.hits || []);
      els.discoveryResults.dataset.loaded = 'true';
      els.discoveryCount.textContent = `${compactNumber(result.total_hits)} results`;
    } catch (error) {
      els.discoveryResults.innerHTML = `<div class="empty-state">${escapeHTML(error.message)}. Please try again.</div>`;
    }
  }

  async function searchCatalogue({ reset = true } = {}) {
    if (state.catalogue.loading) return;
    if (reset) {
      state.catalogue.offset = 0;
      state.catalogue.projects = [];
    }
    const query = $('#modrinthQuery').value.trim();
    const loader = $('#loaderFilter').value;
    const version = $('#mcVersion').value;
    const sort = $('#catalogueSort').value;
    state.catalogue.loading = true;
    els.loadMore.hidden = true;
    els.catalogueResults.innerHTML = '<div class="loading-card"><span class="loader"></span>Searching the Modrinth catalogue...</div>';
    els.catalogueHeading.textContent = query ? `Results for “${query}”` : 'Explore mods';
    els.catalogueSubheading.textContent = [version && `Minecraft ${version}`, loader && loaderName(loader)].filter(Boolean).join(' · ') || 'Popular community projects from Modrinth';
    try {
      const result = await fetchProjects({ query, sort, loader, version, offset: state.catalogue.offset, limit: 30 });
      state.catalogue.total = result.total_hits || 0;
      state.catalogue.projects = reset ? (result.hits || []) : [...state.catalogue.projects, ...(result.hits || [])];
      renderProjectGrid(els.catalogueResults, state.catalogue.projects);
      els.catalogueResults.dataset.loaded = 'true';
      els.catalogueCount.textContent = `${compactNumber(state.catalogue.total)} projects`;
      els.loadMore.hidden = state.catalogue.projects.length >= state.catalogue.total || !state.catalogue.total;
    } catch (error) {
      els.catalogueResults.innerHTML = `<div class="empty-state">${escapeHTML(error.message)}. Check your connection or try again.</div>`;
      els.catalogueCount.textContent = 'Unavailable';
    } finally {
      state.catalogue.loading = false;
    }
  }

  function loaderName(value) {
    return ({ fabric: 'Fabric', forge: 'Forge', neoforge: 'NeoForge', quilt: 'Quilt', optifine: 'OptiFine', liteloader: 'LiteLoader', rift: 'Rift' })[value] || value;
  }

  async function hydrateModrinthFilters() {
    const versionSelect = $('#mcVersion');
    const selectedVersion = versionSelect.value;
    try {
      const versions = await apiGet('/tag/game_version');
      if (Array.isArray(versions) && versions.length) {
        const releases = versions.filter(item => item.version_type === 'release')
          .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
        const unique = [...new Set(releases.map(item => item.version))];
        versionSelect.innerHTML = '<option value="">All versions</option>' + unique.map(version => `<option value="${escapeHTML(version)}">${escapeHTML(version)}</option>`).join('');
        if (unique.includes(selectedVersion)) versionSelect.value = selectedVersion;
      }
    } catch { /* Keep the built-in version list if the tags endpoint is unavailable. */ }

    const loaderSelect = $('#loaderFilter');
    const selectedLoader = loaderSelect.value;
    try {
      const loaders = await apiGet('/tag/loader');
      if (Array.isArray(loaders) && loaders.length) {
        const modLoaders = loaders.filter(item => !Array.isArray(item.supported_project_types) || item.supported_project_types.includes('mod'))
          .map(item => String(item.name || '').toLowerCase()).filter(Boolean);
        const preferred = ['fabric', 'forge', 'neoforge', 'quilt', 'optifine', 'liteloader', 'rift'];
        const ordered = [...preferred.filter(name => modLoaders.includes(name)), ...modLoaders.filter(name => !preferred.includes(name)).sort()];
        const merged = [...new Set([...ordered, 'optifine'])];
        loaderSelect.innerHTML = '<option value="">All loaders</option>' + merged.map(name => `<option value="${escapeHTML(name)}">${escapeHTML(loaderName(name))}</option>`).join('');
        if (merged.includes(selectedLoader)) loaderSelect.value = selectedLoader;
      }
    } catch { /* Keep the built-in loader options as a fallback. */ }
  }

  $('#homeSearchForm').addEventListener('submit', event => {
    event.preventDefault();
    $('#modrinthQuery').value = $('#homeSearchInput').value.trim();
    switchTab('modrinth');
    searchCatalogue({ reset: true });
  });
  $('#modrinthSearchForm').addEventListener('submit', event => { event.preventDefault(); searchCatalogue({ reset: true }); });
  ['mcVersion', 'loaderFilter', 'catalogueSort'].forEach(id => $(`#${id}`).addEventListener('change', () => searchCatalogue({ reset: true })));
  $$('.segment').forEach(button => button.addEventListener('click', () => loadDiscovery(button.dataset.discoverySort)));
  els.loadMore.addEventListener('click', () => {
    state.catalogue.offset += 30;
    searchCatalogue({ reset: false });
  });

  document.addEventListener('click', event => {
    const card = event.target.closest('[data-project-id]');
    if (card) openProject(card.dataset.projectId);
  });
  document.addEventListener('keydown', event => {
    const card = event.target.closest?.('[data-project-id]');
    if (card && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); openProject(card.dataset.projectId); }
  });

  async function openProject(projectId) {
    state.selectedProject = projectId;
    els.modal.hidden = false;
    els.modalBody.innerHTML = '<div class="modal-loading"><span class="loader"></span><p>Loading project details...</p></div>';
    try {
      const project = await apiGet(`/project/${encodeURIComponent(projectId)}`);
      if (state.selectedProject !== projectId) return;
      const icon = safeURL(project.icon_url);
      const projectUrl = `https://modrinth.com/mod/${encodeURIComponent(project.slug || project.id)}`;
      els.modalBody.innerHTML = `<div class="modal-project-head">${icon ? `<img class="mod-icon" src="${escapeHTML(icon)}" alt="">` : `<div class="mod-icon mod-icon-placeholder">${escapeHTML((project.title || '?').slice(0, 1))}</div>`}<div><h2 id="modalTitle">${escapeHTML(project.title)}</h2><p>by ${escapeHTML(project.team || 'Modrinth creator')} · ${compactNumber(project.downloads)} downloads</p></div></div>
        <p class="modal-description">${escapeHTML(project.description || '')}</p>
        <div class="modal-actions"><a class="modal-primary" href="${escapeHTML(projectUrl)}" target="_blank" rel="noopener">Open on Modrinth ↗</a><a class="modal-secondary" href="${escapeHTML(projectUrl)}/versions" target="_blank" rel="noopener">All versions</a></div>
        <h3 class="modal-version-title">Available releases</h3><div class="version-list" id="projectVersionList"><div class="modal-loading"><span class="loader"></span>Checking releases...</div></div>`;
      loadProjectVersions(project.id, $('#loaderFilter').value, $('#mcVersion').value);
    } catch (error) {
      els.modalBody.innerHTML = `<div class="modal-loading">${escapeHTML(error.message)}</div>`;
    }
  }

  async function loadProjectVersions(projectId, loader, gameVersion) {
    const params = new URLSearchParams({ limit: '8' });
    if (loader) params.set('loaders', JSON.stringify([loader]));
    if (gameVersion) params.set('game_versions', JSON.stringify([gameVersion]));
    try {
      const versions = await apiGet(`/project/${encodeURIComponent(projectId)}/version?${params.toString()}`);
      const list = $('#projectVersionList');
      if (!list) return;
      if (!versions.length) {
        list.innerHTML = '<div class="empty-state">No releases match these filters. Open the project page to check other versions.</div>';
        return;
      }
      list.innerHTML = versions.map(version => {
        const file = version.files?.find(item => item.primary) || version.files?.[0];
        const fileURL = safeURL(file?.url);
        const mc = (version.game_versions || []).slice(0, 2).join(', ') || 'Any version';
        const loaders = (version.loaders || []).map(loaderName).join(', ') || 'Universal';
        return `<div class="version-item"><div class="version-info"><strong>${escapeHTML(version.name || version.version_number)}</strong><small>${escapeHTML(mc)} · ${escapeHTML(loaders)} · ${escapeHTML(version.version_type || 'release')}</small></div>${fileURL ? `<a class="version-download" href="${escapeHTML(fileURL)}" target="_blank" rel="noopener">Download ↓</a>` : '<span class="version-download">No file</span>'}</div>`;
      }).join('');
    } catch (error) {
      const list = $('#projectVersionList');
      if (list) list.innerHTML = `<div class="empty-state">Could not load releases: ${escapeHTML(error.message)}</div>`;
    }
  }

  $('#closeModalButton').addEventListener('click', () => { els.modal.hidden = true; state.selectedProject = null; });
  els.modal.addEventListener('click', event => { if (event.target === els.modal) { els.modal.hidden = true; state.selectedProject = null; } });
  document.addEventListener('keydown', event => { if (event.key === 'Escape') { els.modal.hidden = true; state.selectedProject = null; } });

  // ---------- Horizon manifest editor ----------
  const manifestFields = ['manifestId', 'manifestName', 'manifestVersion', 'manifestApi', 'manifestDescription', 'manifestAuthors', 'manifestSide', 'manifestCapabilities', 'manifestNamespaces'];
  const getField = id => $(`#${id}`).value.trim();
  const tomlString = value => `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '')}"`;
  const commaList = value => value.split(',').map(item => item.trim()).filter(Boolean);
  function makeManifest() {
    const id = getField('manifestId');
    const authors = commaList(getField('manifestAuthors'));
    const capabilities = commaList(getField('manifestCapabilities'));
    const namespaces = commaList(getField('manifestNamespaces'));
    const lines = [
      `id = ${tomlString(id)}`,
      `name = ${tomlString(getField('manifestName'))}`,
      `version = ${tomlString(getField('manifestVersion'))}`,
      `description = ${tomlString(getField('manifestDescription'))}`,
      `authors = [${authors.map(tomlString).join(', ')}]`,
      `api = ${tomlString(getField('manifestApi'))}`,
      `side = ${tomlString(getField('manifestSide'))}`,
      `capabilities = [${capabilities.map(tomlString).join(', ')}]`
    ];
    if (namespaces.length) lines.push(`namespaces = [${namespaces.map(tomlString).join(', ')}]`);
    return lines.join('\n') + '\n';
  }
  function validateManifest() {
    const id = getField('manifestId');
    const name = getField('manifestName');
    const version = getField('manifestVersion');
    if (!/^[a-z0-9_]{1,64}$/.test(id)) return 'Mod ID must be 1–64 lowercase letters, numbers, or underscores.';
    if (!name) return 'Mod name is required.';
    if (!version) return 'Version is required.';
    if (!commaList(getField('manifestCapabilities')).length) return 'Add at least one capability (for example: registries).';
    return '';
  }
  function refreshManifestPreview() {
    const manifest = makeManifest();
    els.preview.textContent = manifest.trimEnd();
    const error = validateManifest();
    els.exportButton.disabled = !state.currentArchive || Boolean(error);
    if (error) els.exportFeedback.textContent = error;
    else if (state.currentArchive) els.exportFeedback.textContent = 'Manifest looks ready. Review the compatibility report before exporting.';
    else els.exportFeedback.textContent = 'Upload a file to enable export.';
  }
  manifestFields.forEach(id => $(`#${id}`).addEventListener('input', refreshManifestPreview));

  $('#copyManifestButton').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(makeManifest());
      showToast('Horizon manifest copied.');
    } catch {
      const area = document.createElement('textarea'); area.value = makeManifest(); document.body.appendChild(area); area.select();
      try { document.execCommand('copy'); showToast('Horizon manifest copied.'); } catch { showToast('Copy is not available in this browser.'); }
      area.remove();
    }
  });

  function commonRootPrefix(entries) {
    const files = entries.filter(entry => !entry.dir).map(entry => entry.name);
    if (!files.length) return '';
    const firstSegments = files.map(name => name.split('/')[0]);
    const first = firstSegments[0];
    if (!first || ['assets', 'data', 'meta-inf'].includes(first.toLowerCase()) || firstSegments.some(segment => segment !== first) || files.some(name => !name.includes('/'))) return '';
    return `${first}/`;
  }

  function parseTomlString(value) {
    const match = value.match(/^"((?:\\.|[^"\\])*)"$/);
    if (!match) return value.trim();
    return match[1].replace(/\\n/g, '\n').replace(/\\r/g, '\r').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }
  function parseTomlArray(value) {
    const inner = value.trim().replace(/^\[/, '').replace(/\]$/, '').trim();
    if (!inner) return [];
    const matches = inner.match(/"(?:\\.|[^"\\])*"/g) || [];
    return matches.map(parseTomlString);
  }
  function parseManifest(text) {
    const values = {};
    for (const line of text.split(/\r?\n/)) {
      const match = line.match(/^\s*([a-zA-Z0-9_]+)\s*=\s*(.*?)\s*(?:#.*)?$/);
      if (!match) continue;
      values[match[1]] = match[2];
    }
    const stringFields = { id: 'manifestId', name: 'manifestName', version: 'manifestVersion', api: 'manifestApi', description: 'manifestDescription', side: 'manifestSide' };
    for (const [key, id] of Object.entries(stringFields)) if (values[key]) $(`#${id}`).value = parseTomlString(values[key]);
    for (const [key, id] of Object.entries({ authors: 'manifestAuthors', capabilities: 'manifestCapabilities', namespaces: 'manifestNamespaces' })) {
      if (values[key]) $(`#${id}`).value = parseTomlArray(values[key]).join(', ');
    }
  }

  async function inspectArchive(file) {
    if (!window.JSZip) throw new Error('The ZIP reader did not load. Connect to the internet and refresh this page.');
    const extension = file.name.split('.').pop().toLowerCase();
    if (!['jar', 'zip', 'hmod'].includes(extension)) throw new Error('Choose a .jar, .zip, or .hmod file.');
    const archive = await JSZip.loadAsync(file, { checkCRC32: false });
    const entries = Object.values(archive.files);
    const rootPrefix = commonRootPrefix(entries);
    const normalized = entries.map(entry => ({ entry, name: rootPrefix && entry.name.startsWith(rootPrefix) ? entry.name.slice(rootPrefix.length) : entry.name }));
    const manifestEntry = normalized.find(item => !item.entry.dir && item.name.toLowerCase() === 'horizon-mod.toml');
    if (manifestEntry) {
      const manifestText = await manifestEntry.entry.async('text');
      parseManifest(manifestText);
    } else {
      const base = file.name.replace(/\.(jar|zip|hmod)$/i, '').toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 55) || 'converted_mod';
      $('#manifestId').value = base;
      $('#manifestName').value = file.name.replace(/\.(jar|zip|hmod)$/i, '');
    }

    const isHmod = extension === 'hmod';
    const copied = [];
    let assetCount = 0, dataCount = 0, classCount = 0, ignoredCount = 0;
    for (const item of normalized) {
      const name = item.name.replace(/^\//, '');
      if (!name || item.entry.dir || name.toLowerCase() === 'horizon-mod.toml') continue;
      if (/\.class$/i.test(name)) classCount++;
      const isAssetOrData = /^(assets|data)\//i.test(name);
      if (isAssetOrData) {
        copied.push({ name, entry: item.entry });
        if (/^assets\//i.test(name)) assetCount++;
        if (/^data\//i.test(name)) dataCount++;
      } else {
        ignoredCount++;
      }
    }

    state.currentArchive = archive;
    state.extractedEntries = copied;
    state.sourceFile = file;
    state.sourceType = extension;
    state.sourceReport = { assetCount, dataCount, classCount, ignoredCount, isHmod, rootPrefix };
    renderInspection(file, state.sourceReport);
    els.fileStatus.innerHTML = `<span class="status-check">✓</span><span><strong>${escapeHTML(file.name)}</strong> · ${(file.size / 1024 / 1024).toFixed(2)} MB</span>`;
    refreshManifestPreview();
  }

  function renderInspection(file, report) {
    els.inspectionReport.hidden = false;
    const compatible = report.assetCount + report.dataCount;
    const note = report.classCount
      ? `${report.classCount.toLocaleString()} Java .class file(s) detected. These are not ported and will not be included in the exported .hmod.`
      : report.isHmod ? 'Existing Horizon package detected. Its assets/ and data/ entries will be retained; the manifest will be replaced with your settings.' : 'No Java class files detected in this archive.';
    const warning = compatible
      ? `${note} ${report.assetCount} asset file(s) and ${report.dataCount} data file(s) will be copied. Check those files for Horizon-compatible formats before using the package.`
      : `${note} No assets/ or data/ files were found. Export would produce a manifest-only package, which is unlikely to add anything in-game.`;
    els.inspectionReport.innerHTML = `<div class="report-stat"><strong>${report.assetCount}</strong><small>Asset files</small></div><div class="report-stat"><strong>${report.dataCount}</strong><small>Data files</small></div><div class="report-stat"><strong>${report.classCount}</strong><small>Java classes</small></div><div class="report-warning">${escapeHTML(warning)}${report.rootPrefix ? ` Archive folder prefix removed: ${escapeHTML(report.rootPrefix)}` : ''}</div>`;
    els.exportButton.disabled = !state.currentArchive || Boolean(validateManifest());
  }

  els.fileInput.addEventListener('change', async event => {
    const file = event.target.files?.[0];
    if (!file) return;
    els.fileStatus.innerHTML = '<span class="loader"></span><span>Inspecting archive...</span>';
    els.inspectionReport.hidden = true;
    state.currentArchive = null;
    els.exportButton.disabled = true;
    try {
      await inspectArchive(file);
      showToast('File inspected. Review the report and manifest.');
    } catch (error) {
      els.fileStatus.textContent = error.message;
      els.inspectionReport.hidden = true;
      state.currentArchive = null;
      refreshManifestPreview();
    }
  });

  const dropzone = $('#dropzone');
  ['dragenter', 'dragover'].forEach(name => dropzone.addEventListener(name, event => { event.preventDefault(); dropzone.classList.add('drag-over'); }));
  ['dragleave', 'drop'].forEach(name => dropzone.addEventListener(name, event => { event.preventDefault(); dropzone.classList.remove('drag-over'); }));
  dropzone.addEventListener('drop', event => {
    const file = event.dataTransfer?.files?.[0];
    if (!file) return;
    const transfer = new DataTransfer(); transfer.items.add(file); els.fileInput.files = transfer.files;
    els.fileInput.dispatchEvent(new Event('change', { bubbles: true }));
  });

  els.exportButton.addEventListener('click', async () => {
    const error = validateManifest();
    if (error) { els.exportFeedback.textContent = error; return; }
    if (!state.currentArchive || !window.JSZip) return;
    els.exportButton.disabled = true;
    els.exportButton.innerHTML = '<span class="loader"></span> Building...';
    els.exportFeedback.textContent = 'Packaging manifest and supported archive entries...';
    try {
      const output = new JSZip();
      output.file('horizon-mod.toml', makeManifest());
      for (const item of state.extractedEntries) output.file(item.name, item.entry.async('uint8array'));
      const blob = await output.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
      const id = getField('manifestId');
      const link = document.createElement('a');
      const url = URL.createObjectURL(blob);
      link.href = url; link.download = `${id}.hmod`; document.body.appendChild(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1500);
      els.exportFeedback.textContent = `Created ${id}.hmod (${(blob.size / 1024).toFixed(1)} KB). Test it in Horizon; packaging does not validate every data file.`;
      showToast('Your .hmod package is ready.');
    } catch (error) {
      els.exportFeedback.textContent = `Could not build package: ${error.message}`;
    } finally {
      els.exportButton.disabled = Boolean(validateManifest()) || !state.currentArchive;
      els.exportButton.innerHTML = 'Export .hmod <span>↗</span>';
    }
  });

  // Load the initial live catalogue and keep the manifest preview in sync.
  refreshManifestPreview();
  loadHomePopular();
  hydrateModrinthFilters();
})();
