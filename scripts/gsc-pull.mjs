#!/usr/bin/env node
/**
 * gsc-pull.mjs — Pull Google Search Console data for a site
 *
 * Usage:
 *   node gsc-pull.mjs --site https://getsubtextai.com [--days 28] [--output path/to/result.json]
 *
 * Auth (one of):
 *   GOOGLE_APPLICATION_CREDENTIALS=path/to/service-account.json
 *   GSC_ACCESS_TOKEN=ya29.xxx
 */

import { createSign } from 'crypto';
import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = { days: 28, output: null, site: null };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--site') args.site = argv[++i];
    else if (argv[i] === '--days') args.days = parseInt(argv[++i], 10);
    else if (argv[i] === '--output') args.output = argv[++i];
  }
  return args;
}

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

function toISODate(date) {
  return date.toISOString().slice(0, 10);
}

function dateRange(days) {
  const end = new Date();
  // GSC data lags ~3 days; still use today as end for maximum coverage
  const start = new Date(end);
  start.setDate(start.getDate() - days);
  return { start: toISODate(start), end: toISODate(end) };
}

// ---------------------------------------------------------------------------
// JWT / service-account auth
// ---------------------------------------------------------------------------

function base64url(buf) {
  return buf
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

function buildJWT(serviceAccount) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })));
  const payload = base64url(
    Buffer.from(
      JSON.stringify({
        iss: serviceAccount.client_email,
        scope: 'https://www.googleapis.com/auth/webmasters.readonly',
        aud: 'https://oauth2.googleapis.com/token',
        iat: now,
        exp: now + 3600,
      })
    )
  );
  const signingInput = `${header}.${payload}`;
  const signer = createSign('RSA-SHA256');
  signer.update(signingInput);
  signer.end();
  const sig = base64url(signer.sign(serviceAccount.private_key));
  return `${signingInput}.${sig}`;
}

async function exchangeJWTForToken(jwt) {
  const body = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion: jwt,
  });
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token exchange failed (${res.status}): ${text}`);
  }
  const data = await res.json();
  return data.access_token;
}

async function resolveAccessToken() {
  const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  const rawToken = process.env.GSC_ACCESS_TOKEN;

  if (rawToken) {
    return rawToken;
  }

  if (credPath) {
    let sa;
    try {
      sa = JSON.parse(readFileSync(resolve(credPath), 'utf8'));
    } catch (err) {
      throw new Error(`Cannot read service account file at ${credPath}: ${err.message}`);
    }
    if (sa.type !== 'service_account') {
      throw new Error(`File at GOOGLE_APPLICATION_CREDENTIALS is not a service_account JSON.`);
    }
    const jwt = buildJWT(sa);
    return exchangeJWTForToken(jwt);
  }

  return null; // no credentials found
}

// ---------------------------------------------------------------------------
// GSC API call
// ---------------------------------------------------------------------------

async function fetchSearchAnalytics(siteUrl, accessToken, startDate, endDate) {
  const encoded = encodeURIComponent(siteUrl);
  const url = `https://www.googleapis.com/webmasters/v3/sites/${encoded}/searchAnalytics/query`;

  const body = JSON.stringify({
    startDate,
    endDate,
    dimensions: ['query', 'page'],
    rowLimit: 1000,
  });

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GSC API error (${res.status}): ${text}`);
  }

  const data = await res.json();
  return data.rows || [];
}

// ---------------------------------------------------------------------------
// Aggregate rows → topQueries + topPages
// ---------------------------------------------------------------------------

function aggregateRows(rows) {
  const queryMap = new Map();
  const pageMap = new Map();

  for (const row of rows) {
    const [query, page] = row.keys;
    const { clicks, impressions, ctr, position } = row;

    // Aggregate by query
    if (!queryMap.has(query)) {
      queryMap.set(query, { clicks: 0, impressions: 0, ctrSum: 0, posSum: 0, count: 0 });
    }
    const q = queryMap.get(query);
    q.clicks += clicks;
    q.impressions += impressions;
    q.ctrSum += ctr;
    q.posSum += position;
    q.count += 1;

    // Aggregate by page
    if (!pageMap.has(page)) {
      pageMap.set(page, { clicks: 0, impressions: 0, ctrSum: 0, posSum: 0, count: 0 });
    }
    const p = pageMap.get(page);
    p.clicks += clicks;
    p.impressions += impressions;
    p.ctrSum += ctr;
    p.posSum += position;
    p.count += 1;
  }

  const toArray = (map, keyName) =>
    [...map.entries()]
      .map(([key, v]) => ({
        [keyName]: key,
        clicks: v.clicks,
        impressions: v.impressions,
        ctr: parseFloat((v.ctrSum / v.count).toFixed(4)),
        position: parseFloat((v.posSum / v.count).toFixed(1)),
      }))
      .sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions);

  return {
    topQueries: toArray(queryMap, 'query'),
    topPages: toArray(pageMap, 'page'),
  };
}

function buildSummary(rows) {
  if (!rows.length) {
    return { totalClicks: 0, totalImpressions: 0, avgCTR: 0, avgPosition: 0 };
  }
  let totalClicks = 0;
  let totalImpressions = 0;
  let ctrSum = 0;
  let posSum = 0;
  for (const row of rows) {
    totalClicks += row.clicks;
    totalImpressions += row.impressions;
    ctrSum += row.ctr;
    posSum += row.position;
  }
  return {
    totalClicks,
    totalImpressions,
    avgCTR: parseFloat((ctrSum / rows.length).toFixed(4)),
    avgPosition: parseFloat((posSum / rows.length).toFixed(1)),
  };
}

// ---------------------------------------------------------------------------
// Setup guide (no credentials)
// ---------------------------------------------------------------------------

function printSetupGuide() {
  console.log(`
