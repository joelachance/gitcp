import createLucideSvg from '../../node_modules/lucide/dist/esm/createElement.mjs';
import Activity from '../../node_modules/lucide/dist/esm/icons/activity.mjs';
import BookOpen from '../../node_modules/lucide/dist/esm/icons/book-open.mjs';
import CircleCheck from '../../node_modules/lucide/dist/esm/icons/circle-check.mjs';
import CircleDot from '../../node_modules/lucide/dist/esm/icons/circle-dot.mjs';
import GitBranch from '../../node_modules/lucide/dist/esm/icons/git-branch.mjs';
import GitCommit from '../../node_modules/lucide/dist/esm/icons/git-commit.mjs';
import GitMerge from '../../node_modules/lucide/dist/esm/icons/git-merge.mjs';
import GitPullRequest from '../../node_modules/lucide/dist/esm/icons/git-pull-request.mjs';
import GitPullRequestClosed from '../../node_modules/lucide/dist/esm/icons/git-pull-request-closed.mjs';
import GitPullRequestDraft from '../../node_modules/lucide/dist/esm/icons/git-pull-request-draft.mjs';
import Package from '../../node_modules/lucide/dist/esm/icons/package.mjs';
import Tag from '../../node_modules/lucide/dist/esm/icons/tag.mjs';
import Workflow from '../../node_modules/lucide/dist/esm/icons/workflow.mjs';

const searchInput = document.getElementById('query');
const resultsEl = document.getElementById('results');
const resultsRefreshHintEl = document.getElementById('results-refresh-hint');
const hintEl = document.getElementById('hint');
const btnAuth = document.getElementById('btn-auth');
const userAvatarEl = document.getElementById('user-avatar');
const userAvatarPlaceholderEl = document.getElementById('user-avatar-placeholder');
const appEl = document.getElementById('app');
const loadSpinnerEl = document.getElementById('load-spinner');
const btnFilterQualifier = document.getElementById('btn-filter-qualifier');
const filterQualifierMenuEl = document.getElementById('filter-qualifier-menu');
const filterPillsEl = document.getElementById('filter-pills');

/** @type {{ kind: string, value: string }[]} */
let searchFilters = [];

let items = [];
let activeIndex = -1;
let debounceTimer = null;

/** Full list from GitHub when using `/issues`; reused while the query stays in that mode. */
let issuesListCache = null;

/** Full PR list when using `/pr` or `/prs` (open + closed); reused while the query stays in that mode. */
let prsListCache = null;

/** Only the latest `runSearch` may turn off the loading spinner (overlapping async). */
let loadSeq = 0;

function api() {
  return window.gitcp;
}

function setHint(text, { muted = false } = {}) {
  hintEl.textContent = text ?? '';
  hintEl.classList.toggle('hint--muted', Boolean(text) && muted);
  updateWindowHeight();
}

function refreshShortcutLabel() {
  return typeof navigator !== 'undefined' &&
    (navigator.platform?.startsWith('Mac') ?? false)
    ? '⌘R'
    : 'Ctrl+R';
}

function updateRefreshHint() {
  if (!resultsRefreshHintEl) return;
  const trimmed = searchInput.value.trim();
  if (shouldShowSlashCommands(trimmed)) {
    resultsRefreshHintEl.textContent = '';
    resultsRefreshHintEl.classList.add('hidden');
    updateWindowHeight();
    return;
  }
  if (isRepoViewIncomplete(trimmed)) {
    resultsRefreshHintEl.textContent = '';
    resultsRefreshHintEl.classList.add('hidden');
    updateWindowHeight();
    return;
  }
  if (parseRepoViewCommand(trimmed)) {
    resultsRefreshHintEl.textContent = `${refreshShortcutLabel()} to refresh`;
    resultsRefreshHintEl.classList.remove('hidden');
    updateWindowHeight();
    return;
  }
  const q = buildSearchQuery();
  if (!q) {
    resultsRefreshHintEl.textContent = '';
    resultsRefreshHintEl.classList.add('hidden');
    updateWindowHeight();
    return;
  }
  resultsRefreshHintEl.textContent = `${refreshShortcutLabel()} to refresh results`;
  resultsRefreshHintEl.classList.remove('hidden');
  updateWindowHeight();
}

