// Shared bits for Sign in with Google / Apple. The platform-specific buttons live in SocialButtons(.web).tsx.
export type SocialProvider = 'google' | 'apple';
export type SocialCredential = { provider: SocialProvider; idToken: string; nonce: string };
export type ProviderConfig = { google: { clientId: string } | null; apple: { clientId: string } | null };

/** Random per-attempt value; the provider embeds it in the ID token and the API checks it matches. */
export const newNonce = () => {
  const b = new Uint8Array(16);
  globalThis.crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
};
