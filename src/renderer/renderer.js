const searchInput = document.getElementById('query');
const resultsEl = document.getElementById('results');
const hintEl = document.getElementById('hint');
const btnAuth = document.getElementById('btn-auth');
const shortcutNote = document.getElementById('shortcut-note');
const appEl = document.getElementById('app');

let items = [];
let activeIndex = -1;
let debounceTimer = null;

function setHint(text) {
  hintEl.textContent = text ?? '';
  updateWindowHeight();
}

function updateWindowHeight() {
  requestAnimationFrame(() => {
    if (!appEl.classList.contains('hidden')) {
      const rect = appEl.getBoundingClientRect();
      const h = Math.ceil(rect.height) + 24;
      window.gitcp.setPaletteHeight(h);
    }
  });
}

function renderResults() {
  resultsEl.innerHTML = '';
  items.forEach((item, i) => {
    const li = document.createElement('li');
    li.setAttribute('role', 'option');
    li.dataset.index = String(i);
    if (i === activeIndex) li.classList.add('active');

    const title = document.createElement('span');
    title.className = 'title';
    title.textContent = item.title;

    const meta = document.createElement('span');
    meta.className = 'meta';
    const kind = item.pull_request ? 'PR' : 'Issue';
    meta.textContent = `${kind} · ${item.repository.full_name} #${item.number}`;

    li.appendChild(title);
    li.appendChild(meta);
    li.addEventListener('mousedown', (e) => {
      e.preventDefault();
      activeIndex = i;
      renderResults();
      openSelected();
    });
    resultsEl.appendChild(li);
  });
  updateWindowHeight();
}

async function openSelected() {
  const row = items[activeIndex];
  if (!row?.html_url) return;
  await window.gitcp.openExternal(row.html_url);
}

async function runSearch() {
  const q = searchInput.value.trim();
  if (!q) {
    items = [];
    activeIndex = -1;
    renderResults();
    return;
  }
  setHint('');
  try {
    const data = await window.gitcp.searchIssues(q);
    items = data.items ?? [];
    activeIndex = items.length ? 0 : -1;
    renderResults();
  } catch (err) {
    items = [];
    activeIndex = -1;
    renderResults();
    setHint(err?.message || 'Search failed');
  }
}

function scheduleSearch() {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(runSearch, 220);
}

function updateAuthUi(status) {
  if (status?.loggedIn) {
    btnAuth.textContent = status.login ? `Sign out (${status.login})` : 'Sign out';
    btnAuth.title = 'Sign out of GitHub';
  } else {
    btnAuth.textContent = 'Sign in';
    btnAuth.title = 'Sign in with GitHub';
  }
}

btnAuth.addEventListener('click', async () => {
  const status = await window.gitcp.authStatus();
  setHint('');
  try {
    if (status.loggedIn) {
      await window.gitcp.logout();
    } else {
      await window.gitcp.login();
    }
  } catch (e) {
    setHint(e?.message || 'Authentication failed');
  }
});

searchInput.addEventListener('input', scheduleSearch);

searchInput.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    if (items.length === 0) return;
    activeIndex = Math.min(activeIndex + 1, items.length - 1);
    renderResults();
    scrollActiveIntoView();
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    if (items.length === 0) return;
    activeIndex = Math.max(activeIndex - 1, 0);
    renderResults();
    scrollActiveIntoView();
  } else if (e.key === 'Enter') {
    e.preventDefault();
    void openSelected();
  } else if (e.key === 'Escape') {
    e.preventDefault();
    void window.gitcp.hide();
  }
});

function scrollActiveIntoView() {
  const el = resultsEl.querySelector(`li[data-index="${activeIndex}"]`);
  el?.scrollIntoView({ block: 'nearest' });
}

window.gitcp.onAuthChanged((state) => updateAuthUi(state));

window.gitcp.onFocusSearch(() => {
  searchInput.focus();
  searchInput.select();
  updateWindowHeight();
});

Promise.all([window.gitcp.authStatus(), window.gitcp.shortcutInfo()]).then(([status, sc]) => {
  updateAuthUi(status);
  if (sc?.registered && sc?.accelerator) {
    shortcutNote.textContent = sc.primaryFailed
      ? `Shortcut: ${sc.accelerator} (${sc.primary} was unavailable)`
      : `Shortcut: ${sc.accelerator}`;
  }
  appEl.classList.remove('hidden');
  searchInput.focus();
  updateWindowHeight();
});
