import {
  ApiError, verifyInitData, readJson, validateDocuments, validateRevision,
  validateDocumentId, validateFileName, decodeUpload, isOwnedPath, validateInstitutions,
  cleanInstitution, validateLookup, MAX_UPLOADS, MAX_STORAGE_BYTES, AI_DAILY_LIMIT,
} from './security.mjs';

export function createHandler({ botToken, appOrigin, backend, ai = null, maxAgeSeconds = 3600, now = () => Date.now(), uuid = () => crypto.randomUUID() }) {
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
    if (request.method === 'GET') return response({ ok: true, service: 'kinpass-api', ai: Boolean(ai) });
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
        const institutions = body.institutions === undefined ? null : validateInstitutions(body.institutions);
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
        const saved = await backend.save(user.id, documents, revision, institutions);
        if (!saved.ok) {
          if (saved.error === 'INVALID_ATTACHMENT') throw new ApiError(400, 'INVALID_ATTACHMENT');
          return response({ error: 'REVISION_CONFLICT', documents: saved.documents, institutions: saved.institutions || [], revision: saved.revision }, 409);
        }
        await clean(saved.cleanup);
        return response({ documents: saved.documents, institutions: saved.institutions || [], revision: saved.revision });
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
      if (body.action === 'lookup') {
        const lookup = validateLookup(body);
        if (!ai) throw new ApiError(503, 'AI_NOT_CONFIGURED');
        if (!await backend.takeAi(user.id, AI_DAILY_LIMIT)) throw new ApiError(429, 'AI_LIMIT');
        let found;
        try { found = await ai.lookupInstitution(lookup); }
        catch (error) { throw new ApiError(502, 'AI_UNAVAILABLE', 'AI_UNAVAILABLE', String(error?.message || '').slice(0, 240)); }
        const institution = cleanInstitution(found?.institution);
        if (!['address', 'phone', 'hours', 'reception', 'notes'].some(key => institution[key])) throw new ApiError(404, 'AI_NOT_FOUND');
        const sources = (Array.isArray(found?.sources) ? found.sources : [])
          .filter(source => typeof source?.uri === 'string' && /^https:\/\//.test(source.uri))
          .slice(0, 5).map(source => ({ title: String(source.title || 'Источник').slice(0, 120), uri: source.uri.slice(0, 500), maps: Boolean(source.maps) }));
        return response({ institution, sources });
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
      if (error instanceof ApiError) return response({ error: error.code, ...(error.detail ? { detail: error.detail } : {}) }, error.status);
      // Do not log initData, documents, service keys, or signed URLs.
      return response({ error: 'INTERNAL_ERROR' }, 500);
    }
  };
}
