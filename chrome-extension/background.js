// Background service worker — AI Job Search LinkedIn Insight Extension v2.0.0

chrome.runtime.onInstalled.addListener(() => {
  console.log('LinkedIn Insight Extension installed (v2.0.0)');
});

// A Chrome match pattern with no port matches EVERY port on that host. The
// hardcoded :3000 matched only the Next.js default, so the bridge silently
// failed to find the app whenever the dev server ran anywhere else — this
// project's own dev server listens on 8787 (PORT is set in the environment).
const WEBAPP_URLS = ['http://localhost/*', 'https://ai-job-search-engine.vercel.app/*'];

/** Push a message into every open web app tab that has the bridge injected. */
function broadcastToWebApp(message) {
  chrome.tabs.query({ url: WEBAPP_URLS }, (tabs) => {
    if (chrome.runtime.lastError) {
      console.warn('[BG] tabs.query error:', chrome.runtime.lastError.message);
      return;
    }
    tabs.forEach((tab) => {
      if (tab.id) {
        chrome.tabs.sendMessage(tab.id, message).catch(() => {
          // Ignore — tab may not have the bridge injected yet
        });
      }
    });
  });
}

// --- Internal messages (from content scripts) ---
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Original discover-contacts handler (backward compat with popup)
  if (message.type === 'discover-contacts') {
    handleDiscoverContacts(message.payload)
      .then(data => sendResponse({ success: true, data }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  // Bulk discovery from a parsed search results page
  if (message.type === 'bulk-discover') {
    handleBulkDiscover(message.payload || [])
      .then(data => sendResponse({ success: true, data }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  // Search results parsed — cache them and hand them to any open web app tab
  if (message.type === 'linkedin-search-parsed') {
    const profiles = message.payload || [];
    console.log(`[BG] Search results parsed: ${profiles.length} profiles`);
    chrome.storage.session.set({ latestLinkedInSearch: profiles }, () => {
      broadcastToWebApp({ type: 'linkedin-search-data', payload: profiles });
    });
    return false;
  }

  if (message.type === 'request-linkedin-search') {
    chrome.storage.session.get('latestLinkedInSearch', (data) => {
      sendResponse({ payload: data.latestLinkedInSearch || [] });
    });
    return true;
  }

  // Settings handler
  if (message.type === 'get-settings') {
    chrome.storage.sync.get(['apiUrl'], (result) => {
      sendResponse({ apiUrl: result.apiUrl || 'http://localhost:3000' });
    });
    return true;
  }

  // LinkedIn profile parsed — save and broadcast to all web app tabs
  if (message.type === 'linkedin-profile-parsed') {
    console.log('[BG] Profile parsed:', message.payload?.name);
    chrome.storage.session.set({ latestLinkedInProfile: message.payload }, () => {
      broadcastToWebApp({ type: 'linkedin-profile-data', payload: message.payload });
    });
    return false;
  }

  // Request the latest profile from session storage
  if (message.type === 'request-linkedin-profile') {
    chrome.storage.session.get('latestLinkedInProfile', (data) => {
      sendResponse({ payload: data.latestLinkedInProfile || null });
    });
    return true;
  }
});

// --- External messages (from web app via externally_connectable) ---
chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
  if (message.type === 'get-linkedin-profile') {
    chrome.storage.session.get('latestLinkedInProfile', (data) => {
      sendResponse({ payload: data.latestLinkedInProfile || null });
    });
    return true;
  }

  if (message.type === 'ping') {
    sendResponse({ status: 'ok', version: '2.0.0' });
    return false;
  }
});

// --- Original discover-contacts fetch logic ---
async function handleDiscoverContacts(profileData) {
  const apiUrl = await getApiUrl();
  return postJson(`${apiUrl}/api/contacts/discover`, profileData);
}

// --- Bulk discovery from a LinkedIn search results page ---
async function handleBulkDiscover(profiles) {
  const apiUrl = await getApiUrl();
  // The API rejects anything over 50 profiles in one request.
  return postJson(`${apiUrl}/api/contacts/bulk-discover`, { profiles: profiles.slice(0, 50) });
}

/**
 * Where the web app is.
 *
 * An explicit setting always wins. Otherwise the origin is taken from an open
 * app tab, because the dev server's port is not knowable in advance — this
 * project's runs on 8787, Next's default is 3000, and a wrong guess fails as a
 * silent connection error rather than anything the user can act on.
 */
function getApiUrl() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(['apiUrl'], (result) => {
      if (result.apiUrl) {
        resolve(result.apiUrl);
        return;
      }
      chrome.tabs.query({ url: WEBAPP_URLS }, (tabs) => {
        if (!chrome.runtime.lastError && tabs && tabs.length > 0) {
          try {
            resolve(new URL(tabs[0].url).origin);
            return;
          } catch (_) {
            // Fall through to the default below.
          }
        }
        resolve('http://localhost:3000');
      });
    });
  });
}

/**
 * POST JSON and surface failures as failures.
 *
 * This used to answer a failed localhost request with invented placeholder
 * addresses at 95% confidence, which is indistinguishable in the popup from a
 * real discovery. An unreachable API must read as unreachable.
 */
async function postJson(endpoint, body) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    let detail = `${response.status} ${response.statusText}`;
    try {
      const errorBody = await response.json();
      if (errorBody?.error) detail = errorBody.error;
    } catch (_) {
      // Response had no JSON body; the status line is the best detail we have.
    }
    throw new Error(detail);
  }

  return response.json();
}
