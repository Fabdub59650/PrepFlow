// Appels à l'API PrepFlow. Chemins relatifs : l'app fonctionne sous /prepflow/.
async function request(method, path, body) {
  const opts = { method, headers: {} };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch('api/' + path.replace(/^\/+/, ''), opts);
  } catch (_) {
    throw new Error('PrepFlow ne répond pas. Vérifiez que le service tourne sur le Pi.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Erreur ${res.status}`);
  return data;
}

export const api = {
  get:  (p)    => request('GET', p),
  post: (p, b) => request('POST', p, b ?? {}),
  put:  (p, b) => request('PUT', p, b ?? {}),
  del:  (p)    => request('DELETE', p),
};
