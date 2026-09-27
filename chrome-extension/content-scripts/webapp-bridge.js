(function () {
  'use strict';

  /**
   * The bridge between the web app page and the extension.
   *
   * This runs in an ISOLATED world on the web app's own origin, which makes it
   * the one place where page script and extension privilege meet. Everything
   * crossing it is treated as untrusted in both directions:
   *
   *   page  -> here : any script on the page can post a message, so the type must
   *                   be on an allowlist and the payload shape checked.
   *   here  -> page : `postMessage` with '*' broadcasts to every frame on the
   *                   page, including cross-origin iframes. These payloads carry
   *                   a person's profile, so the target is always this exact
   *                   origin.
   *
   * The previous version used '*' for every outbound message and accepted any
   * `event.data.type` it recognised without checking the payload.
   */

  var ORIGIN = window.location.origin;

  /** Requests the page may make. Anything else is ignored. */
  var ALLOWED_REQUESTS = {
    REQUEST_LINKEDIN_PROFILE: 'request-linkedin-profile',
    SET_PROFILE_TYPE: 'set-profile-type',
  };

  /** Messages the background may relay to the page. */
  var ALLOWED_RELAYS = {
    'linkedin-profile-data': 'LINKEDIN_PROFILE_SYNC',
    'linkedin-search-data': 'LINKEDIN_SEARCH_SYNC',
  };

  /**
   * Cap on a relayed payload.
   *
   * A profile is a few KB. Anything far larger is either a bug or an attempt to
   * push a large object through the bridge, and `postMessage` of a huge
   * structure blocks the page's main thread while it is cloned.
   */
  var MAX_PAYLOAD_BYTES = 512 * 1024;

  function withinSizeLimit(payload) {
    try {
      return JSON.stringify(payload).length <= MAX_PAYLOAD_BYTES;
    } catch (_) {
      // Circular or unserialisable — it could not have come from the parser.
      return false;
    }
  }

  /** Post to this origin only, never '*'. */
  function toPage(type, payload) {
    if (payload !== undefined && !withinSizeLimit(payload)) {
      console.warn('[ai-job-search] dropped an oversized payload for', type);
      return;
    }
    window.postMessage({ type: type, payload: payload }, ORIGIN);
  }

  // Announce presence so the page can stop showing install instructions.
  toPage('LINKEDIN_EXTENSION_READY', { version: '2.1.0' });

  // --- background -> page ----------------------------------------------------
  chrome.runtime.onMessage.addListener(function (message) {
    if (!message || typeof message.type !== 'string') return;
    var pageType = ALLOWED_RELAYS[message.type];
    if (!pageType) return; // not a relay we forward
    toPage(pageType, message.payload);
  });

  // --- page -> background ----------------------------------------------------
  window.addEventListener('message', function (event) {
    // Same window only: the page and this script share it, another frame does not.
    if (event.source !== window) return;
    // And the same origin. `event.origin` is set by the browser and cannot be
    // forged by the sender, unlike anything inside `event.data`.
    if (event.origin !== ORIGIN) return;

    var data = event.data;
    if (!data || typeof data.type !== 'string') return;

    var backgroundType = ALLOWED_REQUESTS[data.type];
    if (!backgroundType) return; // unknown request type: ignored, not relayed

    if (backgroundType === 'set-profile-type') {
      // Enum, not free text. This value is stored and later written to a database
      // column, so an arbitrary string has no business travelling here.
      if (data.payload !== 'self' && data.payload !== 'contact') return;
      chrome.runtime.sendMessage({ type: backgroundType, payload: data.payload }, function () {
        if (chrome.runtime.lastError) {
          /* service worker asleep; nothing to surface for a fire-and-forget set */
        }
      });
      return;
    }

    chrome.runtime.sendMessage({ type: backgroundType }, function (response) {
      if (chrome.runtime.lastError) {
        toPage('LINKEDIN_SYNC_ERROR', 'The extension is not responding. Reload the page.');
        return;
      }
      // A null payload means "nothing parsed yet", which is a normal state rather
      // than an error — the page shows its waiting state. Only a present payload
      // is relayed, so the page never overwrites a good profile with null.
      if (response && response.payload) {
        toPage('LINKEDIN_PROFILE_SYNC', response.payload);
      }
    });
  });
})();
