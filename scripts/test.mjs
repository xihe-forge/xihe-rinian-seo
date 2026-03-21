/**
 * Test suite for xihe-seo-aeo scripts
 * Run with: node --test scripts/test.mjs
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join, dirname, basename } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readdirSync } from "node:fs";

const execFileAsync = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPTS_DIR = __dirname;
const ENGINES_DIR = join(SCRIPTS_DIR, "engines");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function scriptPath(name) {
  return join(SCRIPTS_DIR, name);
}

async function runScript(scriptName, args = [], env = {}) {
  const { stdout, stderr } = await execFileAsync(
    process.execPath,
    [scriptPath(scriptName), ...args],
    {
      env: { ...process.env, ...env },
      timeout: 30_000,
    }
  );
  return { stdout, stderr };
}

// ---------------------------------------------------------------------------
// 1. crawl-page.mjs
// ---------------------------------------------------------------------------

describe("crawl-page.mjs", () => {
  test(
    "crawls https://example.com and returns valid JSON with url and crawledAt",
    { timeout: 20_000 },
    async () => {
      const { stdout } = await runScript("crawl-page.mjs", [
        "https://example.com",
      ]);

      let result;
      try {
        result = JSON.parse(stdout);
      } catch {
        assert.fail(`stdout is not valid JSON. Got:\n${stdout.slice(0, 500)}`);
      }

      // These two fields are always present whether the fetch succeeded or not
      assert.ok(
        Object.prototype.hasOwnProperty.call(result, "url"),
        "result should have 'url' field"
      );
      assert.ok(
        Object.prototype.hasOwnProperty.call(result, "crawledAt"),
        "result should have 'crawledAt' field"
      );

      // url should echo back what we passed
      assert.equal(result.url, "https://example.com");

      // crawledAt should be an ISO timestamp
      assert.match(
        result.crawledAt,
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/,
        "crawledAt should be ISO timestamp"
      );

      // If the fetch failed (network unavailable), the script returns { url, crawledAt, error }
      // and we skip field-level assertions since there is no page data.
      if (Object.prototype.hasOwnProperty.call(result, "error")) {
        // Still valid behaviour: error field must be a non-empty string
        assert.ok(
          typeof result.error === "string" && result.error.length > 0,
          "error field should be a non-empty string"
        );
        return; // skip remainder — network not available in this environment
      }

      // Full field assertions only when the fetch succeeded
      const requiredFields = [
        "http",
        "meta",
        "headings",
        "schema",
        "links",
        "images",
        "hreflang",
        "llmsTxt",
        "robotsTxt",
        "sitemap",
        "content",
        "faq",
      ];
      for (const field of requiredFields) {
        assert.ok(
          Object.prototype.hasOwnProperty.call(result, field),
          `Missing field: ${field}`
        );
      }

      // http shape
      assert.ok(typeof result.http.status === "number", "http.status should be a number");
      assert.ok(result.http.status >= 200 && result.http.status < 400, "http.status should be 2xx/3xx");
      assert.ok(typeof result.http.headers === "object", "http.headers should be an object");

      // meta shape
      assert.ok(typeof result.meta === "object" && result.meta !== null, "meta should be an object");
      assert.ok(Object.prototype.hasOwnProperty.call(result.meta, "title"), "meta.title missing");
      assert.ok(Object.prototype.hasOwnProperty.call(result.meta, "description"), "meta.description missing");
      assert.ok(Object.prototype.hasOwnProperty.call(result.meta, "canonical"), "meta.canonical missing");
      assert.ok(typeof result.meta.og === "object", "meta.og should be an object");
      assert.ok(typeof result.meta.twitter === "object", "meta.twitter should be an object");

      // headings is array
      assert.ok(Array.isArray(result.headings), "headings should be an array");

      // schema is array
      assert.ok(Array.isArray(result.schema), "schema should be an array");

      // links shape
      assert.ok(typeof result.links === "object" && result.links !== null, "links should be an object");
      assert.ok(typeof result.links.internal === "number", "links.internal should be a number");
      assert.ok(typeof result.links.external === "number", "links.external should be a number");
      assert.ok(Array.isArray(result.links.anchors), "links.anchors should be an array");

      // images shape
      assert.ok(typeof result.images === "object" && result.images !== null, "images should be an object");
      assert.ok(typeof result.images.total === "number", "images.total should be a number");
      assert.ok(typeof result.images.missingAlt === "number", "images.missingAlt should be a number");
      assert.ok(Array.isArray(result.images.noAltList), "images.noAltList should be an array");

      // hreflang is array
      assert.ok(Array.isArray(result.hreflang), "hreflang should be an array");

      // sitemap shape
      assert.ok(typeof result.sitemap === "object" && result.sitemap !== null, "sitemap should be an object");
      assert.ok(Object.prototype.hasOwnProperty.call(result.sitemap, "exists"), "sitemap.exists missing");
      assert.ok(Object.prototype.hasOwnProperty.call(result.sitemap, "url"), "sitemap.url missing");
      assert.ok(Object.prototype.hasOwnProperty.call(result.sitemap, "valid"), "sitemap.valid missing");

      // content shape
      assert.ok(typeof result.content === "object" && result.content !== null, "content should be an object");
      assert.ok(typeof result.content.wordCount === "number", "content.wordCount should be a number");
      assert.ok(typeof result.content.readingTimeMin === "number", "content.readingTimeMin should be a number");
      assert.ok(typeof result.content.pageSizeBytes === "number", "content.pageSizeBytes should be a number");
      assert.ok(result.content.pageSizeBytes > 0, "content.pageSizeBytes should be > 0");

      // faq is array
      assert.ok(Array.isArray(result.faq), "faq should be an array");
    }
  );

  test("exits with error when no URL is given", async () => {
    try {
      await runScript("crawl-page.mjs", []);
      assert.fail("Expected non-zero exit");
    } catch (err) {
      assert.ok(
        err.code !== 0 || err.stderr?.includes("Usage"),
        "Should exit with error or print usage"
      );
    }
  });
});

// ---------------------------------------------------------------------------
// 2. check-ai-citation.mjs
// ---------------------------------------------------------------------------

describe("check-ai-citation.mjs", () => {
  test(
    "no-API-key path: generates template JSON with all required fields",
    { timeout: 20_000 },
    async () => {
      // Strip all engine API keys so the script takes the template path
      const safeEnv = {
        PERPLEXITY_API_KEY: "",
        OPENAI_API_KEY: "",
        GEMINI_API_KEY: "",
        MOONSHOT_API_KEY: "",
        YOU_API_KEY: "",
      };

      const { stdout } = await runScript(
        "check-ai-citation.mjs",
        ["--domain", "example.com", "--keywords", "test query"],
        safeEnv
      );

      let result;
      try {
        result = JSON.parse(stdout);
      } catch {
        assert.fail(`stdout is not valid JSON. Got:\n${stdout.slice(0, 500)}`);
      }

      // Required top-level fields
      for (const field of ["domain", "checkedAt", "engines", "keywords", "summary"]) {
        assert.ok(
          Object.prototype.hasOwnProperty.call(result, field),
          `Missing field: ${field}`
        );
      }

      // domain should be normalised (no protocol)
      assert.ok(
        !result.domain.startsWith("http"),
        "domain should not include protocol"
      );
      assert.equal(result.domain, "example.com");

      // checkedAt is ISO timestamp
      assert.match(
        result.checkedAt,
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/,
        "checkedAt should be ISO timestamp"
      );

      // engines is an array
      assert.ok(Array.isArray(result.engines), "engines should be an array");
      assert.ok(result.engines.length > 0, "engines should not be empty");

      // keywords is an array with at least one entry
      assert.ok(Array.isArray(result.keywords), "keywords should be an array");
      assert.ok(result.keywords.length > 0, "keywords should have entries");

      const kw = result.keywords[0];
      assert.ok(typeof kw.keyword === "string", "keyword entry should have keyword string");
      assert.ok(typeof kw.results === "object" && kw.results !== null, "keyword entry should have results object");

      // summary shape
      assert.ok(typeof result.summary === "object" && result.summary !== null, "summary should be an object");
      assert.ok(
        Object.prototype.hasOwnProperty.call(result.summary, "totalKeywords"),
        "summary.totalKeywords missing"
      );
      assert.ok(
        Object.prototype.hasOwnProperty.call(result.summary, "perEngine"),
        "summary.perEngine missing"
      );
      assert.ok(
        Object.prototype.hasOwnProperty.call(result.summary, "overallCitationRate"),
        "summary.overallCitationRate missing"
      );
    }
  );

  test("--list flag exits 0 and prints engine table", { timeout: 10_000 }, async () => {
    const safeEnv = {
      PERPLEXITY_API_KEY: "",
      OPENAI_API_KEY: "",
      GEMINI_API_KEY: "",
      MOONSHOT_API_KEY: "",
      YOU_API_KEY: "",
    };

    // --list causes process.exit(0) so execFile resolves normally
    const { stdout } = await runScript("check-ai-citation.mjs", ["--list"], safeEnv);

    // Should mention each engine name
    for (const engine of ["perplexity", "chatgpt", "gemini", "kimi", "youcom"]) {
      assert.ok(
        stdout.includes(engine),
        `--list output should mention engine: ${engine}`
      );
    }
  });

  test("exits with error when --domain or --keywords is missing", async () => {
    const safeEnv = {
      PERPLEXITY_API_KEY: "",
      OPENAI_API_KEY: "",
      GEMINI_API_KEY: "",
      MOONSHOT_API_KEY: "",
      YOU_API_KEY: "",
    };

    try {
      await runScript("check-ai-citation.mjs", ["--domain", "example.com"], safeEnv);
      assert.fail("Expected non-zero exit when --keywords missing");
    } catch (err) {
      assert.ok(err.code !== 0, "Should exit with non-zero code");
    }
  });
});

// ---------------------------------------------------------------------------
// 3. generate-llms-txt.mjs
// ---------------------------------------------------------------------------

describe("generate-llms-txt.mjs", () => {
  test(
    "generates llms.txt for https://example.com with correct structure",
    { timeout: 20_000 },
    async (t) => {
      let stdout;
      try {
        ({ stdout } = await runScript("generate-llms-txt.mjs", [
          "--url",
          "https://example.com",
          "--name",
          "Example Domain",
        ]));
      } catch (err) {
        // Network unavailable in this environment — skip gracefully
        const networkError =
          err.stderr?.includes("Failed to fetch homepage") ||
          err.stderr?.includes("fetch failed") ||
          err.code === 1;
        if (networkError) {
          t.skip("Network unavailable — skipping live fetch test");
          return;
        }
        throw err;
      }

      assert.ok(stdout.length > 0, "Output should not be empty");

      // Must start with a level-1 heading
      assert.ok(
        stdout.trimStart().startsWith("# "),
        `Output should start with "# ". Got: ${stdout.slice(0, 80)}`
      );

      // Must contain at least one level-2 section
      assert.ok(
        stdout.includes("## "),
        'Output should contain at least one "## " section'
      );

      // First heading line should contain the site name we passed
      const firstLine = stdout.split("\n")[0];
      assert.ok(
        firstLine.includes("Example Domain"),
        `First heading should include the site name. Got: ${firstLine}`
      );
    }
  );

  test("exits with error when --url or --name is missing", async () => {
    try {
      await runScript("generate-llms-txt.mjs", ["--url", "https://example.com"]);
      assert.fail("Expected non-zero exit when --name is missing");
    } catch (err) {
      assert.ok(err.code !== 0, "Should exit with non-zero code");
    }
  });
});

// ---------------------------------------------------------------------------
// 4. lighthouse-pull.mjs
// ---------------------------------------------------------------------------

describe("lighthouse-pull.mjs", () => {
  test("exits with error and prints usage when --url is missing", async () => {
    try {
      await runScript("lighthouse-pull.mjs", []);
      assert.fail("Expected non-zero exit when --url is missing");
    } catch (err) {
      assert.ok(err.code !== 0, "Should exit with non-zero code");
      assert.ok(
        err.stderr?.includes("Usage") || err.stderr?.includes("--url"),
        `stderr should mention usage/--url. Got: ${err.stderr?.slice(0, 200)}`
      );
    }
  });

  test("exits with error and hints when invalid --strategy is given", async () => {
    try {
      await runScript("lighthouse-pull.mjs", [
        "--url", "https://example.com",
        "--strategy", "tablet",
      ]);
      assert.fail("Expected non-zero exit for invalid strategy");
    } catch (err) {
      assert.ok(err.code !== 0, "Should exit with non-zero code");
      assert.ok(
        err.stderr?.includes("strategy") || err.stderr?.includes("mobile") || err.stderr?.includes("desktop"),
        `stderr should mention strategy options. Got: ${err.stderr?.slice(0, 200)}`
      );
    }
  });
});

// ---------------------------------------------------------------------------
// 5. check-ai-citation.mjs — --competitors flag
// ---------------------------------------------------------------------------

describe("check-ai-citation.mjs — --competitors flag", () => {
  test(
    "template output still produces valid JSON when --competitors is given (no-API-key path)",
    { timeout: 20_000 },
    async () => {
      const safeEnv = {
        PERPLEXITY_API_KEY: "",
        OPENAI_API_KEY: "",
        GEMINI_API_KEY: "",
        MOONSHOT_API_KEY: "",
        YOU_API_KEY: "",
      };

      const { stdout, stderr } = await runScript(
        "check-ai-citation.mjs",
        [
          "--domain", "example.com",
          "--keywords", "test query",
          "--competitors", "rival.com,other.com",
        ],
        safeEnv
      );

      // Must still produce valid JSON even when competitors are supplied but no engines run
      let result;
      try {
        result = JSON.parse(stdout);
      } catch {
        assert.fail(`stdout is not valid JSON. Got:\n${stdout.slice(0, 500)}`);
      }

      // Core fields must still be present
      for (const field of ["domain", "checkedAt", "engines", "keywords", "summary"]) {
        assert.ok(
          Object.prototype.hasOwnProperty.call(result, field),
          `Missing field: ${field}`
        );
      }

      // When engines run and competitors are supplied, each keyword entry gets a competitors
      // sub-object keyed by competitor domain. In no-API-key template mode, the per-keyword
      // competitors key is omitted — but the competitor domains should still appear in stderr
      // (logged as "Competitors: rival.com, other.com" when engines are configured).
      // We just assert the output is valid and the domain is correct.
      assert.equal(result.domain, "example.com");
    }
  );

  test("--list output mentions --competitors flag", { timeout: 10_000 }, async () => {
    const safeEnv = {
      PERPLEXITY_API_KEY: "",
      OPENAI_API_KEY: "",
      GEMINI_API_KEY: "",
      MOONSHOT_API_KEY: "",
      YOU_API_KEY: "",
    };
    const { stdout } = await runScript("check-ai-citation.mjs", ["--list"], safeEnv);
    assert.ok(
      stdout.includes("--competitors"),
      '--list output should mention the --competitors flag'
    );
  });
});

// ---------------------------------------------------------------------------
// 6. Engine modules
// ---------------------------------------------------------------------------

describe("engine modules", () => {
  const ENGINE_NAMES = ["perplexity", "chatgpt", "gemini", "kimi", "youcom"];
  // Map engine filename -> expected envKey (for asserting isAvailable when key absent)
  const EXPECTED_ENV_KEYS = {
    perplexity: "PERPLEXITY_API_KEY",
    chatgpt: "OPENAI_API_KEY",
    gemini: "GEMINI_API_KEY",
    kimi: "MOONSHOT_API_KEY",
    youcom: "YOU_API_KEY",
  };

  // Discover actual engine files
  const engineFiles = readdirSync(ENGINES_DIR)
    .filter((f) => f.endsWith(".mjs"))
    .map((f) => basename(f, ".mjs"));

  test("all expected engine files exist", () => {
    for (const name of ENGINE_NAMES) {
      assert.ok(
        engineFiles.includes(name),
        `Engine file missing: engines/${name}.mjs`
      );
    }
  });

  for (const engineName of ENGINE_NAMES) {
    describe(`engine: ${engineName}`, () => {
      let engine;

      test("can be imported", async () => {
        const filePath = join(ENGINES_DIR, `${engineName}.mjs`);
        engine = await import(pathToFileURL(filePath).href);
        assert.ok(engine !== undefined, "Module should import successfully");
      });

      test("exports required properties: name, envKey, setupUrl, isAvailable, query", async () => {
        if (!engine) {
          const filePath = join(ENGINES_DIR, `${engineName}.mjs`);
          engine = await import(pathToFileURL(filePath).href);
        }

        assert.ok(
          typeof engine.name === "string" && engine.name.length > 0,
          `${engineName}: 'name' should be a non-empty string`
        );
        assert.ok(
          typeof engine.envKey === "string" && engine.envKey.length > 0,
          `${engineName}: 'envKey' should be a non-empty string`
        );
        assert.ok(
          typeof engine.setupUrl === "string" && engine.setupUrl.startsWith("http"),
          `${engineName}: 'setupUrl' should be a URL string`
        );
        assert.ok(
          typeof engine.isAvailable === "function",
          `${engineName}: 'isAvailable' should be a function`
        );
        assert.ok(
          typeof engine.query === "function",
          `${engineName}: 'query' should be a function`
        );
      });

      test("name matches file name", async () => {
        if (!engine) {
          const filePath = join(ENGINES_DIR, `${engineName}.mjs`);
          engine = await import(pathToFileURL(filePath).href);
        }
        assert.equal(
          engine.name,
          engineName,
          `engine.name should equal file name "${engineName}"`
        );
      });

      test("isAvailable() returns false when API key env var is not set", async () => {
        if (!engine) {
          const filePath = join(ENGINES_DIR, `${engineName}.mjs`);
          engine = await import(pathToFileURL(filePath).href);
        }
        // Save original value and temporarily clear it
        const envKey = EXPECTED_ENV_KEYS[engineName];
        const original = process.env[envKey];
        delete process.env[envKey];

        try {
          const available = engine.isAvailable();
          assert.equal(
            available,
            false,
            `isAvailable() should return false when ${envKey} is not set`
          );
        } finally {
          // Restore
          if (original !== undefined) {
            process.env[envKey] = original;
          }
        }
      });

      test("envKey matches expected environment variable name", async () => {
        if (!engine) {
          const filePath = join(ENGINES_DIR, `${engineName}.mjs`);
          engine = await import(pathToFileURL(filePath).href);
        }
        assert.equal(
          engine.envKey,
          EXPECTED_ENV_KEYS[engineName],
          `engine.envKey should be ${EXPECTED_ENV_KEYS[engineName]}`
        );
      });
    });
  }
});
