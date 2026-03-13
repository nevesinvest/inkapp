const API_BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:4000/api";

async function request(path, options = {}) {
  const { token, body, method = "GET" } = options;
  const headers = {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {})
  };

  const response = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });

  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch (_error) {
    data = null;
  }

  if (!response.ok) {
    const message = data?.message || "Erro na comunicacao com o servidor.";
    const error = new Error(message);
    error.status = response.status;
    error.code = data?.code || null;
    error.payload = data || null;
    throw error;
  }

  return data;
}

export const api = {
  request
};
