const encoder = new TextEncoder();

export class ApiError extends Error {
  constructor(status, code, message = code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function hmac(key, data) {
  const cryptoKey = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(data)));
}

function equalHex(actual, expected) {
  if (!/^[a-f0-9]{64}$/i.test(expected)) return false;
  let difference = 0;
  for (let index = 0; index < actual.length; index++) {
    difference |= actual[index] ^ parseInt(expected.slice(index * 2, index * 2 + 2), 16);
  }
  return difference === 0;
}

// Telegram's bot-token HMAC includes every received field except hash.
// initDataUnsafe and any user ID supplied separately by the client are ignored.
export async function verifyInitData(initData, botToken, { now = Date.now(), maxAgeSeconds = 3600 } = {}) {
  if (typeof initData !== 'string' || !initData || encoder.encode(initData).length > 16384) {
    throw new ApiError(401, 'TELEGRAM_AUTH_REQUIRED');
  }
  const parameters = new URLSearchParams(initData);
  const seen = new Set();
  for (const [key] of parameters) {
    if (seen.has(key)) throw new ApiError(401, 'INVALID_TELEGRAM_AUTH');
    seen.add(key);
  }
  const hash = parameters.get('hash') || '';
  parameters.delete('hash');
  const dataCheckString = [...parameters.entries()]
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([key, value]) => `${key}=${value}`).join('\n');
  const secret = await hmac(encoder.encode('WebAppData'), botToken);
  const signature = await hmac(secret, dataCheckString);
  if (!equalHex(signature, hash)) throw new ApiError(401, 'INVALID_TELEGRAM_AUTH');

  const authDateText = parameters.get('auth_date') || '';
  const authDate = Number(authDateText);
  const nowSeconds = Math.floor(now / 1000);
  if (!/^\d+$/.test(authDateText) || !Number.isSafeInteger(authDate) || authDate > nowSeconds + 30) {
    throw new ApiError(401, 'INVALID_TELEGRAM_AUTH');
  }
  if (nowSeconds - authDate > maxAgeSeconds) throw new ApiError(401, 'TELEGRAM_AUTH_EXPIRED');
  let user;
  try { user = JSON.parse(parameters.get('user') || 'null'); }
  catch { throw new ApiError(401, 'INVALID_TELEGRAM_AUTH'); }
  if (!user || !Number.isSafeInteger(user.id) || user.id <= 0 || user.is_bot === true) {
    throw new ApiError(401, 'INVALID_TELEGRAM_AUTH');
  }
  return { id: String(user.id), authDate };
}

export const MAX_DOCUMENTS = 100;
export const MAX_FILE_BYTES = 3 * 1024 * 1024;
export const MAX_UPLOADS = 120;
export const MAX_STORAGE_BYTES = 330 * 1024 * 1024;
export const MAX_REQUEST_BYTES = 4 * MAX_FILE_BYTES / 3 + 65536;
const safeId = /^[A-Za-z0-9_-]{1,80}$/;
const documentKeys = new Set(['id', 'name', 'owner', 'city', 'status', 'issued', 'expires', 'days', 'requested', 'expected', 'file', 'fileName']);

export function validateDocumentId(id) {
  if (typeof id !== 'string' || !safeId.test(id)) throw new ApiError(400, 'INVALID_DOCUMENT_ID');
  return id;
}

function text(value, maximum, required = false) {
  if (value === undefined && !required) return '';
  if (typeof value !== 'string' || value.length > maximum || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) {
    throw new ApiError(400, 'INVALID_DOCUMENT');
  }
  const result = value.trim();
  if (required && !result) throw new ApiError(400, 'INVALID_DOCUMENT');
  return result;
}

