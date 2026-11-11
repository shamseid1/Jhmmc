// Gets what GitHub's Mac needs to sign the iPhone app, from the App Store Connect API:
// registers the app's bundle ID (with Push Notifications), makes an Apple Distribution
// certificate from the CSR made on the build machine, and an App Store provisioning
// profile for it. Nothing is kept between builds: each build makes its own.
//   node ios-signing.js <dir>   (reads <dir>/dist.csr; writes dist.cer, profile.mobileprovision, AuthKey.p8)
// Needs ASC_KEY (the API key's .p8 text, or base64), ASC_KEY_ID, ASC_ISSUER_ID.
'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const BUNDLE_ID = process.env.BUNDLE_ID || 'com.africasportfishing.app';
const PROFILE_NAME = 'Africa Sportfishing App Store (GitHub)';
const dir = process.argv[2];
let key = process.env.ASC_KEY || '';
if (!key.includes('BEGIN')) key = Buffer.from(key, 'base64').toString('utf8');
key = key.replace(/-----BEGIN PRIVATE KEY-----\s*/, '-----BEGIN PRIVATE KEY-----\n').replace(/\s*-----END PRIVATE KEY-----/, '\n-----END PRIVATE KEY-----');

function jwt() {
  const b64 = (v) => Buffer.from(JSON.stringify(v)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${b64({ alg: 'ES256', kid: process.env.ASC_KEY_ID, typ: 'JWT' })}.${b64({
    iss: process.env.ASC_ISSUER_ID, iat: now, exp: now + 1100, aud: 'appstoreconnect-v1',
  })}`;
  return `${unsigned}.${crypto.sign('sha256', Buffer.from(unsigned), { key, dsaEncoding: 'ieee-p1363' }).toString('base64url')}`;
}

async function asc(method, url, body) {
  const res = await fetch(`https://api.appstoreconnect.apple.com${url}`, {
    method, headers: { Authorization: `Bearer ${jwt()}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify({ data: body }) : undefined,
  });
  const text = await res.text();
  if (!res.ok) {
    const err = new Error(`${method} ${url.split('?')[0]}: ${res.status} ${text.slice(0, 500)}`);
    err.status = res.status;
    err.text = text;
    throw err;
  }
  return text ? JSON.parse(text) : {};
}

(async () => {
  if (!key.includes('BEGIN') || !process.env.ASC_KEY_ID || !process.env.ASC_ISSUER_ID) {
    throw new Error('Add the APPSTORE_API_KEY, APPSTORE_API_KEY_ID and APPSTORE_API_ISSUER_ID secrets.');
  }
  // The app's ID, registered once, with Push Notifications switched on.
  let bundle = (await asc('GET', `/v1/bundleIds?filter[identifier]=${BUNDLE_ID}&limit=200`)).data
    .find((b) => b.attributes.identifier === BUNDLE_ID);
  if (!bundle) {
    bundle = (await asc('POST', '/v1/bundleIds', { type: 'bundleIds', attributes: { identifier: BUNDLE_ID, name: 'Africa Sportfishing', platform: 'IOS' } })).data;
    console.log(`Registered the app ID ${BUNDLE_ID}.`);
  }
  const caps = (await asc('GET', `/v1/bundleIds/${bundle.id}/bundleIdCapabilities`)).data;
  if (!caps.some((c) => c.attributes.capabilityType === 'PUSH_NOTIFICATIONS')) {
    await asc('POST', '/v1/bundleIdCapabilities', {
      type: 'bundleIdCapabilities', attributes: { capabilityType: 'PUSH_NOTIFICATIONS' },
      relationships: { bundleId: { data: { type: 'bundleIds', id: bundle.id } } },
    });
    console.log('Switched on Push Notifications for the app ID.');
  }
  const teamId = bundle.attributes.seedId;
  // The key again, tidied, for Xcode's upload.
  fs.writeFileSync(path.join(dir, 'AuthKey.p8'), `${key}\n`, { mode: 0o600 });

  // A distribution certificate for this build. Apple allows only a few at a time: when
  // full, the oldest goes (apps already on the App Store or TestFlight are unaffected).
  const csrContent = fs.readFileSync(path.join(dir, 'dist.csr'), 'utf8');
  const newCert = () => asc('POST', '/v1/certificates', { type: 'certificates', attributes: { certificateType: 'DISTRIBUTION', csrContent } });
  let cert;
  try {
    cert = (await newCert()).data;
  } catch (err) {
    if (err.status !== 409) throw err;
    const old = (await asc('GET', '/v1/certificates?filter[certificateType]=DISTRIBUTION,IOS_DISTRIBUTION&limit=200')).data
      .sort((a, b) => String(a.attributes.expirationDate).localeCompare(String(b.attributes.expirationDate)));
    if (!old.length) throw err;
    await asc('DELETE', `/v1/certificates/${old[0].id}`);
    console.log(`Apple's certificate limit was reached: revoked the oldest (${old[0].attributes.name}).`);
    cert = (await newCert()).data;
  }
  fs.writeFileSync(path.join(dir, 'dist.cer'), Buffer.from(cert.attributes.certificateContent, 'base64'));

  // A fresh App Store profile for the app ID and that certificate.
  for (const p of (await asc('GET', `/v1/profiles?filter[name]=${encodeURIComponent(PROFILE_NAME)}&limit=200`)).data) {
    await asc('DELETE', `/v1/profiles/${p.id}`);
  }
  const profile = (await asc('POST', '/v1/profiles', {
    type: 'profiles', attributes: { name: PROFILE_NAME, profileType: 'IOS_APP_STORE' },
    relationships: {
      bundleId: { data: { type: 'bundleIds', id: bundle.id } },
      certificates: { data: [{ type: 'certificates', id: cert.id }] },
    },
  })).data;
  fs.writeFileSync(path.join(dir, 'profile.mobileprovision'), Buffer.from(profile.attributes.profileContent, 'base64'));

  const out = `team_id=${teamId}\nprofile_uuid=${profile.attributes.uuid}\nprofile_name=${PROFILE_NAME}\n`;
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, out);
  console.log(`Signing ready: team ${teamId}, profile ${profile.attributes.uuid}.`);
})().catch((err) => {
  console.error(`::error::${err.message}`);
  process.exit(1);
});
