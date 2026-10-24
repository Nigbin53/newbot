import { ApiError } from './security.mjs';

export const BUCKET = 'kinpass-documents';
const encodedPath = path => path.split('/').map(encodeURIComponent).join('/');

// This adapter only runs in the Edge Function. Its service key must never
// be bundled into the static frontend or placed in public configuration.
export function createBackend({ url, serviceKey, fetcher = fetch }) {
  const base = url.replace(/\/$/, '');
  const authorization = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };

  async function api(path, options = {}) {
    let response;
    try {
      response = await fetcher(`${base}${path}`, {
        ...options, signal: AbortSignal.timeout(15000),
        headers: { ...authorization, 'Content-Type': 'application/json', ...options.headers },
      });
    } catch { throw new ApiError(502, 'BACKEND_UNAVAILABLE'); }
    if (!response.ok) throw new ApiError(502, 'BACKEND_UNAVAILABLE');
    if (response.status === 204) return null;
    const content = await response.text();
    try { return content ? JSON.parse(content) : null; }
    catch { throw new ApiError(502, 'BACKEND_UNAVAILABLE'); }
  }

  return {
    async load(userId) {
      const query = new URLSearchParams({ telegram_user_id: `eq.${userId}`, select: 'documents,institutions,put_state,revision', limit: '1' });
      const rows = await api(`/rest/v1/kinpass_state?${query}`);
      return rows[0] || { documents: [], institutions: [], put_state: null, revision: 0 };
    },
    async save(userId, documents, revision, institutions = null) {
      return await api('/rest/v1/rpc/kinpass_save_state', {
        method: 'POST', body: JSON.stringify({ p_user_id: userId, p_documents: documents, p_revision: revision, p_institutions: institutions }),
      });
    },
    async savePut(userId, state, revision) {
      return await api('/rest/v1/rpc/kinpass_save_put', {
        method: 'POST', body: JSON.stringify({ p_user_id: userId, p_state: state, p_revision: revision }),
      });
    },
    async takeAi(userId, limit) {
      return await api('/rest/v1/rpc/kinpass_ai_take', {
        method: 'POST', body: JSON.stringify({ p_user_id: userId, p_limit: limit }),
      }) === true;
    },
    async uploads(userId, paths) {
      const result = [];
      for (let offset = 0; offset < paths.length; offset += 10) {
        const query = new URLSearchParams({
          telegram_user_id: `eq.${userId}`, path: `in.(${paths.slice(offset, offset + 10).join(',')})`,
          select: 'path,document_id,file_name,mime_type',
        });
        result.push(...await api(`/rest/v1/kinpass_uploads?${query}`));
      }
      return result;
    },
    async uploadUsage(userId) {
      const query = new URLSearchParams({
        telegram_user_id: `eq.${userId}`, select: 'path,size_bytes,created_at', limit: '121',
      });
      return await api(`/rest/v1/kinpass_uploads?${query}`);
    },
    async upload(path, bytes, mimeType) {
      await api(`/storage/v1/object/${BUCKET}/${encodedPath(path)}`, {
        method: 'POST', headers: { 'Content-Type': mimeType, 'x-upsert': 'false', 'Cache-Control': 'no-store' }, body: bytes,
      });
    },
    async registerUpload(userId, documentId, path, fileName, mimeType, size) {
      return await api('/rest/v1/rpc/kinpass_register_upload', {
        method: 'POST', body: JSON.stringify({
          p_user_id: userId, p_document_id: documentId, p_path: path,
          p_file_name: fileName, p_mime_type: mimeType, p_size: size,
        }),
      });
    },
    async remove(paths) {
      if (!paths.length) return;
      await api(`/storage/v1/object/${BUCKET}`, { method: 'DELETE', body: JSON.stringify({ prefixes: paths }) });
    },
    async sign(path) {
      const result = await api(`/storage/v1/object/sign/${BUCKET}/${encodedPath(path)}`, {
        method: 'POST', body: JSON.stringify({ expiresIn: 300 }),
      });
      const signedPath = result.signedURL || result.signedUrl;
      if (typeof signedPath !== 'string') throw new ApiError(502, 'BACKEND_UNAVAILABLE');
      return signedPath.startsWith('http') ? signedPath : `${base}/storage/v1${signedPath}`;
    },
  };
}
