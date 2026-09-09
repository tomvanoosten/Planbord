// Run once locally. Copy the values to Cloudflare secrets; never commit them.
const {generateKeyPairSync,randomBytes}=require('node:crypto');
const {privateKey,publicKey}=generateKeyPairSync('ec',{namedCurve:'prime256v1'});
const pub=publicKey.export({format:'jwk'});
const publicRaw=Buffer.concat([Buffer.from([4]),Buffer.from(pub.x,'base64url'),Buffer.from(pub.y,'base64url')]);
console.log('VAPID_PUBLIC_KEY='+publicRaw.toString('base64url'));
console.log('VAPID_PRIVATE_JWK='+JSON.stringify(privateKey.export({format:'jwk'})));
console.log('WORKSPACE_CODE='+randomBytes(18).toString('base64url'));
console.log('PUSH_SUBJECT=https://planbord-285.pages.dev');
