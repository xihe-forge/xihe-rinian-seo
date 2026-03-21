import * as cheerio from 'cheerio';
import { writeFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const TIMEOUT_MS = 10_000;
const CONCURRENCY = 3;

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      args[key] = argv[i + 1] ?? true;
      i++;
    }
  }
  return args;
}

async function fetchWithTimeout(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'xihe-llms-txt-generator/1.0' },
      redirect: 'follow',
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    return await res.text();
  } catch {
    clearTimeout(timer);
    return null;
  }
}

function extractMeta(html, baseUrl) {
  const $ = cheerio.load(html);
  const title =
    $('meta[property="og:title"]').attr('content') ||
    $('title').text().trim() ||
    '';
  const description =
    $('meta[name="description"]').attr('content') ||
    $('meta[property="og:description"]').attr('content') ||
    '';
  return { title, description };
}

function extractNavLinks(html, baseUrl) {
  const $ = cheerio.load(html);
  const base = new URL(baseUrl);
  const links = [];
  $('nav a[href]').each((_, el) => {
    const href = $(el).attr('href');
    const text = $(el).text().trim();
    if (!href || !text) return;
    try {
      const resolved = new URL(href, baseUrl);
      if (resolved.hostname !== base.hostname) return;
      if (resolved.pathname === '/') return;
      links.push({ url: resolved.href, title: text });
    } catch {}
  });
  const seen = new Set();
  return links.filter(l => {
    if (seen.has(l.url)) return false;
    seen.add(l.url);
    return true;
  });
}

function parseSitemap(xml) {
  const urls = [];
  const locRe = /<loc>(.*?)<\/loc>/g;
  let m;
  while ((m = locRe.exec(xml)) !== null) {
    urls.push(m[1].trim());
  }
  return urls;
}

function categorizeUrl(urlStr, baseUrl) {
  const path = new URL(urlStr).pathname.toLowerCase();
  if (path === '/') return 'Key Pages';
  if (path.startsWith('/blog')) return 'Blog';
  if (path.startsWith('/docs') || path.startsWith('/documentation')) return 'Documentation';
  if (path.startsWith('/api')) return 'API';
  if (path.startsWith('/guide')) return 'Documentation';
  return 'Key Pages';
}

async function runConcurrent(tasks, limit) {
  const results = [];
  let index = 0;
  async function worker() {
    while (index < tasks.length) {
      const i = index++;
      results[i] = await tasks[i]();
    }
  }
  const workers = Array.from({ length: Math.min(limit, tasks.length) }, worker);
  await Promise.all(workers);
  return results;
}

async function fetchPageInfo(url) {
  const html = await fetchWithTimeout(url);
  if (!html) return { url, title: null, description: null };
  const { title, description } = extractMeta(html, url);
  return { url, title, description };
}

function formatSection(heading, pages) {
  if (!pages.length) return '';
  const lines = [`## ${heading}`];
  for (const p of pages) {
    const title = p.title || new URL(p.url).pathname;
    const desc = p.description ? `: ${p.description.replace(/\s+/g, ' ').trim()}` : '';
    lines.push(`- [${title}](${p.url})${desc}`);
  }
  return lines.join('\n');
}

async function main() {
  const args = parseArgs(process.argv);

  if (!args.url || !args.name) {
    process.stderr.write('Usage: generate-llms-txt.mjs --url <url> --name <name> [--description <desc>] [--sitemap <sitemap-url>] [--output <path>]\n');
    process.exit(1);
  }

  const siteUrl = args.url.replace(/\/$/, '');
  const siteName = args.name;

  process.stderr.write(`Fetching homepage: ${siteUrl}\n`);
  const homepageHtml = await fetchWithTimeout(siteUrl);
  if (!homepageHtml) {
    process.stderr.write(`Failed to fetch homepage: ${siteUrl}\n`);
    process.exit(1);
  }

  const { title: siteTitle, description: siteMeta } = extractMeta(homepageHtml, siteUrl);
  const description = args.description || siteMeta || siteTitle || '';

  const categorized = {};

  if (args.sitemap) {
    process.stderr.write(`Fetching sitemap: ${args.sitemap}\n`);
    const sitemapXml = await fetchWithTimeout(args.sitemap);
    if (!sitemapXml) {
      process.stderr.write('Warning: could not fetch sitemap, falling back to nav links.\n');
    } else {
      const urls = parseSitemap(sitemapXml).filter(u => {
        try {
          return new URL(u).hostname === new URL(siteUrl).hostname;
        } catch {
          return false;
        }
      });
      process.stderr.write(`Found ${urls.length} URLs in sitemap, fetching titles...\n`);
      const tasks = urls.map(u => () => fetchPageInfo(u));
      const infos = await runConcurrent(tasks, CONCURRENCY);
      for (const info of infos) {
        const cat = categorizeUrl(info.url, siteUrl);
        if (!categorized[cat]) categorized[cat] = [];
        categorized[cat].push(info);
      }
    }
  }

  if (!Object.keys(categorized).length) {
    const navLinks = extractNavLinks(homepageHtml, siteUrl);
    process.stderr.write(`Crawling ${navLinks.length} nav links...\n`);
    const tasks = navLinks.map(l => () => fetchPageInfo(l.url));
    const infos = await runConcurrent(tasks, CONCURRENCY);
    for (const info of infos) {
      const cat = categorizeUrl(info.url, siteUrl);
      if (!categorized[cat]) categorized[cat] = [];
      categorized[cat].push({ ...info, title: info.title || navLinks.find(l => l.url === info.url)?.title || null });
    }
  }

  const sectionOrder = ['Key Pages', 'Documentation', 'Blog', 'API'];
  const sections = [];
  for (const cat of sectionOrder) {
    if (categorized[cat]?.length) {
      sections.push(formatSection(cat, categorized[cat]));
    }
  }
  for (const cat of Object.keys(categorized)) {
    if (!sectionOrder.includes(cat) && categorized[cat]?.length) {
      sections.push(formatSection(cat, categorized[cat]));
    }
  }

  const llmsTxt = [
    `# ${siteName}`,
    '',
    `> ${description}`,
    '',
    '## About',
    description,
    '',
    ...sections.map(s => s + '\n'),
  ].join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';

  const llmsFullParts = [
    `# ${siteName}`,
    '',
    `> ${description}`,
    '',
    '## About',
    description,
    '',
  ];

  for (const cat of [...sectionOrder, ...Object.keys(categorized).filter(c => !sectionOrder.includes(c))]) {
    const pages = categorized[cat];
    if (!pages?.length) continue;
    llmsFullParts.push(`## ${cat}`, '');
    for (const p of pages) {
      const title = p.title || new URL(p.url).pathname;
      llmsFullParts.push(`### [${title}](${p.url})`);
      if (p.description) {
        llmsFullParts.push('', p.description.replace(/\s+/g, ' ').trim());
      }
      llmsFullParts.push('');
    }
  }

  const llmsFullTxt = llmsFullParts.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';

  if (args.output) {
    const outPath = args.output;
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, llmsTxt, 'utf8');
    const fullPath = join(dirname(outPath), 'llms-full.txt');
    writeFileSync(fullPath, llmsFullTxt, 'utf8');
    process.stderr.write(`Written: ${outPath}\n`);
    process.stderr.write(`Written: ${fullPath}\n`);
  } else {
    process.stdout.write(llmsTxt);
  }
}

main().catch(err => {
  process.stderr.write(`Error: ${err.message}\n`);
  process.exit(1);
});
