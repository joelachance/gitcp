/**
 * GitHub REST: repository-scoped lists and summary (releases, Actions, tags, branches, commits, events).
 * @see https://docs.github.com/en/rest
 */

const USER_AGENT = 'gitcp/0.1.0';

/**
 * @param {string} token
 * @returns {Record<string, string>}
 */
function authHeaders(token) {
  return {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'User-Agent': USER_AGENT,
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

/**
 * @param {string} url
 * @param {string} token
 */
async function ghGet(url, token) {
  const res = await fetch(url, { headers: authHeaders(token) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data.message || res.statusText || 'Request failed';
    throw new Error(msg);
  }
  return data;
}

/**
 * @param {string} fullName
 * @returns {{ owner: string, repo: string } | null}
 */
export function parseOwnerRepo(fullName) {
  const s = fullName.trim();
  const i = s.indexOf('/');
  if (i <= 0 || i === s.length - 1) return null;
  const owner = s.slice(0, i);
  const repo = s.slice(i + 1);
  if (!owner || !repo || owner.includes('/') || repo.includes('/')) return null;
  return { owner, repo };
}

/**
 * @param {string | null | undefined} d
 */
function shortDate(d) {
  if (!d) return '';
  try {
    return new Date(d).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return String(d);
  }
}

/**
 * @param {string} sha
 */
function shortSha(sha) {
  if (!sha || typeof sha !== 'string') return '';
  return sha.length > 7 ? sha.slice(0, 7) : sha;
}

/**
 * @param {Record<string, unknown>} event
 * @param {string} fullName owner/repo
 */
function eventToUrl(event, fullName) {
  const t = event.type;
  const p = /** @type {Record<string, unknown>} */ (event.payload) || {};
  switch (t) {
    case 'IssuesEvent':
      return /** @type {any} */ (p.issue)?.html_url;
    case 'IssueCommentEvent':
      return /** @type {any} */ (p.comment)?.html_url;
    case 'PullRequestEvent':
    case 'PullRequestReviewEvent':
      return (
        /** @type {any} */ (p.pull_request)?.html_url || /** @type {any} */ (p.comment)?.html_url
      );
    case 'PullRequestReviewCommentEvent':
      return /** @type {any} */ (p.comment)?.html_url || /** @type {any} */ (p.pull_request)?.html_url;
    case 'PushEvent': {
      const before = /** @type {any} */ (p).before;
      const head = /** @type {any} */ (p).head;
      if (before && head) {
        return `https://github.com/${fullName}/compare/${before}...${head}`;
      }
      return /** @type {any} */ (p).compare;
    }
    case 'ReleaseEvent':
      return /** @type {any} */ (p.release)?.html_url;
    case 'ForkEvent':
      return /** @type {any} */ (p.forkee)?.html_url;
    case 'CreateEvent': {
      const refType = /** @type {any} */ (p).ref_type;
      const ref = /** @type {any} */ (p).ref;
      if (refType === 'tag' && ref) {
        return `https://github.com/${fullName}/releases/tag/${ref}`;
      }
      if (refType === 'branch' && ref) {
        return `https://github.com/${fullName}/tree/${ref}`;
      }
      return `https://github.com/${fullName}`;
    }
    case 'DeleteEvent':
    case 'WatchEvent':
    case 'PublicEvent':
    default:
      return `https://github.com/${fullName}`;
  }
}

/**
 * @param {string} kind
 * @param {string} owner
 * @param {string} repo
 * @param {string} token
 * @returns {Promise<{ title: string, subtitle: string, html_url: string, rowKind: string }[]>}
 */
export async function fetchRepoViewItems(kind, owner, repo, token) {
  const fullName = `${owner}/${repo}`;
  const enc = (s) => encodeURIComponent(s);

  switch (kind) {
    case 'repo': {
      const r = await ghGet(`https://api.github.com/repos/${enc(owner)}/${enc(repo)}`, token);
      const desc = (r.description && String(r.description)) || 'No description';
      const bits = [
        r.stargazers_count != null ? `★ ${r.stargazers_count}` : '',
        r.language ? String(r.language) : '',
        r.open_issues_count != null ? `${r.open_issues_count} open issues` : '',
      ].filter(Boolean);
      return [
        {
          title: fullName,
          subtitle: bits.length ? `${desc} · ${bits.join(' · ')}` : desc,
          html_url: r.html_url || `https://github.com/${fullName}`,
          rowKind: 'repo',
        },
      ];
    }
    case 'releases': {
      const list = await ghGet(
        `https://api.github.com/repos/${enc(owner)}/${enc(repo)}/releases?per_page=20`,
        token,
      );
      if (!Array.isArray(list)) return [];
      return list.map((rel) => ({
        title: (rel.name && String(rel.name).trim()) || rel.tag_name || 'Release',
        subtitle: [rel.tag_name, rel.prerelease ? 'pre' : null, shortDate(rel.published_at)]
          .filter(Boolean)
          .join(' · '),
        html_url: rel.html_url,
        rowKind: 'release',
      }));
    }
    case 'ci': {
      const data = await ghGet(
        `https://api.github.com/repos/${enc(owner)}/${enc(repo)}/actions/runs?per_page=20`,
        token,
      );
      const runs = data.workflow_runs;
      if (!Array.isArray(runs)) return [];
      return runs.map((run) => ({
        title: run.name || 'Workflow run',
        subtitle: [
          run.status,
          run.conclusion,
          run.head_branch,
          shortDate(run.created_at),
        ]
          .filter(Boolean)
          .join(' · '),
        html_url: run.html_url,
        rowKind: 'ci',
      }));
    }
    case 'tags': {
      const list = await ghGet(
        `https://api.github.com/repos/${enc(owner)}/${enc(repo)}/tags?per_page=20`,
        token,
      );
      if (!Array.isArray(list)) return [];
      return list.map((tag) => {
        const sha = /** @type {any} */ (tag.commit)?.sha;
        return {
          title: tag.name,
          subtitle: shortSha(sha) || 'tag',
          html_url: sha
            ? `https://github.com/${fullName}/commit/${sha}`
            : `https://github.com/${fullName}/releases/tag/${encodeURIComponent(tag.name)}`,
          rowKind: 'tag',
        };
      });
    }
    case 'branches': {
      const list = await ghGet(
        `https://api.github.com/repos/${enc(owner)}/${enc(repo)}/branches?per_page=20`,
        token,
      );
      if (!Array.isArray(list)) return [];
      return list.map((br) => {
        const sha = /** @type {any} */ (br.commit)?.sha;
        const refPath = String(br.name)
          .split('/')
          .map((p) => encodeURIComponent(p))
          .join('/');
        return {
          title: br.name,
          subtitle: shortSha(sha),
          html_url: `https://github.com/${fullName}/tree/${refPath}`,
          rowKind: 'branch',
        };
      });
    }
    case 'commits': {
      const list = await ghGet(
        `https://api.github.com/repos/${enc(owner)}/${enc(repo)}/commits?per_page=20`,
        token,
      );
      if (!Array.isArray(list)) return [];
      return list.map((c) => {
        const msg = /** @type {any} */ (c.commit)?.message;
        const first = typeof msg === 'string' ? msg.split('\n')[0].trim() : 'Commit';
        const who =
          /** @type {any} */ (c.commit)?.author?.name ||
          /** @type {any} */ (c.author)?.login ||
          '';
        return {
          title: first || 'Commit',
          subtitle: [shortSha(c.sha), who].filter(Boolean).join(' · '),
          html_url: c.html_url,
          rowKind: 'commit',
        };
      });
    }
    case 'activity': {
      const list = await ghGet(
        `https://api.github.com/repos/${enc(owner)}/${enc(repo)}/events?per_page=20`,
        token,
      );
      if (!Array.isArray(list)) return [];
      return list.map((ev) => {
        const who = /** @type {any} */ (ev.actor)?.login || '';
        return {
          title: `${ev.type || 'Event'}${who ? ` · ${who}` : ''}`,
          subtitle: shortDate(ev.created_at),
          html_url: eventToUrl(ev, fullName) || `https://github.com/${fullName}`,
          rowKind: 'activity',
        };
      });
    }
    default:
      return [];
  }
}
