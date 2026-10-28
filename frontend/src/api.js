const BASE = import.meta.env.VITE_API_BASE || '';

async function request(path, options) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'content-type': 'application/json' },
    ...options,
  });
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) {
    // Nest's ValidationPipe returns message as an array; flatten it so the UI
    // can show what is actually wrong rather than "Bad Request".
    const message = Array.isArray(body?.message) ? body.message.join('. ') : body?.message;
    throw new Error(message || `Request failed (${res.status})`);
  }
  return body;
}

export const listAuctions = () => request('/api/rfqs');
export const getAuction = (id) => request(`/api/rfqs/${id}`);
export const listSuppliers = () => request('/api/suppliers');
export const createAuction = (dto) =>
  request('/api/rfqs', { method: 'POST', body: JSON.stringify(dto) });
export const submitBid = (rfqId, dto) =>
  request(`/api/rfqs/${rfqId}/bids`, { method: 'POST', body: JSON.stringify(dto) });