function date(value) {
  const result = text(value, 10);
  if (!result) return '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result) || result.startsWith('0000-')) throw new ApiError(400, 'INVALID_DATE');
  const parsed = new Date(`${result}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== result) throw new ApiError(400, 'INVALID_DATE');
  return result;
}

export function validateFileName(value) {
  const name = text(value, 180, true);
  if (/[\\/]/.test(name) || name === '.' || name === '..') throw new ApiError(400, 'INVALID_FILE_NAME');
  return name;
}

export function isOwnedPath(path, userId, documentId) {
  return typeof path === 'string' && path.startsWith(`${userId}/${documentId}/`) &&
    /^[0-9]+\/[A-Za-z0-9_-]{1,80}\/[a-f0-9-]{36}\.(jpg|png|webp)$/.test(path);
}

export function validateDocuments(value) {
  if (!Array.isArray(value) || value.length > MAX_DOCUMENTS) throw new ApiError(400, 'INVALID_DOCUMENTS');
  const ids = new Set();
  return value.map(input => {
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !documentKeys.has(key))) {
      throw new ApiError(400, 'INVALID_DOCUMENT');
    }
    const id = validateDocumentId(input.id);
    if (ids.has(id)) throw new ApiError(400, 'DUPLICATE_DOCUMENT_ID');
    ids.add(id);
    if (!['self', 'mom', 'grand'].includes(input.owner) || !['todo', 'pending', 'ready'].includes(input.status)) {
      throw new ApiError(400, 'INVALID_DOCUMENT');
    }
    if (!Number.isSafeInteger(input.days) || input.days < 0 || input.days > 3650) throw new ApiError(400, 'INVALID_DOCUMENT');
    const document = {
      id, name: text(input.name, 200, true), owner: input.owner,
      city: text(input.city, 120), status: input.status,
      issued: date(input.issued), expires: date(input.expires), days: input.days,
      requested: date(input.requested), expected: date(input.expected), file: text(input.file, 250),
      fileName: input.file ? validateFileName(input.fileName) : '',
    };
    if (document.issued && document.expires && document.expires < document.issued) throw new ApiError(400, 'INVALID_DATE_RANGE');
    if (document.requested && document.expected && document.expected < document.requested) throw new ApiError(400, 'INVALID_DATE_RANGE');
    return document;
  });
}

export function validateRevision(value) {
  if (!Number.isSafeInteger(value) || value < 0) throw new ApiError(400, 'INVALID_REVISION');
  return value;
}

export function decodeUpload(dataUrl) {
  if (typeof dataUrl !== 'string' || dataUrl.length > MAX_REQUEST_BYTES) throw new ApiError(413, 'FILE_TOO_LARGE');
  const match = /^data:(image\/jpeg|image\/png|image\/webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl);
  if (!match || match[2].length % 4 !== 0) throw new ApiError(400, 'INVALID_FILE');
  let binary;
  try { binary = atob(match[2]); }
  catch { throw new ApiError(400, 'INVALID_FILE'); }
  if (!binary.length || binary.length > MAX_FILE_BYTES) throw new ApiError(413, 'FILE_TOO_LARGE');
  const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
  const ascii = (offset, count) => String.fromCharCode(...bytes.slice(offset, offset + count));
  const mimeType = match[1];
  const valid = mimeType === 'image/jpeg' ? bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff :
    mimeType === 'image/png' ? [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte) :
    ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP';
  if (!valid) throw new ApiError(400, 'INVALID_FILE_CONTENT');
  return { bytes, mimeType, extension: ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' })[mimeType] };
}

export async function readJson(request) {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') || '')) throw new ApiError(415, 'JSON_REQUIRED');
  if (Number(request.headers.get('content-length')) > MAX_REQUEST_BYTES) throw new ApiError(413, 'REQUEST_TOO_LARGE');
  if (!request.body) throw new ApiError(400, 'INVALID_JSON');
  const reader = request.body.getReader();
  const chunks = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.length;
    if (length > MAX_REQUEST_BYTES) { await reader.cancel(); throw new ApiError(413, 'REQUEST_TOO_LARGE'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  let body;
  try { body = JSON.parse(new TextDecoder().decode(bytes)); }
  catch { throw new ApiError(400, 'INVALID_JSON'); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ApiError(400, 'INVALID_JSON');
  return body;
}
