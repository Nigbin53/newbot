import {
  ApiError, verifyInitData, readJson, validateDocuments, validateRevision,
  validateDocumentId, validateFileName, decodeUpload, isOwnedPath,
  MAX_UPLOADS, MAX_STORAGE_BYTES,
} from './security.mjs';

export function createHandler({ botToken, appOrigin, backend, maxAgeSeconds = 3600, now = () => Date.now(), uuid = () => crypto.randomUUID() }) {
  const headers = {
    'Access-Control-Allow-Origin': appOrigin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '600',
    'Cache-Control': 'no-store', Vary: 'Origin',
    'Content-Type': 'application/json; charset=utf-8', 'X-Content-Type-Options': 'nosniff',
  };
  const response = (data, status = 200) => new Response(JSON.stringify(data), { status, headers });
  const clean = async paths => { try { await backend.remove(paths || []); } catch { /* Private orphan objects stay inaccessible. */ } };

  return async function handle(request) {
    // Readiness exposes no database state or credentials. index.ts refuses to
    // start when the required secrets are missing, so this checks configuration.
    if (request.method === 'GET') return response({ ok: true, service: 'kinpass-api' });
    if (request.headers.get('origin') !== appOrigin) {
      return new Response(JSON.stringify({ error: 'ORIGIN_NOT_ALLOWED' }), {
        status: 403, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', Vary: 'Origin' },
      });
    }
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (request.method !== 'POST') return response({ error: 'METHOD_NOT_ALLOWED' }, 405);
    try {
      const body = await readJson(request);
      const user = await verifyInitData(body.initData, botToken, { now: now(), maxAgeSeconds });
      if (body.action === 'load') {
        return response(await backend.load(user.id));
      }
      if (body.action === 'save') {
        const documents = validateDocuments(body.documents);
        const revision = validateRevision(body.revision);
        const attachments = documents.filter(document => document.file);
        if (attachments.some(document => !isOwnedPath(document.file, user.id, document.id))) {
          throw new ApiError(400, 'INVALID_ATTACHMENT');
        }
        const known = new Map((await backend.uploads(user.id, attachments.map(document => document.file))).map(upload => [upload.path, upload]));
        for (const document of attachments) {
          const upload = known.get(document.file);
          if (!upload || upload.document_id !== document.id || upload.file_name !== document.fileName) throw new ApiError(400, 'INVALID_ATTACHMENT');
        }
        // The RPC repeats attachment validation under the same row lock as the
        // compare-and-swap so concurrent requests cannot resurrect removed files.
        const saved = await backend.save(user.id, documents, revision);
        if (!saved.ok) {
          if (saved.error === 'INVALID_ATTACHMENT') throw new ApiError(400, 'INVALID_ATTACHMENT');
          return response({ error: 'REVISION_CONFLICT', documents: saved.documents, revision: saved.revision }, 409);
        }
        await clean(saved.cleanup);
        return response({ documents: saved.documents, revision: saved.revision });
      }
      if (body.action === 'upload') {
        const documentId = validateDocumentId(body.documentId);
        const fileName = validateFileName(body.fileName);
        const state = await backend.load(user.id);
        if (!state.documents.some(document => document.id === documentId)) throw new ApiError(404, 'DOCUMENT_NOT_FOUND');
        const { bytes, mimeType, extension } = decodeUpload(body.dataUrl);
        // Early quota check avoids unnecessary Storage writes. The locked RPC
        // repeats this check, including uploads racing on other devices.
        const linkedPaths = new Set(state.documents.map(document => document.file).filter(Boolean));
        const usage = (await backend.uploadUsage(user.id)).filter(upload =>
          linkedPaths.has(upload.path) || Date.parse(upload.created_at) >= now() - 3600000);
        if (usage.length >= MAX_UPLOADS || usage.reduce((total, upload) => total + upload.size_bytes, 0) + bytes.length > MAX_STORAGE_BYTES) {
          throw new ApiError(413, 'STORAGE_LIMIT');
        }
        const path = `${user.id}/${documentId}/${uuid()}.${extension}`;
        let registered;
        try {
          await backend.upload(path, bytes, mimeType);
          registered = await backend.registerUpload(user.id, documentId, path, fileName, mimeType, bytes.length);
          await clean(registered.cleanup);
          if (!registered.ok) throw new ApiError(registered.error === 'STORAGE_LIMIT' ? 413 : 404, registered.error || 'DOCUMENT_NOT_FOUND');
        } catch (error) {
          await clean([path]);
          throw error;
        }
        return response({ file: path, fileName });
      }
      if (body.action === 'file') {
        const documentId = validateDocumentId(body.documentId);
        const state = await backend.load(user.id);
        const document = state.documents.find(document => document.id === documentId);
        if (!document || !document.file) throw new ApiError(404, 'FILE_NOT_FOUND');
        if (!isOwnedPath(document.file, user.id, documentId)) throw new ApiError(404, 'FILE_NOT_FOUND');
        const uploads = await backend.uploads(user.id, [document.file]);
        const upload = uploads.find(item => item.path === document.file && item.document_id === documentId && item.file_name === document.fileName);
        if (!upload) throw new ApiError(404, 'FILE_NOT_FOUND');
        return response({ url: await backend.sign(document.file), mimeType: upload.mime_type });
      }
      throw new ApiError(400, 'INVALID_ACTION');
    } catch (error) {
      if (error instanceof ApiError) return response({ error: error.code }, error.status);
      // Do not log initData, documents, service keys, or signed URLs.
      return response({ error: 'INTERNAL_ERROR' }, 500);
    }
  };
}
