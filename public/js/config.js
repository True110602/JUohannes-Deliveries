window.API_BASE = 'https://juohannes-deliveries-2.onrender.com';

function getAuthToken() {
  return localStorage.getItem('jwt_token');
}

function setAuthToken(token) {
  localStorage.setItem('jwt_token', token);
}

function clearAuthToken() {
  localStorage.removeItem('jwt_token');
}

async function authFetch(url, options = {}) {
  const token = getAuthToken();
  const headers = {
    'Content-Type': 'application/json',
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
