/**
 * Validate the LinkedIn parser against a real profile, without installing the extension.
 *
 * HOW TO USE
 *   1. Open a LinkedIn profile tab (a /in/<slug> URL).
 *   2. Open DevTools -> Console.
 *   3. Paste this entire file and press Enter.
 *
 * It runs the SHIPPED parser source against the live DOM and prints what it
 * extracted. The chrome.* APIs the content script calls are stubbed, so nothing
 * is sent anywhere.
 *
 * GENERATED FILE -- do not edit by hand. Regenerate with:
 *   node scripts/build-console-validator.mjs
 */

(function(){
  if (!window.chrome) window.chrome = {};
  if (!chrome.runtime) chrome.runtime = {};
  chrome.runtime.sendMessage = function(msg){ window.__AIJS_LAST = msg; };
  chrome.runtime.getURL = function(){ return ''; };
})();

/**
 * Pure text helpers shared by the LinkedIn content scripts.
 *
 * These hold the decisions that are easy to get quietly wrong — where a name
 * splits, whether a headline actually names an employer, what a profile URL
 * reduces to. They live apart from the DOM walking so they can be tested
 * without a browser: scripts/test-linkedin-parser.mjs loads this exact file.
 *
 * Content scripts listed in the same manifest entry share one isolated-world
 * global, so this must be listed BEFORE the scripts that read it.
 */
(function (root) {
  /**
   * Split a display name into first and last.
   *
   * Returns an empty lastName for anything that is not a clean multi-word name.
   * Callers drop those: inventing a surname would send a fabricated identity
   * into contact discovery, which then infers an address for a person who does
   * not exist.
   */
  function splitName(fullName) {
    if (typeof fullName !== 'string') return { firstName: '', lastName: '' };

    const cleaned = fullName
      .replace(/\s*·.*$/, '')                        // "· 2nd" degree marker
      .replace(/\s*\b\d+(st|nd|rd|th)\b\s*/gi, ' ')  // bare degree markers
      .replace(/,.*$/, '')                           // ", PhD" and similar
      .replace(/\s*\((?:he|she|they)[^)]*\)\s*/gi, ' ') // pronoun parentheticals
      .replace(/[\uD800-\uDFFF]/g, ' ')              // emoji (surrogate pairs)
      .replace(/[•·]/g, ' ')               // bullet characters
      // Leading honorifics. Left in, "Dr. Aditi Sharma" yields the first name
      // "Dr." and then an inferred address of dr.sharma@…
      .replace(/^\s*(dr|mr|mrs|ms|miss|prof|professor|sir|er|ca)\.?\s+/i, '')
      .replace(/\s+/g, ' ')
      .trim();

    if (!cleaned) return { firstName: '', lastName: '' };

    const parts = cleaned.split(' ').filter(Boolean);
    if (parts.length < 2) return { firstName: cleaned, lastName: '' };
    return { firstName: parts[0], lastName: parts[parts.length - 1] };
  }

  /**
   * Pull the employer out of a headline such as "Senior Recruiter at Acme Corp".
   *
   * Returns '' when the headline has no "at" clause. A headline on its own is
   * not evidence of where someone works, and a wrong employer produces an
   * address on the wrong domain entirely.
   */
  function companyFromHeadline(headline) {
    if (typeof headline !== 'string') return '';

    const match = headline.match(/\bat\s+(.+)$/i);
    if (!match) return '';

    return match[1]
      .split('|')[0]
      .split('·')[0]
      .replace(/\s+/g, ' ')
      .trim();
  }

  /** Reduce any LinkedIn profile href to its canonical /in/<slug> form. */
  function normaliseProfileUrl(href, origin) {
    if (typeof href !== 'string' || !href) return '';
    try {
      const url = new URL(href, origin || 'https://www.linkedin.com');
      const match = url.pathname.match(/\/in\/([^/]+)/);
      return match ? `https://www.linkedin.com/in/${decodeURIComponent(match[1])}` : '';
    } catch (_) {
      return '';
    }
  }

  /**
   * Read a connection or follower count out of its label.
   * Returns null when there is no number to read — never a zero standing in
   * for "unknown".
   */
  function parseConnectionCount(label) {
    if (typeof label !== 'string') return null;

    const match = label.replace(/,/g, '').match(/(\d+)(\+)?/);
    if (!match) return null;

    return { count: Number(match[1]), isMinimum: Boolean(match[2]) };
  }

  /** True when a parsed profile carries enough to attempt contact discovery. */
  function isDiscoverable(profile) {
    return Boolean(
      profile &&
      profile.firstName &&
      profile.lastName &&
      profile.company
    );
  }

  const helpers = {
    splitName,
    companyFromHeadline,
    normaliseProfileUrl,
    parseConnectionCount,
    isDiscoverable,
  };

  root.AIJobSearchParseHelpers = helpers;

  // Also expose for Node, so the test suite can load this file directly.
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = helpers;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);