function refreshSearch() {
  const inputLine = searchInput.value.trim();
  if (isIssuesCommand(inputLine)) {
    issuesListCache = null;
  } else if (isPrCommand(inputLine)) {
    prsListCache = null;
  }
  void runSearch({ forceSearchRefresh: true });
}

function setLoading(on) {
  if (!loadSpinnerEl) return;
  loadSpinnerEl.classList.toggle('hidden', !on);
  loadSpinnerEl.setAttribute('aria-hidden', on ? 'false' : 'true');
  updateWindowHeight();
}

function buildSearchQuery() {
  const parts = searchFilters.map((f) => `${f.kind}:${f.value}`);
  const free = searchInput.value.trim();
  if (free) parts.push(free);
  return parts.join(' ').trim();
}

function buildIssuesLocalFilterText(inputLine) {
  const filterText =
    inputLine === '/issues' || !inputLine.startsWith('/issues ')
      ? ''
      : inputLine.slice('/issues '.length).trim();
  const pillTerms = searchFilters.map((f) => f.value);
  return [filterText, ...pillTerms].filter(Boolean).join(' ');
}

function buildPrLocalFilterText(inputLine) {
  const filterText = prCommandFilterText(inputLine);
  const pillTerms = searchFilters.map((f) => f.value);
  return [filterText, ...pillTerms].filter(Boolean).join(' ');
}

function lucideIcon(iconNode, statusClass) {
  const svg = createLucideSvg(iconNode, {
    width: 16,
    height: 16,
    'stroke-width': 2,
    'aria-hidden': 'true',
  });
  const wrap = document.createElement('span');
  wrap.className = `result-icon ${statusClass}`;
  wrap.appendChild(svg);
  return wrap;
}

/**
 * GitHub-style status: issues + PRs (open/closed/draft/merged).
 * @param {Record<string, unknown>} item
 */
function statusIconForSearchItem(item) {
  const pr = item.pull_request;
  const mergedAt = pr?.merged_at ?? item.merged_at;
  if (pr && mergedAt) {
    return { el: lucideIcon(GitMerge, 'result-icon--pr-merged'), label: 'Merged pull request' };
  }
  if (pr) {
    if (item.state === 'open' && item.draft) {
      return {
        el: lucideIcon(GitPullRequestDraft, 'result-icon--pr-draft'),
        label: 'Draft pull request',
      };
    }
    if (item.state === 'open') {
      return {
        el: lucideIcon(GitPullRequest, 'result-icon--pr-open'),
        label: 'Open pull request',
      };
    }
    return {
      el: lucideIcon(GitPullRequestClosed, 'result-icon--pr-closed'),
      label: 'Closed pull request',
    };
  }
  if (item.state === 'open') {
    return { el: lucideIcon(CircleDot, 'result-icon--issue-open'), label: 'Open issue' };
  }
  return { el: lucideIcon(CircleCheck, 'result-icon--issue-closed'), label: 'Closed issue' };
}

function renderFilterPills() {
  if (!filterPillsEl) return;
  filterPillsEl.innerHTML = '';
  searchFilters.forEach((f, i) => {
    const badge = document.createElement('span');
    badge.className = `badge filter-pill filter-pill--${f.kind}`;
    badge.title = `${f.kind}:${f.value}`;

    const dismiss = document.createElement('button');
    dismiss.type = 'button';
    dismiss.className = 'badge-dismiss';
    dismiss.setAttribute('aria-label', `Remove ${f.kind} filter`);
    dismiss.dataset.index = String(i);
    dismiss.textContent = '×';

    const label = document.createElement('span');
    label.className = 'badge-label';
    label.textContent = f.value;

    badge.appendChild(dismiss);
    badge.appendChild(label);
    filterPillsEl.appendChild(badge);
  });

  filterPillsEl.onclick = (e) => {
    const btn = e.target.closest('.badge-dismiss');
    if (!btn || !filterPillsEl.contains(btn)) return;
    const i = Number(btn.dataset.index);
    if (Number.isFinite(i) && searchFilters[i]) {
      searchFilters.splice(i, 1);
      renderFilterPills();
      scheduleSearch();
    }
  };

  updateWindowHeight();
}

