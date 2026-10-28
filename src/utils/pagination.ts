export interface CursorPayload {
  createdAt: string; // ISO date string
  id: string;
}

/**
 * Encodes a keyset cursor object { createdAt, id } into a URL-safe base64 string.
 */
export function encodeCursor(payload: { createdAt: Date | string; id: string }): string {
  const normDate = payload.createdAt instanceof Date ? payload.createdAt.toISOString() : payload.createdAt;
  const json = JSON.stringify({ createdAt: normDate, id: payload.id });
  return Buffer.from(json, 'utf8').toString('base64url');
}

/**
 * Decodes a base64url cursor back into { createdAt: Date, id: string }.
 * Returns null if the cursor is malformed or invalid.
 */
export function decodeCursor(cursor: string): { createdAt: Date; id: string } | null {
  try {
    const raw = Buffer.from(cursor, 'base64url').toString('utf8');
    const parsed = JSON.parse(raw) as CursorPayload;

    if (!parsed || typeof parsed !== 'object' || !parsed.createdAt || !parsed.id) {
      return null;
    }

    const date = new Date(parsed.createdAt);
    if (Number.isNaN(date.getTime())) {
      return null;
    }

    return {
      createdAt: date,
      id: String(parsed.id),
    };
  } catch {
    return null;
  }
}
