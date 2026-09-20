// popup.js

document.addEventListener('DOMContentLoaded', () => {
  // Load settings
  chrome.storage.sync.get(['apiUrl'], (result) => {
    if (result.apiUrl) {
      document.getElementById('apiUrl').value = result.apiUrl;
    }
  });

  loadRecentSearches();

  // Save settings
  document.getElementById('saveSettingsBtn').addEventListener('click', () => {
    const apiUrl = document.getElementById('apiUrl').value.trim();
    chrome.storage.sync.set({ apiUrl }, () => {
      const msg = document.getElementById('settingsMessage');
      msg.textContent = 'Settings saved!';
      setTimeout(() => { msg.textContent = ''; }, 2000);
    });
  });

  // Handle Search Form
  document.getElementById('searchForm').addEventListener('submit', async (e) => {
    e.preventDefault();

    const firstName = document.getElementById('firstName').value.trim();
    const lastName = document.getElementById('lastName').value.trim();
    const company = document.getElementById('company').value.trim();

    const btn = document.getElementById('searchBtn');
    btn.textContent = 'Searching...';
    btn.disabled = true;

    try {
      // The API validates firstName/lastName/company separately. This used to
      // post a single `name` field, so every request failed validation and the
      // popup silently fell through to invented addresses.
      const response = await sendMessage({
        type: 'discover-contacts',
        payload: { firstName, lastName, company }
      });

      if (!response || !response.success) {
        showError((response && response.error) || 'Could not reach the job search app.');
        return;
      }

      const contact = response.data && response.data.data && response.data.data.contact;
      displayResults((contact && contact.emails) || []);
      saveRecentSearch(firstName, lastName, company);
    } catch (err) {
      console.error(err);
      showError(err.message || 'Discovery failed.');
    } finally {
      btn.textContent = 'Find Email';
      btn.disabled = false;
    }
  });
});

function sendMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(response);
    });
  });
}

/**
 * Show a failure as a failure.
 *
 * An unreachable API used to render two invented addresses at 95% and 70%
 * confidence, which looks exactly like a successful lookup.
 */
function showError(message) {
  const section = document.getElementById('resultsSection');
  const list = document.getElementById('resultsList');
  section.style.display = 'block';
  list.textContent = '';

  const div = document.createElement('div');
  div.style.cssText = 'font-size:13px;color:#b91c1c;';
  div.textContent = message;
  list.appendChild(div);
}

function displayResults(emails) {
  const section = document.getElementById('resultsSection');
  const list = document.getElementById('resultsList');

  section.style.display = 'block';
  list.textContent = '';

  if (!emails || emails.length === 0) {
    const empty = document.createElement('p');
    empty.style.cssText = 'font-size: 13px; color: #586069;';
    empty.textContent = 'No addresses found for this person.';
    list.appendChild(empty);
    return;
  }

  emails.forEach((item) => {
    // The API returns `address`, not `email`.
    const address = item.address || '';
    if (!address) return;

    const div = document.createElement('div');
    div.className = 'result-item';

    const info = document.createElement('div');

    const emailEl = document.createElement('div');
    emailEl.className = 'result-email';
    emailEl.textContent = address;
    info.appendChild(emailEl);

    const meta = document.createElement('div');
    meta.className = 'result-confidence';
    // No default confidence: an absent number means the engine did not report
    // one, which is not the same as a high one.
    const confidence = typeof item.confidence === 'number' ? `${item.confidence}%` : 'not scored';
    meta.textContent =
      item.source === 'pattern'
        ? `Inferred from the company pattern · ${confidence}`
        : `Found publicly (${item.source || 'unknown source'}) · ${confidence}`;
    info.appendChild(meta);

    div.appendChild(info);

    const copyBtn = document.createElement('button');
    copyBtn.className = 'btn btn-secondary btn-sm copy-btn';
    copyBtn.dataset.email = address;
    copyBtn.textContent = 'Copy';
    div.appendChild(copyBtn);

    list.appendChild(div);
  });

  document.querySelectorAll('.copy-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      navigator.clipboard.writeText(e.target.dataset.email);
      const originalText = e.target.textContent;
      e.target.textContent = 'Copied!';
      setTimeout(() => { e.target.textContent = originalText; }, 2000);
    });
  });
}

function saveRecentSearch(firstName, lastName, company) {
  chrome.storage.local.get(['recentSearches'], (result) => {
    let searches = result.recentSearches || [];
    const search = { name: `${firstName} ${lastName}`, company, date: new Date().toISOString() };

    // Add to beginning and keep only last 5
    searches = [search, ...searches.filter((s) => s.name !== search.name)].slice(0, 5);

    chrome.storage.local.set({ recentSearches: searches }, () => {
      loadRecentSearches();
    });
  });
}

function loadRecentSearches() {
  chrome.storage.local.get(['recentSearches'], (result) => {
    const list = document.getElementById('recentList');
    list.textContent = '';

    const searches = result.recentSearches || [];

    if (searches.length === 0) {
      const empty = document.createElement('div');
      empty.style.cssText = 'font-size: 13px; color: #586069;';
      empty.textContent = 'No recent searches';
      list.appendChild(empty);
      return;
    }

    searches.forEach((search) => {
      const div = document.createElement('div');
      div.className = 'recent-item';

      const nameSpan = document.createElement('span');
      const strong = document.createElement('strong');
      strong.textContent = search.name;
      nameSpan.appendChild(strong);

      const companySpan = document.createElement('span');
      companySpan.textContent = search.company || '';

      div.appendChild(nameSpan);
      div.appendChild(companySpan);
      list.appendChild(div);
    });
  });
}