(function () {
  let isParsing = false;

  function parseFullProfile() {
    console.log("Parsing full LinkedIn profile...");
    try {
      const profile = {
        name: document.querySelector('h1.text-heading-xlarge')?.innerText.trim() || document.querySelector('h1')?.innerText.trim() || '',
        headline: document.querySelector('.text-body-medium')?.innerText.trim() || '',
        location: document.querySelector('.text-body-small.inline.t-black--light.break-words')?.innerText.trim() || '',
        profileUrl: window.location.href,
        photo: document.querySelector('img.pv-top-card-profile-picture__image')?.src || '',
        about: '',
        experience: [],
        education: [],
        skills: [],
        certifications: [],
        connections: '',
        languages: [],
        recommendationsCount: ''
      };

      // Connections
      const connectionsLink = document.querySelector('a[href*="/connections"]');
      if (connectionsLink) {
        profile.connections = connectionsLink.innerText.trim();
      } else {
        const followers = Array.from(document.querySelectorAll('span')).find(el => el.innerText.toLowerCase().includes('followers') || el.innerText.toLowerCase().includes('connections'));
        if (followers) profile.connections = followers.innerText.trim();
      }

      // Sections
      const sections = document.querySelectorAll('section');
      sections.forEach(section => {
        const id = section.id || '';
        const titleEl = section.querySelector('h2.pvs-header__title');
        const title = titleEl ? titleEl.innerText.trim().toLowerCase() : '';

        // About
        if (id.includes('about') || title.includes('about')) {
          const aboutEl = section.querySelector('.inline-show-more-text') || section.querySelector('.pv-shared-text-with-see-more');
          if (aboutEl) profile.about = aboutEl.innerText.trim();
        }

        // Experience
        if (id.includes('experience') || title.includes('experience')) {
          const items = section.querySelectorAll('ul.pvs-list > li.artdeco-list__item');
          items.forEach(item => {
            const exp = {
              title: '', company: '', location: '', dateRange: '', duration: '', description: '', companyLogo: ''
            };
            
            const logo = item.querySelector('img');
            if (logo) exp.companyLogo = logo.src;

            // Check if grouped
            const isGrouped = item.querySelector('.pvs-entity--with-path');
            if (isGrouped) {
              const companyNameEl = item.querySelector('.display-flex.align-items-center.t-14.t-normal.t-black--light > span[aria-hidden="true"]');
              if (companyNameEl) {
                exp.company = companyNameEl.innerText.trim();
              } else {
                exp.company = item.querySelector('div.display-flex.align-items-center.t-14.t-normal.t-black > span[aria-hidden="true"]')?.innerText.trim() || '';
              }
              // Grouped roles can be processed further if needed
            } else {
              const titleEl = item.querySelector('.display-flex.align-items-center.t-14.t-bold > span[aria-hidden="true"]') || item.querySelector('.mr1.t-bold > span[aria-hidden="true"]');
              if (titleEl) exp.title = titleEl.innerText.trim();

              const subtitleEl = item.querySelector('.display-flex.align-items-center.t-14.t-normal.t-black > span[aria-hidden="true"]') || item.querySelector('.t-14.t-normal.t-black > span[aria-hidden="true"]');
              if (subtitleEl) exp.company = subtitleEl.innerText.trim().split('·')[0].trim();

              const dateEl = item.querySelector('.pvs-entity__caption-wrapper');
              if (dateEl) {
                const dateText = dateEl.innerText.trim();
                exp.dateRange = dateText.split('·')[0]?.trim() || '';
                exp.duration = dateText.split('·')[1]?.trim() || '';
              }
              
              const locationEl = item.querySelector('.t-14.t-normal.t-black--light:not(.pvs-entity__caption-wrapper) > span[aria-hidden="true"]');
              if (locationEl) exp.location = locationEl.innerText.trim();
              
              const descEl = item.querySelector('.pvs-list__outer-container .inline-show-more-text');
              if (descEl) exp.description = descEl.innerText.trim();
            }
            if (exp.title || exp.company) {
               profile.experience.push(exp);
            }
          });
        }

        // Education
        if (id.includes('education') || title.includes('education')) {
          const items = section.querySelectorAll('ul.pvs-list > li.artdeco-list__item');
          items.forEach(item => {
            const edu = { school: '', degree: '', fieldOfStudy: '', dateRange: '', description: '' };
            const schoolEl = item.querySelector('.mr1.t-bold > span[aria-hidden="true"]') || item.querySelector('.display-flex.align-items-center.t-14.t-bold > span[aria-hidden="true"]');
            if (schoolEl) edu.school = schoolEl.innerText.trim();

            const degreeEl = item.querySelector('.t-14.t-normal.t-black > span[aria-hidden="true"]');
            if (degreeEl) {
              const degreeText = degreeEl.innerText.trim();
              const parts = degreeText.split(',');
              edu.degree = parts[0]?.trim() || '';
              if (parts.length > 1) edu.fieldOfStudy = parts.slice(1).join(',').trim();
            }

            const dateEl = item.querySelector('.pvs-entity__caption-wrapper');
            if (dateEl) edu.dateRange = dateEl.innerText.trim();
            
            if (edu.school) profile.education.push(edu);
          });
        }

        // Skills
        if (id.includes('skills') || title.includes('skills')) {
          const items = section.querySelectorAll('ul.pvs-list > li.artdeco-list__item');
          items.forEach(item => {
            const skillEl = item.querySelector('.mr1.t-bold > span[aria-hidden="true"]') || item.querySelector('.display-flex.align-items-center.t-14.t-bold > span[aria-hidden="true"]');
            if (skillEl) profile.skills.push(skillEl.innerText.trim());
          });
        }

        // Certifications
        if (id.includes('certifications') || id.includes('licenses') || title.includes('certifications') || title.includes('licenses')) {
          const items = section.querySelectorAll('ul.pvs-list > li.artdeco-list__item');
          items.forEach(item => {
            const cert = { name: '', issuer: '', dateIssued: '' };
            const nameEl = item.querySelector('.mr1.t-bold > span[aria-hidden="true"]') || item.querySelector('.display-flex.align-items-center.t-14.t-bold > span[aria-hidden="true"]');
            if (nameEl) cert.name = nameEl.innerText.trim();

            const issuerEl = item.querySelector('.t-14.t-normal.t-black > span[aria-hidden="true"]');
            if (issuerEl) cert.issuer = issuerEl.innerText.trim();

            const dateEl = item.querySelector('.pvs-entity__caption-wrapper');
            if (dateEl) cert.dateIssued = dateEl.innerText.trim();

            if (cert.name) profile.certifications.push(cert);
          });
        }
        
        // Languages
        if (id.includes('languages') || title.includes('languages')) {
           const items = section.querySelectorAll('ul.pvs-list > li.artdeco-list__item');
           items.forEach(item => {
              const langEl = item.querySelector('.mr1.t-bold > span[aria-hidden="true"]') || item.querySelector('.display-flex.align-items-center.t-14.t-bold > span[aria-hidden="true"]');
              if (langEl) profile.languages.push(langEl.innerText.trim());
           });
        }
        
        // Recommendations
        if (id.includes('recommendations') || title.includes('recommendations')) {
            const items = section.querySelectorAll('ul.pvs-list > li.artdeco-list__item');
            if (items.length > 0) {
              profile.recommendationsCount = items.length.toString();
            }
        }
      });

      chrome.runtime.sendMessage({ type: 'linkedin-profile-parsed', payload: profile });
      return profile;
    } catch (err) {
      console.error("Error parsing LinkedIn profile:", err);
      return null;
    }
  }

  function parseProfile() {
     return parseFullProfile();
  }

  function injectOverlay() {
    if (document.getElementById('ai-job-search-overlay')) return;
    const overlay = document.createElement('div');
    overlay.id = 'ai-job-search-overlay';
    overlay.className = 'ai-job-search-fab';
    overlay.style.cssText = 'position: fixed; bottom: 24px; right: 24px; z-index: 999999;';
    overlay.innerHTML = `
      <div class="ai-job-search-fab-content" style="background: white; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.15); padding: 12px; display: flex; align-items: center; cursor: pointer; border: 1px solid #e2e8f0;">
        <button id="ai-job-search-btn" style="background: none; border: none; display: flex; align-items: center; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 14px; font-weight: 600; color: #0f172a; cursor: pointer;">
          <img src="${chrome.runtime.getURL('icons/icon48.png')}" alt="Logo" style="width:24px;height:24px;vertical-align:middle;margin-right:8px;border-radius:4px;">
          Find Email
        </button>
      </div>
    `;
    document.body.appendChild(overlay);

    document.getElementById('ai-job-search-btn').addEventListener('click', () => {
       const profile = parseFullProfile();
       if (profile) {
         alert('Profile parsed! Details sent to extension. Name: ' + profile.name);
       } else {
         alert('Failed to parse profile.');
       }
    });
  }

  function handlePageChange() {
    if (window.location.href.includes('/in/')) {
      setTimeout(() => {
        injectOverlay();
        parseFullProfile();
      }, 3000); // wait for DOM to settle
    } else {
      const overlay = document.getElementById('ai-job-search-overlay');
      if (overlay) overlay.remove();
    }
  }

  // SPA Navigation observer
  let lastUrl = location.href; 
  new MutationObserver(() => {
    const url = location.href;
    if (url !== lastUrl) {
      lastUrl = url;
      handlePageChange();
    }
  }).observe(document, {subtree: true, childList: true});

  if (document.readyState === 'complete') {
    handlePageChange();
  } else {
    window.addEventListener('load', handlePageChange);
  }
})();


