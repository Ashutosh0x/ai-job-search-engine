/**
 * Generate chrome-extension/dev/console-validator.js.
 *
 *   node scripts/build-console-validator.mjs
 *
 * Concatenates the SHIPPED parser sources with a chrome.* stub and a reporter,
 * so the parser can be validated against a real LinkedIn profile by pasting one
 * file into the browser console — no extension install, no reload cycle.
 *
 * It exists because the parser's DOM walking is the one part of this feature
 * that cannot be unit tested here: it depends on LinkedIn's live markup, and a
 * checked-in fixture of today's HTML would assert that the fixture was copied
 * correctly, not that the parser works. This closes that gap by running the
 * real code against the real page.
 *
 * Regenerate whenever parse-helpers.js or linkedin-parser.js changes;
 * scripts/test-linkedin-parser.mjs asserts the generated file is in step.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs'

const EXT = 'chrome-extension'
const OUT = `${EXT}/dev/console-validator.js`

const HEADER = `/**
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
`

const SHIM = `
(function(){
  if (!window.chrome) window.chrome = {};
  if (!chrome.runtime) chrome.runtime = {};
  chrome.runtime.sendMessage = function(msg){ window.__AIJS_LAST = msg; };
  chrome.runtime.getURL = function(){ return ''; };
})();
`

const REPORT = `
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
`

const body =
  HEADER +
  SHIM + '\n' +
  readFileSync(`${EXT}/content-scripts/parse-helpers.js`, 'utf8') + '\n' +
  readFileSync(`${EXT}/content-scripts/linkedin-parser.js`, 'utf8') + '\n' +
  REPORT

mkdirSync(`${EXT}/dev`, { recursive: true })
writeFileSync(OUT, body)

console.log(`Wrote ${OUT} (${body.length} bytes)`)