function tryCommitSearchFilter() {
  const t = searchInput.value.trimEnd();
  const re = /(?:^|\s)((repo|user|org):(\S+))$/;
  const m = t.match(re);
  if (!m) return false;
  const kind = m[2];
  const value = m[3];
  const prefix = t.slice(0, m.index).trimEnd();
  searchFilters.push({ kind, value });
  searchInput.value = prefix;
  renderFilterPills();
  scheduleSearch();
  return true;
}

/** Shown when input starts with `/` but is not yet a complete command. */
const SLASH_COMMANDS = [
  {
    command: '/issues',
    description: 'Open issues in repos you can access',
  },
  {
    command: '/pr',
    description: 'Pull requests (open & closed) in repos you can access',
  },
  {
    command: '/prs',
    description: 'Same as /pr',
  },
  {
    command: '/activity',
    description: 'Repository events (needs owner/repo)',
  },
  {
    command: '/branches',
    description: 'Branches (needs owner/repo)',
  },
  {
    command: '/commits',
    description: 'Recent commits (needs owner/repo)',
  },
  {
    command: '/releases',
    description: 'Releases (needs owner/repo)',
  },
  {
    command: '/repo',
    description: 'Repository summary (needs owner/repo)',
  },
  {
    command: '/tags',
    description: 'Tags (needs owner/repo)',
  },
  {
    command: '/ci',
    description: 'Actions workflow runs (needs owner/repo)',
  },
];

function isIssuesCommand(trimmed) {
  const lower = trimmed.toLowerCase();
  return lower === '/issues' || lower.startsWith('/issues ');
}

function isPrCommand(trimmed) {
  const lower = trimmed.toLowerCase();
  if (lower === '/prs' || lower.startsWith('/prs ')) return true;
  if (lower === '/pr' || lower.startsWith('/pr ')) return true;
  return false;
}

function prCommandFilterText(trimmed) {
  const lower = trimmed.toLowerCase();
  if (lower.startsWith('/prs ')) return trimmed.slice(5).trim();
  if (lower === '/prs') return '';
  if (lower.startsWith('/pr ')) return trimmed.slice(4).trim();
  if (lower === '/pr') return '';
  return '';
}

/**
 * @param {string} trimmed
 * @returns {{ kind: string, fullName: string, filterText: string } | null}
 */
function parseRepoViewCommand(trimmed) {
  const m = trimmed.match(
    /^\/(repo|releases|ci|tags|branches|commits|activity)\s+(\S+\/\S+)(?:\s+(.*))?$/i,
  );
  if (!m) return null;
  return {
    kind: m[1].toLowerCase(),
    fullName: m[2],
    filterText: (m[3] || '').trim(),
  };
}

/**
 * True when the user is typing `/releases` etc. but has not yet entered owner/repo.
 * @param {string} trimmed
 */
function isRepoViewIncomplete(trimmed) {
  const m = trimmed.match(/^\/(repo|releases|ci|tags|branches|commits|activity)(?:\s+(.*))?$/i);
  if (!m) return false;
  const rest = (m[2] || '').trim();
  if (!rest) return true;
  const firstTok = rest.split(/\s+/)[0];
  if (!firstTok.includes('/')) return true;
  return false;
}

function shouldShowSlashCommands(trimmed) {
  if (!trimmed.startsWith('/')) return false;
  if (isIssuesCommand(trimmed)) return false;
  if (isPrCommand(trimmed)) return false;
  if (parseRepoViewCommand(trimmed)) return false;
  if (isRepoViewIncomplete(trimmed)) return false;
  return true;
}

function buildSlashPickerItems(trimmed) {
  const prefix = trimmed.toLowerCase();
  return SLASH_COMMANDS.filter((c) => c.command.startsWith(prefix)).map((c) => ({
    __slashCommand: true,
    command: c.command,
    description: c.description,
  }));
}

function filterIssuesBySearchText(list, searchText) {
  const terms = searchText
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  if (terms.length === 0) return list;
  return list.filter((item) => {
    const hay = `${item.title} ${item.repository?.full_name ?? ''}`.toLowerCase();
    return terms.every((t) => hay.includes(t));
  });
}

/**
 * @param {{ title: string, subtitle: string }[]} list
 * @param {string} searchText
 */
