// Single source of truth for where the backend API lives.
//
// This app runs in two places sharing the same public/ folder
// (per capacitor.config.json's "webDir": "public"):
//   1. The webapp - loaded directly from Render in a browser
//   2. The phone app - Capacitor bundles these files INTO the app,
//      so on the phone there is no server at this page's own origin
//
// Pointing this at the full deployed URL works for both: the webapp
// is still same-origin (fetching its own address), and the phone app
// finally has somewhere real to send requests.
window.API_BASE = 'https://juohannes-deliveries.onrender.com';
