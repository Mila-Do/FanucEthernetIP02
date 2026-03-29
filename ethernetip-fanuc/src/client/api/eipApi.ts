const post = async <T = unknown>(url: string, body?: unknown): Promise<T> => {
  const res = await fetch(url, {
    method: 'POST',
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return res.json() as Promise<T>;
};

export const eipApi = {
  scanner: {
    connect: (payload: { ip: string; port: number }) =>
      post('/api/scanner/connect', payload),
    disconnect: () =>
      post('/api/scanner/disconnect'),
    write: (payload: { word: number }) =>
      post('/api/scanner/write', payload),
  },
  adapter: {
    start: (payload: { port: number }) =>
      post('/api/adapter/start', payload),
    stop: () =>
      post('/api/adapter/stop'),
    write: (payload: { word: number }) =>
      post('/api/adapter/write', payload),
  },
};