function filterRepoViewRows(list, searchText) {
  const terms = searchText.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return list;
  return list.filter((item) => {
    const hay = `${item.title} ${item.subtitle}`.toLowerCase();
    return terms.every((t) => hay.includes(t));
  });
}

/**
 * @param {string | undefined} rowKind
 */
function iconForRepoViewItem(rowKind) {
  switch (rowKind) {
    case 'repo':
      return { el: lucideIcon(BookOpen, 'result-icon--rv-repo'), label: 'Repository' };
    case 'release':
      return { el: lucideIcon(Package, 'result-icon--rv-release'), label: 'Release' };
    case 'ci':
      return { el: lucideIcon(Workflow, 'result-icon--rv-ci'), label: 'Workflow run' };
    case 'tag':
      return { el: lucideIcon(Tag, 'result-icon--rv-tag'), label: 'Tag' };
    case 'branch':
      return { el: lucideIcon(GitBranch, 'result-icon--rv-branch'), label: 'Branch' };
    case 'commit':
      return { el: lucideIcon(GitCommit, 'result-icon--rv-commit'), label: 'Commit' };
    case 'activity':
      return { el: lucideIcon(Activity, 'result-icon--rv-activity'), label: 'Activity' };
    default:
      return { el: lucideIcon(BookOpen, 'result-icon--rv-repo'), label: 'Repository' };
  }
}

