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
