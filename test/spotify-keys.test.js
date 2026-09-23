import { it, expect } from 'vitest';
import { encryptToken, sealToken, openToken } from '../worker/spotify/tokens.js';
const oldKey='old-key-with-at-least-32-characters-12345';
const newKey='new-key-with-at-least-32-characters-12345';
const env={SESSION_SECRET:'session-old',SPOTIFY_TOKEN_KEYS:JSON.stringify({current:'v1',keys:{v1:oldKey}})};
it('session rotation leaves versioned Spotify tokens readable', async()=>{
 const token=await sealToken(env,'refresh');
 expect(token.startsWith('v1.')).toBe(true);
 expect(await openToken({...env,SESSION_SECRET:'session-new'},token)).toBe('refresh');
});
it('key rotation reads older versions and seals under the new version',async()=>{
 const token=await sealToken(env,'refresh');
 const rotated={...env,SPOTIFY_TOKEN_KEYS:JSON.stringify({current:'v2',keys:{v1:oldKey,v2:newKey}})};
 expect(await openToken(rotated,token)).toBe('refresh');
 expect((await sealToken(rotated,'refresh')).startsWith('v2.')).toBe(true);
});
it('legacy tokens remain readable during migration',async()=>{
 const token=await encryptToken(env.SESSION_SECRET,'legacy');
 expect(await openToken(env,token)).toBe('legacy');
 expect(await openToken({...env,SESSION_SECRET:'new',SPOTIFY_LEGACY_TOKEN_SECRET:'session-old'},token)).toBe('legacy');
});
it('missing keys fail without treating credentials as revoked',async()=>{
 const token=await sealToken(env,'refresh');
 await expect(openToken({...env,SPOTIFY_TOKEN_KEYS:JSON.stringify({current:'v2',keys:{v2:newKey}})},token)).rejects.toThrow('unavailable');
});
