// Single source of truth for where the backend API lives.
//
// - If these HTML pages are served BY the Express server itself
//   (e.g. the whole app deployed as one service on Render), leave
//   this as an empty string - requests will be relative/same-origin.
//
// - If these pages are bundled INTO the Capacitor native app
//   (per capacitor.config.json's "webDir": "public"), they load from
//   a native app origin, not from your server. Set this to your
//   deployed backend's full URL, e.g.:
//   window.API_BASE = 'https://johannes-deliveries.onrender.com';
window.API_BASE = '';