╔══════════════════════════════════════════════════════════════════╗
║              gsc-pull — Setup Required                          ║
╚══════════════════════════════════════════════════════════════════╝

No Google credentials found. Provide one of the following:

──────────────────────────────────────────────────────────────────
OPTION A — Service Account (recommended for automation)
──────────────────────────────────────────────────────────────────

1. Open Google Cloud Console → https://console.cloud.google.com/
2. Select or create a project.
3. Enable the "Google Search Console API":
   APIs & Services → Library → search "Search Console API" → Enable
4. Create a service account:
   APIs & Services → Credentials → Create Credentials → Service Account
   - Give it any name (e.g. "gsc-reader")
   - Role: no role needed at project level
   - Click Done
5. Download the JSON key:
   Click the service account → Keys → Add Key → Create new key → JSON
   Save it somewhere safe, e.g. ~/secrets/gsc-service-account.json
6. Add the service account email to your Search Console property:
   - Open https://search.google.com/search-console/
   - Select your property → Settings → Users and permissions
   - Add user → paste the service account email (ends with @...gserviceaccount.com)
   - Permission: Restricted (read-only is enough)
7. Set the env var and run:

   export GOOGLE_APPLICATION_CREDENTIALS=~/secrets/gsc-service-account.json
   node gsc-pull.mjs --site https://getsubtextai.com

──────────────────────────────────────────────────────────────────
OPTION B — Short-lived OAuth2 access token (quick testing)
──────────────────────────────────────────────────────────────────

1. Install gcloud CLI: https://cloud.google.com/sdk/docs/install
2. Authenticate:
   gcloud auth login
3. Print a token:
   gcloud auth print-access-token
4. Export and run:

   export GSC_ACCESS_TOKEN=$(gcloud auth print-access-token)
   node gsc-pull.mjs --site https://getsubtextai.com

   Note: tokens expire after ~1 hour.

──────────────────────────────────────────────────────────────────
`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv);

  if (!args.site) {
    console.error('Error: --site is required. Example: --site https://getsubtextai.com');
    process.exit(1);
  }

  // Resolve credentials
  let accessToken;
  try {
    accessToken = await resolveAccessToken();
  } catch (err) {
    console.error(`Auth error: ${err.message}`);
    process.exit(1);
  }

  if (!accessToken) {
    printSetupGuide();
    process.exit(0);
  }

  const { start, end } = dateRange(args.days);
  console.log(`Pulling GSC data for ${args.site} (${start} → ${end}) …`);

  let rows;
  try {
    rows = await fetchSearchAnalytics(args.site, accessToken, start, end);
  } catch (err) {
    console.error(`GSC fetch failed: ${err.message}`);
    process.exit(1);
  }

  console.log(`Fetched ${rows.length} rows.`);

  const summary = buildSummary(rows);
  const { topQueries, topPages } = aggregateRows(rows);

  const result = {
    site: args.site,
    period: { start, end },
    pulledAt: new Date().toISOString(),
    summary,
    topQueries,
    topPages,
  };

  const json = JSON.stringify(result, null, 2);

  if (args.output) {
    const outPath = resolve(args.output);
    writeFileSync(outPath, json, 'utf8');
    console.log(`Saved → ${outPath}`);
  } else {
    console.log('\n' + json);
  }
}

main();
