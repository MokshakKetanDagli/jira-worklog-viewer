// Load configuration
importScripts('config.js');

// NOTE: Caching intentionally disabled.
// The popup now loads only today's date on open and lazily fetches past days
// only when the user navigates backwards.
//
// const WORKLOG_CACHE = {};
// const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Background request throttling: month view can trigger many dates quickly.
// Limiting concurrency avoids aborted fetches and Jira throttling.
const MAX_BG_CONCURRENCY = 2;
let bgActive = 0;
const bgQueue = [];

let CURRENT_USER_ACCOUNT_ID = null;

// Per-popup connection state for cancellation.
// When the popup closes, the port disconnects and we stop scheduling further month work.
const PORT_STATE = new Map(); // port -> { disconnected:boolean, monthSessionId:number, monthSessionKey:string|null }

function enqueueBgTask(task) {
  bgQueue.push(task);
  drainBgQueue();
}

function drainBgQueue() {
  while (bgActive < MAX_BG_CONCURRENCY && bgQueue.length > 0) {
    const next = bgQueue.shift();
    bgActive++;
    Promise.resolve()
      .then(next)
      .catch(() => {})
      .finally(() => {
        bgActive--;
        drainBgQueue();
      });
  }
}

function makePortShouldCancel(port, req) {
  return () => {
    const st = PORT_STATE.get(port);
    if (!st) return true;
    if (st.disconnected) return true;

    // Only month-prefetch requests are cancellable by session.
    if (req && req.kind === 'month') {
      const sid = Number(req.monthSessionId || 0);
      if (sid && sid !== st.monthSessionId) return true;
      const key = req.monthSessionKey || null;
      if (key && st.monthSessionKey && key !== st.monthSessionKey) return true;
    }

    return false;
  };
}

chrome.runtime.onConnect.addListener((port) => {
  if (!port) return;
  PORT_STATE.set(port, { disconnected: false, monthSessionId: 0, monthSessionKey: null });

  port.onDisconnect.addListener(() => {
    const st = PORT_STATE.get(port);
    if (st) st.disconnected = true;
    PORT_STATE.delete(port);
  });

  port.onMessage.addListener((msg) => {
    const requestId = msg && msg.requestId ? msg.requestId : null;
    const req = msg && msg.payload ? msg.payload : null;
    if (!req) return;

    // Control message: bump/cancel month session.
    if (req.action === 'setMonthSession') {
      const st = PORT_STATE.get(port);
      if (st) {
        st.monthSessionId = Number(req.monthSessionId || 0);
        st.monthSessionKey = req.monthSessionKey || null;
      }
      return;
    }

    if (req.action === 'syncLogs') {
      const shouldCancel = makePortShouldCancel(port, req);
      enqueueBgTask(async () => {
        if (shouldCancel()) return;
        try {
          console.log('[BG] (port) Fetching logs for date:', req.date, req.kind || '');
          const logs = await getWorklogs(req.date, shouldCancel);
          if (shouldCancel()) return;
          const total = logs.reduce((s, l) => s + l.hours, 0).toFixed(2);
          const grouped = {};
          logs.forEach(l => {
            grouped[l.key] = (grouped[l.key] || 0) + l.hours;
          });
          const list = Object.keys(grouped).map(k => ({ issueKey: k, hours: grouped[k].toFixed(2) }));
          const response = { success: true, count: list.length, logs: list, totalHours: total };
          if (requestId) port.postMessage({ requestId, payload: response });
        } catch (e) {
          if (shouldCancel()) return;
          const err = { success: false, error: e.message };
          if (requestId) port.postMessage({ requestId, payload: err });
        }
      });
    }
  });
});

chrome.runtime.onMessage.addListener((req, sender, sendResponse) => {
  if (req.action === 'syncLogs') {
    enqueueBgTask(async () => {
      try {
        console.log('[BG] Fetching logs for date:', req.date);
        const logs = await getWorklogs(req.date);
        console.log('[BG] Got logs:', logs);
        const total = logs.reduce((s, l) => s + l.hours, 0).toFixed(2);
        const grouped = {};
        logs.forEach(l => {
          grouped[l.key] = (grouped[l.key] || 0) + l.hours;
        });
        const list = Object.keys(grouped).map(k => ({ issueKey: k, hours: grouped[k].toFixed(2) }));
        const response = { success: true, count: list.length, logs: list, totalHours: total };

        console.log('[BG] Sending response:', response);
        sendResponse(response);
      } catch (e) {
        console.error('[BG] Error:', e);
        sendResponse({ success: false, error: e.message });
      }
    });
    return true;
  } else if (req.action === 'getDateHours') {
    enqueueBgTask(async () => {
      try {
        console.log('[BG] Getting hours for date:', req.date);
        const logs = await getWorklogs(req.date);
        const totalHours = parseFloat(logs.reduce((s, l) => s + l.hours, 0).toFixed(2));

        console.log('[BG] Total hours:', totalHours);
        sendResponse({ success: true, totalHours });
      } catch (e) {
        console.error('[BG] Error getting hours:', e);
        sendResponse({ success: false, error: e.message });
      }
    });
    return true;
  }
});

