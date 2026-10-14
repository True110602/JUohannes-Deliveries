window.API_BASE = 'https://juohannes-deliveries-2.onrender.com';

// NOTE: key is 'token' - must match what login.html/index.html/register
// save it under (localStorage.setItem('token', ...)). These previously
// used different keys ('token' vs 'jwt_token'), which meant every page
// using authFetch() could never find the token login.html had just saved,
// making it look like login worked but nothing after it did.
function getAuthToken() {
  return localStorage.getItem('token');
}

function setAuthToken(token) {
  localStorage.setItem('token', token);
}

function clearAuthToken() {
  localStorage.removeItem('token');
}

async function authFetch(url, options = {}) {
  const token = getAuthToken();
  // Don't force JSON headers on FormData bodies (e.g. image uploads) -
  // the browser needs to set its own multipart/form-data boundary, and
  // overriding it here would make the server unable to parse the upload.
  const isFormData = (typeof FormData !== 'undefined') && (options.body instanceof FormData);
  const headers = {
    ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
    ...(options.headers || {})
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(url, { ...options, headers });

  if (response.status === 401) {
    clearAuthToken();
    window.location.href = '/login.html';
  }

  return response;
}

// Inside the Android app the pages are served from the phone itself, so a bare
// '/api/...' or '/uploads/...' address would hit the app's own files (and come
// back as a web page instead of data). Point those at the real server.
(function () {
  if (window.__jdFetchPatched || !window.API_BASE || typeof window.fetch !== 'function') return;
  window.__jdFetchPatched = true;
  const nativeFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    if (typeof input === 'string' && /^\/(api|uploads)\//.test(input)) input = window.API_BASE + input;
    return nativeFetch(input, init);
  };
})();
