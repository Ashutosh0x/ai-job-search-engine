(function() {
  console.log("LinkedIn Insight WebApp Bridge loaded.");

  // Announce extension presence to the web app
  window.postMessage({ type: 'LINKEDIN_EXTENSION_READY', version: '2.0.0' }, '*');

  // Listen for messages from the background service worker
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'linkedin-profile-data') {
      window.postMessage({ type: 'LINKEDIN_PROFILE_SYNC', payload: message.payload }, '*');
    }
    if (message.type === 'linkedin-search-data') {
      window.postMessage({ type: 'LINKEDIN_SEARCH_SYNC', payload: message.payload }, '*');
    }
  });

  // Listen for requests from the web app page
  window.addEventListener('message', (event) => {
    // Only accept messages from the same window
    if (event.source !== window) return;

    if (event.data && event.data.type === 'REQUEST_LINKEDIN_PROFILE') {
      // Relay request to the background script
      chrome.runtime.sendMessage({ type: 'request-linkedin-profile' }, (response) => {
         if (response && response.payload) {
             window.postMessage({ type: 'LINKEDIN_PROFILE_SYNC', payload: response.payload }, '*');
         }
      });
    }
  });
})();
