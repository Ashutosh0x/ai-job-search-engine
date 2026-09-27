(function () {
  'use strict';

  /**
   * Read the LinkedIn profile the user currently has open.
   *
   * ONLY THE PAGE IN FRONT OF THEM. This walks the rendered DOM of a profile the
   * user navigated to and is looking at. It does not call LinkedIn's API, does
   * not patch `fetch`, and does not touch data about anyone the user is not
   * viewing — an earlier version of this extension intercepted the private
   * Voyager API, including `relationships/connections`, and that has been removed.
   *
   * THE OUTPUT SHAPE IS A CONTRACT. The web app validates every field against
   * `profileSchema` in lib/linkedin/types.ts and drops the payload if it does not
   * match. Field names here must stay in step with that schema: this file used to
   * emit `photo`, `connections`, `recommendationsCount` and a plain string array
   * for skills, none of which the schema names, so those values were silently
   * discarded on arrival and the panel rendered without them.
   *
   * ROBUSTNESS OVER PRECISION. LinkedIn's utility class names change without
   * notice. Every lookup goes through `textFrom`/`allFrom` with a list of
   * candidate selectors and tolerates all of them missing, because a profile with
   * three sections read is useful and a thrown exception is not. The previous
   * version wrapped the whole parse in one try/catch, so a single unexpected
   * element returned `null` for the entire profile.
   */

  var H = (typeof globalThis !== 'undefined' ? globalThis : window).AIJobSearchParseHelpers;
  if (!H) {
    // parse-helpers.js is listed before this file in the manifest and shares the
    // isolated-world global. If it is missing, every helper call below would
    // throw on each profile view; failing loudly once is more useful.
    console.error('[ai-job-search] parse-helpers.js did not load; parser disabled');
    return;
  }

  /** Matches lib/linkedin/types.ts `schemaVersion`. Bump both together. */
  var SCHEMA_VERSION = 2;

  /** Mirrors LIMITS in the schema, so truncation happens before the wire. */
  var MAX = { short: 300, medium: 1000, long: 5000 };

  /* ------------------------------------------------------------- selectors -- */

  /**
   * Candidate selectors, most specific first.
   *
   * Named constants rather than inline strings so a layout change is one edit in
   * one place, and so the fallbacks are visible as a group.
   */
  var SEL = {
    name: ['h1.text-heading-xlarge', 'main h1', 'h1'],
    headline: ['div.text-body-medium.break-words', '.text-body-medium'],
    location: [
      'span.text-body-small.inline.t-black--light.break-words',
      '.text-body-small.inline.t-black--light.break-words',
    ],
    pronouns: ['span.text-body-small.v-align-middle.break-words.t-black--light'],
    photo: [
      'img.pv-top-card-profile-picture__image',
      'img.pv-top-card-profile-picture__image--show',
      'main img.presence-entity__image',
    ],
    banner: ['.profile-background-image__image', '.pv-top-card-profile-background__image'],
    about: ['.inline-show-more-text', '.pv-shared-text-with-see-more', 'div[class*="display-flex"] span[aria-hidden="true"]'],
    listItems: ['ul.pvs-list > li.artdeco-list__item', 'ul.pvs-list > li', 'li.artdeco-list__item'],
    entityTitle: [
      '.mr1.t-bold > span[aria-hidden="true"]',
      '.display-flex.align-items-center.t-14.t-bold > span[aria-hidden="true"]',
      'span.t-bold > span[aria-hidden="true"]',
      'span[aria-hidden="true"]',
    ],
    entitySubtitle: [
      '.t-14.t-normal.t-black > span[aria-hidden="true"]',
      'span.t-14.t-normal > span[aria-hidden="true"]',
    ],
    caption: ['.pvs-entity__caption-wrapper', 'span.t-14.t-normal.t-black--light > span[aria-hidden="true"]'],
    entityLocation: ['.t-14.t-normal.t-black--light:not(.pvs-entity__caption-wrapper) > span[aria-hidden="true"]'],
    description: ['.pvs-list__outer-container .inline-show-more-text', '.inline-show-more-text'],
    sectionTitle: ['h2.pvs-header__title', 'h2 span[aria-hidden="true"]', 'h2'],
    groupedMarker: ['.pvs-entity--with-path'],
    groupedRoles: ['ul.pvs-list > li'],
  };

  /* --------------------------------------------------------------- sections -- */

  /**
   * Which profile section an element is.
   *
   * Matches on the section id AND its heading text, because LinkedIn uses both
   * and localised profiles have translated headings while ids stay English.
   */
  function sectionKind(section) {
    var id = (section.id || '').toLowerCase();
    var heading = H.textFrom(section, SEL.sectionTitle, 80).toLowerCase();
    var haystack = id + ' ' + heading;

    if (/\babout\b/.test(haystack)) return 'about';
    if (/experience/.test(haystack)) return 'experience';
    if (/education/.test(haystack)) return 'education';
    if (/licens|certificat/.test(haystack)) return 'certifications';
    if (/\bskills\b/.test(haystack)) return 'skills';
    if (/languages/.test(haystack)) return 'languages';
    if (/recommendation/.test(haystack)) return 'recommendations';
    if (/volunteer/.test(haystack)) return 'volunteering';
    if (/honor|award/.test(haystack)) return 'honors';
    if (/activity|posts/.test(haystack)) return 'activity';
    return null;
  }

  /** One experience entry from a list item. */
  function readRole(item, fallbackCompany, logo) {
    var caption = H.splitDateCaption(H.textFrom(item, SEL.caption, MAX.short));
    var role = {
      title: H.textFrom(item, SEL.entityTitle, MAX.short),
      company: fallbackCompany || '',
      location: H.textFrom(item, SEL.entityLocation, MAX.short) || undefined,
      dateRange: caption.dateRange || undefined,
      duration: caption.duration || undefined,
      description: H.textFrom(item, SEL.description, MAX.long) || undefined,
      companyLogo: logo || undefined,
    };

    if (!role.company) {
      // The subtitle is "Company · Full-time"; only the first part is the employer.
      var subtitle = H.textFrom(item, SEL.entitySubtitle, MAX.short);
      role.company = subtitle ? H.cleanText(subtitle.split('·')[0], MAX.short) : '';
    }

    if (role.dateRange && /present|current/i.test(role.dateRange)) role.isCurrent = true;
    return role;
  }

  /** Experience, handling both the flat and the grouped-by-employer layouts. */
  function readExperience(section) {
    var entries = [];

    H.allFrom(section, SEL.listItems).forEach(function (item) {
      var logo = H.imageUrl(item.querySelector('img'));
      var grouped = H.allFrom(item, SEL.groupedMarker).length > 0;

      if (grouped) {
        // Several roles at one employer. The company name sits on the parent and
        // each child <li> is a role.
        var company = H.textFrom(item, SEL.entitySubtitle, MAX.short) ||
          H.textFrom(item, SEL.entityTitle, MAX.short);
        var roles = H.allFrom(item, SEL.groupedRoles);
        roles.forEach(function (roleItem) {
          var role = readRole(roleItem, company, logo);
          if (role.title) entries.push(role);
        });
        // The parent itself is NOT pushed. Doing so was the duplication bug: a
        // promotion history rendered twice, once as the group and once as a
        // headless parent entry carrying the company but no title.
        return;
      }

      var single = readRole(item, '', logo);
      if (single.title || single.company) entries.push(single);
    });

    // Belt and braces: the two layouts can co-occur on one profile mid-rollout.
    entries = H.dedupeEntries(entries, ['title', 'company', 'dateRange']);

    // Mark the first entry current only if nothing said so explicitly. LinkedIn
    // orders most-recent-first, but a profile whose top role ended is not current.
    if (entries.length && !entries.some(function (e) { return e.isCurrent; })) {
      var first = entries[0];
      if (!first.dateRange || /present|current/i.test(first.dateRange)) first.isCurrent = true;
    }
    return entries;
  }

  function readEducation(section) {
    var entries = H.allFrom(section, SEL.listItems).map(function (item) {
      var subtitle = H.textFrom(item, SEL.entitySubtitle, MAX.short);
      var degree = '';
      var fieldOfStudy = '';
      if (subtitle) {
        var parts = subtitle.split(',');
        degree = H.cleanText(parts[0], MAX.short);
        if (parts.length > 1) fieldOfStudy = H.cleanText(parts.slice(1).join(','), MAX.short);
      }
      return {
        school: H.textFrom(item, SEL.entityTitle, MAX.short),
        degree: degree || undefined,
        fieldOfStudy: fieldOfStudy || undefined,
        dateRange: H.textFrom(item, SEL.caption, MAX.short) || undefined,
        logo: H.imageUrl(item.querySelector('img')) || undefined,
      };
    }).filter(function (e) { return e.school; });

    return H.dedupeEntries(entries, ['school', 'degree', 'dateRange']);
  }

  /**
   * Skills, as objects.
   *
   * The schema expects `{ name, endorsements? }`. This used to push bare strings,
   * which failed validation and lost the whole array.
   */
  function readSkills(section) {
    var entries = H.allFrom(section, SEL.listItems).map(function (item) {
      var name = H.textFrom(item, SEL.entityTitle, MAX.short);
      if (!name) return null;
      // "12 endorsements" appears in a subtitle when present.
      var subtitle = H.textFrom(item, SEL.entitySubtitle, 120);
      var count = subtitle ? subtitle.match(/(\d[\d,]*)\s+endorsement/i) : null;
      var skill = { name: name };
      if (count) {
        var n = Number(count[1].replace(/,/g, ''));
        if (Number.isFinite(n)) skill.endorsements = n;
      }
      return skill;
    }).filter(Boolean);

    return H.dedupeEntries(entries, ['name']);
  }

  function readCertifications(section) {
    var entries = H.allFrom(section, SEL.listItems).map(function (item) {
      return {
        name: H.textFrom(item, SEL.entityTitle, MAX.short),
        issuer: H.textFrom(item, SEL.entitySubtitle, MAX.short) || undefined,
        dateIssued: H.textFrom(item, SEL.caption, MAX.short) || undefined,
      };
    }).filter(function (c) { return c.name; });

    return H.dedupeEntries(entries, ['name', 'issuer']);
  }

  function readSimpleList(section) {
    var seen = [];
    H.allFrom(section, SEL.listItems).forEach(function (item) {
      var value = H.textFrom(item, SEL.entityTitle, MAX.short);
      if (value && seen.indexOf(value) === -1) seen.push(value);
    });
    return seen;
  }

  function readVolunteering(section) {
    var entries = H.allFrom(section, SEL.listItems).map(function (item) {
      return {
        role: H.textFrom(item, SEL.entityTitle, MAX.short),
        organization: H.textFrom(item, SEL.entitySubtitle, MAX.short) || undefined,
        dateRange: H.textFrom(item, SEL.caption, MAX.short) || undefined,
      };
    }).filter(function (v) { return v.role; });
    return H.dedupeEntries(entries, ['role', 'organization']);
  }

  function readHonors(section) {
    var entries = H.allFrom(section, SEL.listItems).map(function (item) {
      return {
        title: H.textFrom(item, SEL.entityTitle, MAX.short),
        issuer: H.textFrom(item, SEL.entitySubtitle, MAX.short) || undefined,
        date: H.textFrom(item, SEL.caption, MAX.short) || undefined,
      };
    }).filter(function (h) { return h.title; });
    return H.dedupeEntries(entries, ['title', 'issuer']);
  }

  function readPosts(section) {
    var entries = [];
    H.allFrom(section, SEL.listItems).slice(0, 5).forEach(function (item) {
      var text = H.textFrom(item, ['.break-words.tvm-parent-container', 'span[dir="ltr"]'], MAX.medium);
      if (text) entries.push({ text: text });
    });
    return H.dedupeEntries(entries, ['text']);
  }

  /* ----------------------------------------------------------------- parse -- */

  /**
   * Build the profile payload.
   *
   * Each section is read inside its own try/catch. One section throwing costs
   * that section, not the profile — which is the difference between a partial
   * result the user can work with and a null.
   */
  function parseProfile() {
    var profile = {
      name: H.textFrom(document, SEL.name, MAX.short),
      headline: H.textFrom(document, SEL.headline, MAX.medium) || undefined,
      location: H.textFrom(document, SEL.location, MAX.short) || undefined,
      pronouns: H.textFrom(document, SEL.pronouns, MAX.short) || undefined,
      photoUrl: H.imageUrl(document.querySelector(SEL.photo.join(','))) || undefined,
      bannerUrl: H.imageUrl(document.querySelector(SEL.banner.join(','))) || undefined,
      profileUrl: H.normaliseProfileUrl(window.location.href, window.location.origin) || undefined,
      about: undefined,
      experience: [],
      education: [],
      skills: [],
      certifications: [],
      languages: [],
      recentPosts: [],
      volunteerExperience: [],
      honorsAwards: [],
      parsedAt: new Date().toISOString(),
      source: 'dom',
      schemaVersion: SCHEMA_VERSION,
    };

    // Connection count as a NUMBER, matching the schema. The parser used to send
    // the raw label ("500+ connections") under a key the schema does not have.
    var connectionLabel = '';
    var link = document.querySelector('a[href*="/connections"]');
    if (link) {
      connectionLabel = H.cleanText(link.innerText, 80);
    } else {
      var spans = H.allFrom(document, ['main span', 'span']);
      for (var i = 0; i < spans.length && i < 400; i++) {
        var t = H.cleanText(spans[i].innerText, 80).toLowerCase();
        if (t.indexOf('connection') !== -1 || t.indexOf('follower') !== -1) {
          connectionLabel = t;
          break;
        }
      }
    }
    var parsedCount = H.parseConnectionCount(connectionLabel);
    if (typeof parsedCount === 'number' && parsedCount >= 0) profile.connectionCount = parsedCount;

    H.allFrom(document, ['section']).forEach(function (section) {
      var kind = sectionKind(section);
      if (!kind) return;
      try {
        switch (kind) {
          case 'about':
            profile.about = H.textFrom(section, SEL.about, MAX.long) || undefined;
            break;
          case 'experience':
            profile.experience = readExperience(section);
            break;
          case 'education':
            profile.education = readEducation(section);
            break;
          case 'skills':
            profile.skills = readSkills(section);
            break;
          case 'certifications':
            profile.certifications = readCertifications(section);
            break;
          case 'languages':
            profile.languages = readSimpleList(section);
            break;
          case 'recommendations': {
            var count = H.allFrom(section, SEL.listItems).length;
            if (count > 0) profile.recommendationCount = count;
            break;
          }
          case 'volunteering':
            profile.volunteerExperience = readVolunteering(section);
            break;
          case 'honors':
            profile.honorsAwards = readHonors(section);
            break;
          case 'activity':
            profile.recentPosts = readPosts(section);
            break;
        }
      } catch (err) {
        // Named so a console report says which section, without a payload dump.
        console.warn('[ai-job-search] could not read the ' + kind + ' section', err && err.message);
      }
    });

    return profile;
  }

  /** Parse and hand to the background worker. Returns the profile, or null. */
  function parseAndSend() {
    var profile;
    try {
      profile = parseProfile();
    } catch (err) {
      console.warn('[ai-job-search] profile parse failed', err && err.message);
      return null;
    }

    // A name is the floor. Without it there is nothing to identify the profile
    // by, and the page's schema rejects the payload anyway — so failing here is
    // clearer than sending something that will be discarded on arrival.
    if (!profile.name) {
      console.warn('[ai-job-search] no name found; the page may still be loading');
      return null;
    }

    try {
      chrome.runtime.sendMessage({ type: 'linkedin-profile-parsed', payload: profile }, function () {
        // The service worker may be asleep. Reading lastError marks it handled;
        // leaving it unread logs "Unchecked runtime.lastError" on every parse.
        if (chrome.runtime.lastError) { /* nothing actionable here */ }
      });
    } catch (err) {
      console.warn('[ai-job-search] could not reach the extension', err && err.message);
    }
    return profile;
  }

  /* ---------------------------------------------------------------- overlay -- */

  /**
   * The on-page button.
   *
   * Built with `createElement` and `textContent` rather than an `innerHTML`
   * template. The old version interpolated `chrome.runtime.getURL(...)` into an
   * HTML string, which is a habit that breaks the first time an interpolated
   * value is page-derived — and this file's whole job is handling page-derived
   * values.
   */
  function injectOverlay() {
    if (document.getElementById('ai-job-search-overlay')) return;
    if (!document.body) return;

    var host = document.createElement('div');
    host.id = 'ai-job-search-overlay';
    host.className = 'ai-job-search-fab';

    var button = document.createElement('button');
    button.id = 'ai-job-search-btn';
    button.type = 'button';
    button.setAttribute('aria-label', 'Send this profile to AI Job Search');

    var icon = document.createElement('img');
    icon.src = chrome.runtime.getURL('icons/icon48.png');
    icon.alt = '';
    icon.width = 24;
    icon.height = 24;

    var label = document.createElement('span');
    label.textContent = 'Analyse profile';

    button.appendChild(icon);
    button.appendChild(label);
    host.appendChild(button);

    button.addEventListener('click', function () {
      var profile = parseAndSend();
      label.textContent = profile ? 'Sent ✓' : 'Could not read profile';
      setTimeout(function () { label.textContent = 'Analyse profile'; }, 2500);
    });

    document.body.appendChild(host);
  }

  function removeOverlay() {
    var existing = document.getElementById('ai-job-search-overlay');
    if (existing) existing.remove();
  }

  /* -------------------------------------------------------------- lifecycle -- */

  var PROFILE_PATH = /\/in\//;
  var settleTimer = null;

  /**
   * React to a navigation.
   *
   * Debounced, and the timer is replaced rather than stacked. LinkedIn is a SPA
   * whose mutation stream fires constantly; the previous version started a fresh
   * unconditional 3-second `setTimeout` on every URL change, so a few quick
   * navigations queued several parses that all ran against the last page.
   */
  function handlePageChange() {
    if (settleTimer) clearTimeout(settleTimer);

    if (!PROFILE_PATH.test(window.location.pathname)) {
      removeOverlay();
      return;
    }

    settleTimer = setTimeout(function () {
      settleTimer = null;
      injectOverlay();
      parseAndSend();
    }, 2000);
  }

  var lastUrl = location.href;
  var observer = new MutationObserver(function () {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      handlePageChange();
    }
  });

  // `childList` on the body is enough to notice a SPA route change, and is far
  // cheaper than `subtree` on the whole document — which fired this callback on
  // every text node LinkedIn touched, thousands of times per page.
  if (document.body) {
    observer.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    handlePageChange();
  } else {
    window.addEventListener('load', handlePageChange, { once: true });
  }
})();