async function getWorklogs(date, shouldCancel) {
  const domain = CONFIG.JIRA_DOMAIN;
  
  console.log('[BG] getWorklogs: Starting');
  if (shouldCancel && shouldCancel()) return [];

  // Worklog endpoint returns worklogs for ALL users on an issue.
  // Fetch current user's accountId so we can filter precisely.
  let currentAccountId = CURRENT_USER_ACCOUNT_ID;
  if (!currentAccountId) {
    try {
      const me = await call(domain, '/rest/api/3/myself');
      currentAccountId = me && me.accountId ? String(me.accountId) : null;
      if (currentAccountId) CURRENT_USER_ACCOUNT_ID = currentAccountId;
    } catch (e) {
      // If we can't resolve current user, proceed without author filtering (best-effort).
      currentAccountId = null;
    }
  }
  // Search: only issues that have worklogs for this exact date by the current user.
  // This avoids fetching worklogs for hundreds of unrelated issues per date.
  console.log('[BG] Searching for issues with worklogs on date...');
  const res = await call(domain, '/rest/api/3/search/jql', {
    jql: `worklogAuthor = currentUser() AND worklogDate = "${date}"`,
    fields: 'key',
    maxResults: 80
  });
  if (shouldCancel && shouldCancel()) return [];
  console.log('[BG] Got issues:', res.issues?.length || 0);
  
  // Handle case where search returns no issues
  if (!res.issues || res.issues.length === 0) {
    console.log('[BG] No issues found');
    return [];
  }
  
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: CONFIG.TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  
  // Fetch worklogs for issues with limited concurrency.
  const issues = res.issues || [];
  const allWorklogs = await mapWithConcurrency(issues, 4, async (issue) => {
    if (shouldCancel && shouldCancel()) return { issue: issue.key, worklogs: [] };
    try {
      const wl = await call(domain, `/rest/api/3/issue/${issue.key}/worklog`);
      return { issue: issue.key, worklogs: wl.worklogs || [] };
    } catch (e) {
      console.error(`Failed for ${issue.key}:`, e.message);
      return { issue: issue.key, worklogs: [] };
    }
  });
  console.log('[BG] Fetched all worklogs, filtering...');
  
  const logs = [];
  for (const { issue, worklogs } of allWorklogs) {
    if (shouldCancel && shouldCancel()) return logs;
    for (const w of worklogs) {
      if (!w || !w.started) continue;

      if (currentAccountId) {
        const authorId = w.author && w.author.accountId ? String(w.author.accountId) : null;
        if (authorId && authorId !== currentAccountId) continue;
      }

      let wdate;
      try {
        wdate = fmt.format(new Date(w.started));
      } catch {
        continue;
      }

      if (wdate !== date) continue;
      const seconds = Number(w.timeSpentSeconds);
      if (!Number.isFinite(seconds)) continue;

      logs.push({
        key: issue,
        hours: seconds / 3600
      });
    }
  }
  
  console.log('[BG] Filtered logs:', logs);
  return logs;
}

async function mapWithConcurrency(items, limit, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;

  const workers = new Array(Math.min(limit, items.length)).fill(0).map(async () => {
    while (nextIndex < items.length) {
      const i = nextIndex;
      nextIndex++;
      results[i] = await mapper(items[i], i);
    }
  });

  await Promise.all(workers);
  return results;
}

async function call(domain, endpoint, params) {
  let url = `https://${domain}${endpoint}`;
  const opts = {
    headers: { Accept: 'application/json' },
    // Ensure Jira session cookies are sent for authenticated requests.
    credentials: 'include'
  };
  
  if (params) {
    if (endpoint.includes('/search')) {
      // For search/jql endpoint, use query parameters
      const query = new URLSearchParams();
      if (params.jql) query.append('jql', params.jql);
      if (params.maxResults) query.append('maxResults', params.maxResults);
      if (params.fields) query.append('fields', params.fields);
      url += '?' + query.toString();
    } else {
      // For other endpoints, use POST
      opts.method = 'POST';
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(params);
    }
  }
  
  console.log('[BG] Calling:', url);
  
  try {
    const maxAttempts = 3;
    let lastError;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const r = await fetch(url, opts);
        console.log('[BG] Response:', r.status);

        // Handle transient retryable statuses.
        if (r.status === 429 || r.status === 503 || r.status === 504) {
          const retryAfter = r.headers?.get?.('retry-after');
          const waitMs = retryAfter ? (parseInt(retryAfter, 10) * 1000) : (350 * attempt);
          await new Promise(res => setTimeout(res, Math.min(2000, waitMs)));
          continue;
        }

        if (!r.ok) throw new Error(`HTTP ${r.status}`);

        const text = await r.text();
        if (!text) return {};
        const ct = (r.headers && r.headers.get) ? (r.headers.get('content-type') || '') : '';
        if (ct && !ct.includes('application/json')) {
          const snippet = text.substring(0, 160);
          const looksLikeHtml = /^\s*</.test(text);
          if (looksLikeHtml) {
            throw new Error(
              `Jira returned HTML instead of JSON (likely not logged in): ${snippet}`
            );
          }
          throw new Error(`Non-JSON response (${ct}): ${snippet}`);
        }

        let json;
        try {
          json = JSON.parse(text);
        } catch (parseError) {
          console.error('[BG] JSON parse error:', parseError.message, 'Response:', text.substring(0, 100));
          throw new Error(`Failed to parse response: ${parseError.message}`);
        }

        console.log('[BG] Parsed response');
        return json;
      } catch (e) {
        lastError = e;
        const name = e && e.name ? e.name : '';
        const msg = e && e.message ? e.message : String(e);

        // Retry transient abort/network flakiness.
        const isAbortish = name === 'AbortError' || /aborted/i.test(msg) || /DOMException/i.test(msg);
        if (attempt < maxAttempts && isAbortish) {
          await new Promise(res => setTimeout(res, 250 * attempt));
          continue;
        }

        throw e;
      }
    }

    throw lastError || new Error('Unknown fetch error');
  } catch (e) {
    console.error('[BG] Fetch error:', e?.name || '', e?.message || e);
    throw e;
  }
}
