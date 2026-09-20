/**
 * LinkedIn search-results parser.
 *
 * Reads the profile cards already rendered on a people-search page the user is
 * looking at. It does not paginate, navigate, or call any LinkedIn endpoint —
 * everything here comes from the DOM of the page in front of the user.
 */
(function () {
  const SEARCH_PATHS = ['/search/results/people', '/search/results/all'];

  /** LinkedIn ships several card layouts; try each in turn. */
  const CARD_SELECTORS = [
    'li.reusable-search__result-container',
    'div.entity-result',
    'li.artdeco-list__item',
    'div[data-view-name="search-entity-result-universal-template"]',
  ];

  const NAME_SELECTORS = [
    'span.entity-result__title-text a span[aria-hidden="true"]',
    '.entity-result__title-text a span[dir="ltr"] span[aria-hidden="true"]',
    'a[href*="/in/"] span[aria-hidden="true"]',
  ];

  function isSearchPage() {
    return SEARCH_PATHS.some((path) => window.location.pathname.startsWith(path));
  }

  function text(element) {
    return element ? element.innerText.trim() : '';
  }

  function firstMatch(root, selectors) {
    for (const selector of selectors) {
      const found = root.querySelector(selector);
      if (found) return found;
    }
    return null;
  }

  // Shared with linkedin-parser.js and with the test suite; parse-helpers.js is
  // listed before this file in the manifest.
  const { splitName, companyFromHeadline, normaliseProfileUrl } =
    globalThis.AIJobSearchParseHelpers;

  function parseCard(card) {
    const nameEl = firstMatch(card, NAME_SELECTORS);
    const fullName = text(nameEl);
    if (!fullName || /linkedin member/i.test(fullName)) return null;

    const { firstName, lastName } = splitName(fullName);
    if (!firstName || !lastName) return null;

    const link = card.querySelector('a[href*="/in/"]');
    const profileUrl = normaliseProfileUrl(link && link.getAttribute('href'), window.location.origin);
    if (!profileUrl) return null;

    const headline = text(
      card.querySelector('.entity-result__primary-subtitle') ||
      card.querySelector('div[class*="subtitle"]')
    );
    const location = text(
      card.querySelector('.entity-result__secondary-subtitle') ||
      card.querySelector('div[class*="secondary-subtitle"]')
    );
    const image = card.querySelector('img');

    return {
      fullName,
      firstName,
      lastName,
      headline,
      company: companyFromHeadline(headline),
      location,
      profileUrl,
      photo: image ? image.src : '',
    };
  }

  function parseSearchResults() {
    if (!isSearchPage()) return [];

    let cards = [];
    for (const selector of CARD_SELECTORS) {
      cards = Array.from(document.querySelectorAll(selector));
      if (cards.length > 0) break;
    }

    const seen = new Set();
    const profiles = [];

    for (const card of cards) {
      let parsed = null;
      try {
        parsed = parseCard(card);
      } catch (err) {
        console.warn('[search-parser] Could not read a result card:', err);
      }
      if (!parsed || seen.has(parsed.profileUrl)) continue;
      seen.add(parsed.profileUrl);
      profiles.push(parsed);
    }

    return profiles;
  }

  function injectBanner(count) {
    const existing = document.getElementById('ai-job-search-bulk-banner');
    if (existing) existing.remove();
    if (count === 0) return;

    const banner = document.createElement('div');
    banner.id = 'ai-job-search-bulk-banner';
    banner.style.cssText =
      'position:fixed;bottom:24px;right:24px;z-index:999999;background:white;border:1px solid #e2e8f0;' +
      'border-radius:8px;box-shadow:0 4px 12px rgba(0,0,0,0.15);padding:12px 16px;' +
      "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:14px;color:#0f172a;";
    banner.innerHTML =
      `<div style="display:flex;align-items:center;gap:12px;">` +
      `<span><strong id="ai-job-search-bulk-count">${count}</strong> profiles on this page</span>` +
      `<button id="ai-job-search-bulk-btn" style="background:#0f172a;color:white;border:none;border-radius:6px;padding:6px 12px;font-size:13px;font-weight:600;cursor:pointer;">Send to Job Search</button>` +
      `</div><div id="ai-job-search-bulk-status" style="margin-top:6px;font-size:12px;color:#64748b;"></div>`;
    document.body.appendChild(banner);

    document.getElementById('ai-job-search-bulk-btn').addEventListener('click', () => {
      const profiles = parseSearchResults();
      const status = document.getElementById('ai-job-search-bulk-status');
      status.textContent = `Sending ${profiles.length} profiles…`;

      chrome.runtime.sendMessage({ type: 'linkedin-search-parsed', payload: profiles });

      // Only profiles that carry a usable employer can be discovered.
      const discoverable = profiles.filter((p) => p.company);
      if (discoverable.length === 0) {
        status.textContent = 'Sent. None of these cards name an employer, so none can be looked up yet.';
        return;
      }

      chrome.runtime.sendMessage(
        {
          type: 'bulk-discover',
          payload: discoverable.map((p) => ({
            firstName: p.firstName,
            lastName: p.lastName,
            company: p.company,
            linkedinUrl: p.profileUrl,
          })),
        },
        (response) => {
          if (chrome.runtime.lastError) {
            status.textContent = `Failed: ${chrome.runtime.lastError.message}`;
            return;
          }
          if (!response || !response.success) {
            status.textContent = `Failed: ${(response && response.error) || 'no response from the extension'}`;
            return;
          }
          const rows = (response.data && response.data.data) || [];
          const found = rows.filter((r) => r.status === 'success').length;
          status.textContent = `Discovery finished for ${found} of ${discoverable.length} profiles.`;
        }
      );
    });
  }

  function refresh() {
    if (!isSearchPage()) {
      const banner = document.getElementById('ai-job-search-bulk-banner');
      if (banner) banner.remove();
      return;
    }
    injectBanner(parseSearchResults().length);
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'parse-search-results') {
      sendResponse({ profiles: parseSearchResults() });
      return true;
    }
  });

  // Results re-render as the user scrolls and filters, so re-read on a settle.
  let debounce = null;
  let lastUrl = location.href;
  new MutationObserver(() => {
    if (location.href !== lastUrl) lastUrl = location.href;
    clearTimeout(debounce);
    debounce = setTimeout(refresh, 1200);
  }).observe(document, { subtree: true, childList: true });

  if (document.readyState === 'complete') {
    setTimeout(refresh, 1500);
  } else {
    window.addEventListener('load', () => setTimeout(refresh, 1500));
  }
})();
