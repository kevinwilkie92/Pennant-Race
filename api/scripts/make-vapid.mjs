// Makes the key pair browser push notifications need. Run once, then:
//   cd api && npx wrangler secret put VAPID_PRIVATE_KEY      (paste the private key)
// and add the other two lines to [vars] in wrangler.toml. Keep the private key secret; changing it later signs every browser out of notifications.
import { generateKeyPairSync } from 'node:crypto';
const subject = process.argv[2] ?? 'mailto:you@example.com';
const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const pub = publicKey.export({ format: 'jwk' }), prv = privateKey.export({ format: 'jwk' });
const rawPublic = Buffer.concat([Buffer.from([4]), Buffer.from(pub.x, 'base64url'), Buffer.from(pub.y, 'base64url')]).toString('base64url');
console.log('Add to api/wrangler.toml under [vars]:\n');
console.log(`VAPID_PUBLIC_KEY = "${rawPublic}"`);
console.log(`VAPID_SUBJECT = "${subject}"      # a contact address the push services can reach you on\n`);
console.log('Then store the private key as a secret (paste this when asked):\n');
console.log(prv.d);
console.log('\nnpx wrangler secret put VAPID_PRIVATE_KEY');
