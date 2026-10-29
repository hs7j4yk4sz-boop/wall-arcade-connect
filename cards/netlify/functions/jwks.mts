// GET /.well-known/jwks.json: the public key Sprite Party checks our capture links with (cards/src/capture-link.ts).
// Public, CORS *, cached 5 minutes. Only the public half of SPRITE_JWT_PRIVATE_KEY is served.
import { jwks } from '../../src/capture-link.js';

const headers = { 'Content-Type': 'application/jwk-set+json', 'Access-Control-Allow-Origin': '*' };
export default async (): Promise<Response> => {
  try {
    return new Response(JSON.stringify(jwks()), { headers: { ...headers, 'Cache-Control': 'public, max-age=300', 'Netlify-CDN-Cache-Control': 'public, s-maxage=300' } });
  } catch {
    return new Response(JSON.stringify({ error: 'no signing key' }), { status: 503, headers: { ...headers, 'Cache-Control': 'no-store' } });
  }
};

export const config = { path: '/.well-known/jwks.json' };