(function(){
  const p = window.__AIJS_LAST && window.__AIJS_LAST.payload;
  if (!p) { console.log('%cNo profile parsed - are you on a /in/ profile URL?','color:#c00;font-size:14px'); return; }
  const H = window.AIJobSearchParseHelpers;
  const split = H.splitName(p.name);
  const company = (p.experience[0] && p.experience[0].company) || H.companyFromHeadline(p.headline);
  console.log('%cAI Job Search - parser output','color:#6d28d9;font-size:16px;font-weight:bold');
  console.table({
    name: p.name, firstName: split.firstName, lastName: split.lastName,
    headline: p.headline, location: p.location, company: company,
    experienceCount: p.experience.length, educationCount: p.education.length,
    skillsCount: p.skills.length, certificationsCount: p.certifications.length,
    connections: p.connections, profileUrl: p.profileUrl
  });
  console.log('Experience:', p.experience);
  console.log('Education:', p.education);
  console.log('Skills:', p.skills);
  const ok = H.isDiscoverable({firstName:split.firstName,lastName:split.lastName,company:company});
  console.log(ok ? '%cDISCOVERABLE: name + company resolved' : '%cNOT DISCOVERABLE: missing surname or company',
              ok ? 'color:#059669;font-weight:bold' : 'color:#c00;font-weight:bold');
  window.__AIJS_PROFILE = p;
  console.log('Full payload saved to window.__AIJS_PROFILE');
})();