function updateWindowHeight() {
  requestAnimationFrame(() => {
    if (!appEl.classList.contains('hidden')) {
      const rect = appEl.getBoundingClientRect();
      const h = Math.ceil(rect.height) + 24;
      try {
        api()?.setPaletteHeight?.(h);
      } catch {
        /* ignore */
      }
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

    const row = document.createElement('div');
    row.className = 'result-row';

    if (item.__slashCommand) {
      const main = document.createElement('div');
      main.className = 'result-main';

      const title = document.createElement('span');
      title.className = 'title';
      title.textContent = item.command;

      const meta = document.createElement('span');
      meta.className = 'meta';
      meta.textContent = item.description;

      main.appendChild(title);
      main.appendChild(meta);

      row.appendChild(main);
      li.appendChild(row);
      li.setAttribute('aria-label', `${item.command}: ${item.description}`);

      li.addEventListener('mousedown', (e) => {
        e.preventDefault();
        activeIndex = i;
        renderResults();
        applySelectedSlashCommand();
      });
      resultsEl.appendChild(li);
      return;
    }

    if (item.__repoView) {
      const { el: iconWrap, label: rvLabel } = iconForRepoViewItem(item.rowKind);
      iconWrap.title = rvLabel;

      const main = document.createElement('div');
      main.className = 'result-main';

      const title = document.createElement('span');
      title.className = 'title';
      title.textContent = item.title;

      const meta = document.createElement('span');
      meta.className = 'meta';
      meta.textContent = item.subtitle;

      main.appendChild(title);
      main.appendChild(meta);

      row.appendChild(iconWrap);
      row.appendChild(main);
      li.appendChild(row);
      li.setAttribute('aria-label', `${rvLabel}: ${item.title}`);

      li.addEventListener('mousedown', (e) => {
        e.preventDefault();
        activeIndex = i;
        renderResults();
        openSelected();
      });
      resultsEl.appendChild(li);
      return;
    }

    const { el: iconWrap, label: statusLabel } = statusIconForSearchItem(item);
    iconWrap.title = statusLabel;

    const main = document.createElement('div');
    main.className = 'result-main';

    const title = document.createElement('span');
    title.className = 'title';
    title.textContent = item.title;

    const meta = document.createElement('span');
    meta.className = 'meta';
    const kind = item.pull_request ? 'PR' : 'Issue';
    meta.textContent = `${kind} · ${item.repository.full_name} #${item.number}`;

    main.appendChild(title);
    main.appendChild(meta);

    row.appendChild(iconWrap);
    row.appendChild(main);
    li.appendChild(row);
    li.setAttribute('aria-label', `${statusLabel}: ${item.title}`);

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

function applySelectedSlashCommand() {
  const row = items[activeIndex];
  if (!row?.__slashCommand || !row.command) return;
  searchInput.value = `${row.command} `;
  searchInput.focus();
  scheduleSearch();
}

async function openSelected() {
  const row = items[activeIndex];
  if (row?.__slashCommand) {
    applySelectedSlashCommand();
    return;
  }
  if (!row?.html_url) return;
  await api().openExternal(row.html_url);
}

async function runSearch(options = {}) {
  const { forceSearchRefresh = false } = options;
  const seq = ++loadSeq;
  const endLoading = () => {
    if (seq === loadSeq) setLoading(false);
  };

  const inputLine = searchInput.value.trim();
  if (shouldShowSlashCommands(inputLine)) {
    items = buildSlashPickerItems(inputLine);
    activeIndex = items.length ? 0 : -1;
    setHint(items.length ? '' : 'No matching commands', { muted: !items.length });
    setLoading(false);
    renderResults();
    updateRefreshHint();
    return;
  }

  if (isRepoViewIncomplete(inputLine)) {
    issuesListCache = null;
    prsListCache = null;
    items = [];
    activeIndex = -1;
    setHint('Add owner/repo after the command (e.g. octocat/Hello-World)', { muted: true });
    setLoading(false);
    renderResults();
    updateRefreshHint();
    return;
  }

  const q = buildSearchQuery();
  if (!q) {
    issuesListCache = null;
    prsListCache = null;
    items = [];
    activeIndex = -1;
    setHint('');
    setLoading(false);
    renderResults();
    updateRefreshHint();
    return;
  }

  updateRefreshHint();

  if (isPrCommand(inputLine)) {
    const combinedFilter = buildPrLocalFilterText(inputLine);
    setHint('');
    items = [];
    activeIndex = -1;
    renderResults();
    const needFetch = !prsListCache;
    setLoading(needFetch);
    try {
      if (!prsListCache) {
        const data = await api().listAccessibleIssues({
          state: 'all',
          pullRequestsOnly: true,
        });
        prsListCache = data.items ?? [];
      }
      const filtered = filterIssuesBySearchText(prsListCache, combinedFilter);
      items = filtered;
      activeIndex = items.length ? 0 : -1;
      const n = prsListCache.length;
      if (combinedFilter) {
        setHint(
          items.length
            ? `${items.length} of ${n} pull request${n === 1 ? '' : 's'} match`
            : `No matches in ${n} pull request${n === 1 ? '' : 's'}`,
          { muted: true },
        );
      } else {
        setHint(
          n
            ? `${n} pull request${n === 1 ? '' : 's'} (open & closed) in repos you can access`
            : 'No pull requests in repos you can access',
          { muted: true },
        );
      }
      renderResults();
    } catch (err) {
      prsListCache = null;
      items = [];
      activeIndex = -1;
      renderResults();
      setHint(err?.message || 'Could not load pull requests');
    } finally {
      endLoading();
      updateRefreshHint();
    }
    return;
  }

  if (isIssuesCommand(inputLine)) {
    const combinedFilter = buildIssuesLocalFilterText(inputLine);
    setHint('');
    items = [];
    activeIndex = -1;
    renderResults();
    const needFetch = !issuesListCache;
    setLoading(needFetch);
    try {
      if (!issuesListCache) {
        const data = await api().listAccessibleIssues();
        issuesListCache = data.items ?? [];
      }
      const filtered = filterIssuesBySearchText(issuesListCache, combinedFilter);
      items = filtered;
      activeIndex = items.length ? 0 : -1;
      const n = issuesListCache.length;
      if (combinedFilter) {
        setHint(
          items.length
            ? `${items.length} of ${n} issue${n === 1 ? '' : 's'} match`
            : `No matches in ${n} open issue${n === 1 ? '' : 's'}`,
          { muted: true },
        );
      } else {
        setHint(
          n
            ? `${n} open issue${n === 1 ? '' : 's'} in repos you can access`
            : 'No open issues in repos you can access',
          { muted: true },
        );
      }
      renderResults();
    } catch (err) {
      issuesListCache = null;
      items = [];
      activeIndex = -1;
      renderResults();
      setHint(err?.message || 'Could not load issues');
    } finally {
      endLoading();
      updateRefreshHint();
    }
    return;
  }

  const repoParsed = parseRepoViewCommand(inputLine);
  if (repoParsed) {
    issuesListCache = null;
    prsListCache = null;
    setHint('');
    setLoading(true);
    try {
      const data = await api().repoView({
        kind: repoParsed.kind,
        fullName: repoParsed.fullName,
        forceRefresh: forceSearchRefresh,
      });
      const rows = (data.items ?? []).map((r) => ({
        ...r,
        __repoView: true,
      }));
      const filtered = filterRepoViewRows(rows, repoParsed.filterText);
      items = filtered;
      activeIndex = items.length ? 0 : -1;
      const total = rows.length;
      const labels = {
        repo: 'repository',
        releases: 'release',
        ci: 'workflow run',
        tags: 'tag',
        branches: 'branch',
        commits: 'commit',
        activity: 'event',
      };
      const noun = labels[repoParsed.kind] ?? 'item';
      if (repoParsed.filterText) {
        setHint(
          items.length
            ? `${items.length} of ${total} ${noun}${total === 1 ? '' : 's'} match`
            : `No matches in ${total} ${noun}${total === 1 ? '' : 's'}`,
          { muted: true },
        );
      } else {
        setHint(
          total
            ? `${total} ${noun}${total === 1 ? '' : 's'} · ${repoParsed.fullName}`
            : `No ${noun}s · ${repoParsed.fullName}`,
          { muted: true },
        );
      }
      renderResults();
    } catch (err) {
      items = [];
      activeIndex = -1;
      renderResults();
      setHint(err?.message || 'Could not load repository data');
    } finally {
      endLoading();
      updateRefreshHint();
    }
    return;
  }

  issuesListCache = null;
  prsListCache = null;
  setHint('');
  items = [];
  activeIndex = -1;
  renderResults();
  setLoading(true);
  try {
    const data = await api().searchIssues(buildSearchQuery(), {
      forceRefresh: forceSearchRefresh,
    });
    items = data.items ?? [];
    activeIndex = items.length ? 0 : -1;
    renderResults();
  } catch (err) {
    items = [];
    activeIndex = -1;
    renderResults();
    setHint(err?.message || 'Search failed');
  } finally {
    endLoading();
    updateRefreshHint();
  }
}

function scheduleSearch() {
  clearTimeout(debounceTimer);
  const t = searchInput.value.trimStart();
  const trimmed = searchInput.value.trim();
  const instantIssues =
    t === '/issues' ||
    t.startsWith('/issues ') ||
    isPrCommand(trimmed) ||
    shouldShowSlashCommands(trimmed) ||
    isRepoViewIncomplete(trimmed) ||
    Boolean(parseRepoViewCommand(trimmed));
  const delay = instantIssues ? 0 : 220;
  debounceTimer = setTimeout(runSearch, delay);
}

function setFilterQualifierMenuOpen(open) {
  if (!btnFilterQualifier || !filterQualifierMenuEl) return;
  btnFilterQualifier.setAttribute('aria-expanded', open ? 'true' : 'false');
  filterQualifierMenuEl.classList.toggle('hidden', !open);
  filterQualifierMenuEl.setAttribute('aria-hidden', open ? 'false' : 'true');
  updateWindowHeight();
}

function insertSearchQualifier(prefix) {
  const input = searchInput;
  const raw = input.value;
  const start = input.selectionStart ?? raw.length;
  const end = input.selectionEnd ?? raw.length;
  const before = raw.slice(0, start);
  const after = raw.slice(end);
  const needsLeadingSpace = before.length > 0 && !/\s$/.test(before);
  const insert = (needsLeadingSpace ? ' ' : '') + prefix;
  input.value = before + insert + after;
  const pos = start + insert.length;
  input.setSelectionRange(pos, pos);
  input.focus();
  scheduleSearch();
}

const filterQualifierWrapEl = btnFilterQualifier?.closest('.filter-qualifier-wrap');

btnFilterQualifier?.addEventListener('click', () => {
  const shouldOpen = filterQualifierMenuEl?.classList.contains('hidden');
  setFilterQualifierMenuOpen(Boolean(shouldOpen));
});

filterQualifierMenuEl?.addEventListener('click', (e) => {
  const item = e.target.closest?.('[data-qualifier]');
  if (!item || !filterQualifierMenuEl.contains(item)) return;
  const q = item.getAttribute('data-qualifier');
  if (q) insertSearchQualifier(q);
  setFilterQualifierMenuOpen(false);
});

document.addEventListener('click', (e) => {
  if (filterQualifierWrapEl?.contains(e.target)) return;
  setFilterQualifierMenuOpen(false);
});

function updateAuthUi(status) {
  if (status?.loggedIn) {
    btnAuth.title = status.login ? `Sign out (${status.login})` : 'Sign out';
    btnAuth.setAttribute('aria-label', btnAuth.title);
    if (status.avatarUrl) {
      userAvatarEl.src = status.avatarUrl;
      userAvatarEl.alt = status.login ? `${status.login} on GitHub` : 'GitHub profile';
      userAvatarEl.classList.remove('hidden');
    } else {
      userAvatarEl.removeAttribute('src');
      userAvatarEl.classList.add('hidden');
      userAvatarEl.alt = '';
    }
    userAvatarPlaceholderEl.textContent = status.avatarUrl
      ? ''
      : (status.login || '?').slice(0, 1).toUpperCase();
  } else {
    userAvatarEl.removeAttribute('src');
    userAvatarEl.classList.add('hidden');
    userAvatarEl.alt = '';
    userAvatarPlaceholderEl.textContent = '?';
    btnAuth.title = 'Sign in with GitHub';
    btnAuth.setAttribute('aria-label', 'Sign in with GitHub');
  }
}

btnAuth.addEventListener('click', async () => {
  const status = await api().authStatus();
  setHint('');
  try {
    if (status.loggedIn) {
      await api().logout();
    } else {
      await api().login();
    }
  } catch (e) {
    setHint(e?.message || 'Authentication failed');
  }
});

searchInput.addEventListener('input', scheduleSearch);

document.addEventListener('keydown', (e) => {
  if (appEl.classList.contains('hidden')) return;
  if (!(e.metaKey || e.ctrlKey) || (e.key !== 'r' && e.key !== 'R')) return;
  const line = searchInput.value.trim();
  if (!parseRepoViewCommand(line) && !buildSearchQuery().trim()) return;
  e.preventDefault();
  refreshSearch();
});

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
  } else if (
    items.length > 0 &&
    (e.key === 'j' || e.key === 'J' || e.key === 'k' || e.key === 'K')
  ) {
    e.preventDefault();
    if (e.key === 'j' || e.key === 'J') {
      activeIndex = Math.min(activeIndex + 1, items.length - 1);
    } else {
      activeIndex = Math.max(activeIndex - 1, 0);
    }
    renderResults();
    scrollActiveIntoView();
  } else if (e.key === 'Enter') {
    e.preventDefault();
    if (tryCommitSearchFilter()) return;
    void openSelected();
  } else if (e.key === 'Escape') {
    e.preventDefault();
    if (filterQualifierMenuEl && !filterQualifierMenuEl.classList.contains('hidden')) {
      setFilterQualifierMenuOpen(false);
    } else {
      void api().hide();
    }
  }
});

function scrollActiveIntoView() {
  const el = resultsEl.querySelector(`li[data-index="${activeIndex}"]`);
  el?.scrollIntoView({ block: 'nearest' });
}

function bootstrap() {
  if (!window.gitcp) {
    hintEl.textContent =
      'Internal error: preload failed. Quit and reinstall, or run from the repo with bun run start.';
    appEl.classList.remove('hidden');
    return;
  }

  /* Show immediately: the window is transparent; #app was display:none until authStatus
   * resolved, so the palette was completely invisible if IPC was slow or never settled. */
  appEl.classList.remove('hidden');

  window.gitcp.onAuthChanged((state) => updateAuthUi(state));

  window.gitcp.onFocusSearch(() => {
    searchInput.focus();
    searchInput.select();
    updateWindowHeight();
  });

  window.gitcp
    .authStatus()
    .then((status) => {
      updateAuthUi(status);
      renderFilterPills();
      updateRefreshHint();
      searchInput.focus();
      updateWindowHeight();
    })
    .catch(() => {
      hintEl.textContent = 'Could not load GitCP bridge.';
    });
}

bootstrap();
