// Load configuration
importScripts('config.js');

// Cache for worklog data (5 minute TTL)
const WORKLOG_CACHE = {};
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

chrome.runtime.onMessage.addListener((req, sender, sendResponse) => {
  if (req.action === 'syncLogs') {
    (async () => {
      try {
        // Check cache first
        const cached = WORKLOG_CACHE[req.date];
        if (cached && (Date.now() - cached.timestamp < CACHE_TTL)) {
          console.log('[BG] Returning cached logs for date:', req.date);
          sendResponse(cached.response);
          return;
        }
        
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
        
        // Cache the response
        WORKLOG_CACHE[req.date] = {
          timestamp: Date.now(),
          response: response,
          rawLogs: logs
        };
        
        console.log('[BG] Sending response:', response);
        sendResponse(response);
      } catch (e) {
        console.error('[BG] Error:', e);
        sendResponse({ success: false, error: e.message });
      }
    })();
    return true;
  } else if (req.action === 'getDateHours') {
    (async () => {
      try {
        // Check cache first
        const cached = WORKLOG_CACHE[req.date];
        if (cached && (Date.now() - cached.timestamp < CACHE_TTL)) {
          const totalHours = parseFloat(cached.rawLogs.reduce((s, l) => s + l.hours, 0).toFixed(2));
          console.log('[BG] Returning cached hours for date:', req.date, ':', totalHours);
          sendResponse({ success: true, totalHours });
          return;
        }
        
        console.log('[BG] Getting hours for date:', req.date);
        const logs = await getWorklogs(req.date);
        const totalHours = parseFloat(logs.reduce((s, l) => s + l.hours, 0).toFixed(2));
        
        // Cache the data for future syncLogs calls
        const grouped = {};
        logs.forEach(l => {
          grouped[l.key] = (grouped[l.key] || 0) + l.hours;
        });
        const list = Object.keys(grouped).map(k => ({ issueKey: k, hours: grouped[k].toFixed(2) }));
        WORKLOG_CACHE[req.date] = {
          timestamp: Date.now(),
          response: { success: true, count: list.length, logs: list, totalHours: totalHours.toFixed(2) },
          rawLogs: logs
        };
        
        console.log('[BG] Total hours:', totalHours);
        sendResponse({ success: true, totalHours });
      } catch (e) {
        console.error('[BG] Error getting hours:', e);
        sendResponse({ success: false, error: e.message });
      }
    })();
    return true;
  }
});

async function getWorklogs(date) {
  const domain = CONFIG.JIRA_DOMAIN;
  
  console.log('[BG] getWorklogs: Starting');
  // Get user
  console.log('[BG] Fetching user profile...');
  const user = await call(domain, '/rest/api/3/myself');
  const uid = user.accountId;
  console.log('[BG] Got user:', uid);
  
  // Search: get issues user worked on
  console.log('[BG] Searching for issues...');
  const res = await call(domain, '/rest/api/3/search/jql', {
    jql: `worklogAuthor = "${uid}"`,
    fields: 'key',
    maxResults: 500
  });
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
  
  // Fetch worklogs for all issues in parallel
  const worklogPromises = (res.issues || []).map(issue => 
    call(domain, `/rest/api/3/issue/${issue.key}/worklog`)
      .then(wl => ({ issue: issue.key, worklogs: wl.worklogs || [] }))
      .catch(e => {
        console.error(`Failed for ${issue.key}:`, e.message);
        return { issue: issue.key, worklogs: [] };
      })
  );
  
  const allWorklogs = await Promise.all(worklogPromises);
  console.log('[BG] Fetched all worklogs, filtering...');
  
  const logs = [];
  for (const { issue, worklogs } of allWorklogs) {
    for (const w of worklogs) {
      const wdate = fmt.format(new Date(w.started));
      const matches = wdate === date && w.author.accountId === uid;
      if (issue === 'PRC-30682' || issue === 'PRC-30153') {
        console.log(`[BG] ${issue}: started=${w.started}, wdate=${wdate}, target date=${date}, author=${w.author.accountId}, uid=${uid}, matches=${matches}`);
      }
      if (matches) {
        logs.push({
          key: issue,
          hours: w.timeSpentSeconds / 3600
        });
      }
    }
  }
  
  console.log('[BG] Filtered logs:', logs);
  return logs;
}

async function call(domain, endpoint, params) {
  let url = `https://${domain}${endpoint}`;
  const opts = { headers: { Accept: 'application/json' } };
  
  // Get the session token from cookies
  try {
    if (chrome.cookies) {
      const cookies = await chrome.cookies.get({ url: `https://${domain}/`, name: 'tenant.session.token' });
      if (cookies) {
        opts.headers['Cookie'] = `tenant.session.token=${cookies.value}`;
      }
    }
  } catch (e) {
    console.warn('[BG] Failed to get cookies:', e.message);
  }
  
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
  
  // Use AbortController if available
  let timeout;
  let signal;
  if (typeof AbortController !== 'undefined') {
    const controller = new AbortController();
    timeout = setTimeout(() => controller.abort(), 30000); // 30s timeout
    signal = controller.signal;
  }
  
  try {
    const fetchOpts = signal ? { ...opts, signal } : opts;
    const r = await fetch(url, fetchOpts);
    if (timeout) clearTimeout(timeout);
    console.log('[BG] Response:', r.status);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    
    const text = await r.text();
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
    if (timeout) clearTimeout(timeout);
    console.error('[BG] Fetch error:', e.message);
    throw e;
  }
}
