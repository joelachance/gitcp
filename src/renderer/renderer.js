const searchInput = document.getElementById('query');
const resultsEl = document.getElementById('results');
const hintEl = document.getElementById('hint');
const authBadge = document.getElementById('auth-badge');
const btnAuth = document.getElementById('btn-auth');
const shortcutHint = document.getElementById('shortcut-hint');
const appEl = document.getElementById('app');

let items = [];
let activeIndex = -1;
let debounceTimer = null;

function setHint(text) {
  hintEl.textContent = text ?? '';
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
    authBadge.textContent = status.login ? `Signed in as ${status.login}` : 'Signed in';
    btnAuth.textContent = 'Sign out';
  } else {
    authBadge.textContent = 'Not signed in';
    btnAuth.textContent = 'Sign in with GitHub';
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
    searchInput.blur();
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
});

Promise.all([window.gitcp.authStatus(), window.gitcp.shortcutInfo()]).then(([status, sc]) => {
  updateAuthUi(status);
  if (sc?.registered && sc?.accelerator) {
    shortcutHint.textContent = `Shortcut: ${sc.accelerator}`;
  } else if (sc?.fallback) {
    shortcutHint.textContent = `Shortcut: ${sc.fallback} (${sc.primaryFailed ? 'fallback' : ''})`;
  }
  appEl.classList.remove('hidden');
  searchInput.focus();
});
