const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { JSDOM, VirtualConsole } = require("jsdom");

const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

const virtualConsole = new VirtualConsole();
virtualConsole.on("error", () => {});

function checkSelectorCompatibility(selector) {
  if (!selector) return;
  const unsupportedPatterns = [
    { pattern: /\[[^\]]+\]\s*\[[^\]]+\]/, reason: "Stacked attribute selectors (e.g. [attr1][attr2]) are not supported by Harbor." },
    { pattern: /:[a-zA-Z-]+/, reason: "Pseudo-classes (e.g. :not, :nth-child, :contains) are not supported by Harbor." },
    { pattern: /[+~]/, reason: "Sibling combinators (+ and ~) are not supported by Harbor." }
  ];

  for (const check of unsupportedPatterns) {
    if (check.pattern.test(selector)) {
      console.warn(`  ⚠️ HARBOR CSS SELECTOR WARNING: Selector "${selector}" may fail in Harbor natively. Reason: ${check.reason}`);
    }
  }
}

global.harbor = {
  register(provider) {
    global.plugin = provider;
  },

  log(...args) {
    console.log("  [harbor.log]", ...args);
  },

  async http(url, opts = {}) {
    const startTime = Date.now();
    try {
      const FORBIDDEN_HEADERS = [
        "host", "cookie", "authorization", "origin", "referer", "content-length", "connection"
      ];

      const rawHeaders = opts.headers || {};
      const cleanHeaders = { "User-Agent": USER_AGENT };

      for (const [k, v] of Object.entries(rawHeaders)) {
        const lowerK = k.toLowerCase();
        if (
          !FORBIDDEN_HEADERS.includes(lowerK) &&
          !lowerK.startsWith("sec-") &&
          !lowerK.startsWith("x-harbor")
        ) {
          cleanHeaders[k] = v;
        }
      }

      const method = (opts.method || "GET").toUpperCase();
      const curlArgs = ["-sL", "-w", "\n%{http_code}", "-X", method];

      for (const [k, v] of Object.entries(cleanHeaders)) {
        curlArgs.push("-H", `${k}: ${v}`);
      }

      if (opts.body && method !== "GET" && method !== "HEAD") {
        curlArgs.push("-d", typeof opts.body === "string" ? opts.body : JSON.stringify(opts.body));
      }

      curlArgs.push(url);

      const res = spawnSync("curl", curlArgs, { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 });

      if (res.error) {
        console.error(`  ❌ HTTP NETWORK ERROR [${method} ${url}]:`, res.error.message);
        if (opts.responseType === "json") return null;
        return { ok: false, status: 500, body: res.error.message };
      }

      const lines = (res.stdout || "").trim().split("\n");
      const statusCode = parseInt(lines.pop(), 10) || 500;
      const rawBody = lines.join("\n");
      const duration = Date.now() - startTime;

      if (statusCode >= 200 && statusCode < 300) {
        console.log(`  🌐 HTTP ${method} ${url} -> ${statusCode} (${duration}ms | ${(rawBody.length / 1024).toFixed(1)} KB)`);
      } else {
        console.error(`  ❌ HTTP ${method} ${url} -> FAILED WITH STATUS ${statusCode} (${duration}ms)`);
        const snippet = rawBody.substring(0, 250).replace(/\s+/g, " ");
        console.error(`     Response Snippet: "${snippet}"`);
      }

      if (opts.responseType === "json") {
        if (statusCode < 200 || statusCode >= 300 || !rawBody) return null;
        try {
          return JSON.parse(rawBody);
        } catch (e) {
          console.error(`  ❌ JSON PARSE ERROR [${url}]: Failed to parse body as JSON.`);
          console.error(`     Raw Snippet: "${rawBody.substring(0, 150)}..."`);
          return null;
        }
      }

      return {
        ok: statusCode >= 200 && statusCode < 300,
        status: statusCode,
        headers: {},
        body: rawBody,
      };
    } catch (err) {
      console.error(`  ❌ UNCAUGHT HTTP ERROR [${url}]:`, err.message);
      if (opts.responseType === "json") return null;
      return { ok: false, status: 500, body: err.message };
    }
  },

  parseHtml(htmlString) {
    const sanitizedHtml = (htmlString || "")
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "")
      .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, "");

    const dom = new JSDOM(sanitizedHtml, { virtualConsole });
    const doc = dom.window.document;

    function wrap(el) {
      if (!el) return null;
      return {
        text: () => (el.textContent || "").trim(),
        attr: (name) => el.getAttribute(name) || "",
        querySelector: (sel) => {
          checkSelectorCompatibility(sel);
          return wrap(el.querySelector(sel));
        },
        querySelectorAll: (sel) => {
          checkSelectorCompatibility(sel);
          return Array.from(el.querySelectorAll(sel)).map(wrap);
        },
      };
    }
    return wrap(doc);
  },
};

function loadPlugin(pluginFile) {
  delete global.plugin;
  let code = fs.readFileSync(pluginFile, "utf8");
  code = code.replace(/const\s+plugin\s*=/, "global.plugin =");
  eval(code);
  return global.plugin;
}

function verifyManifestMatch(plugin) {
  if (!fs.existsSync("./repo.json")) return;
  try {
    const repo = JSON.parse(fs.readFileSync("./repo.json", "utf8"));
    const entry = repo.plugins?.find((p) => p.id === plugin.id);
    if (!entry) {
      console.warn(`  ⚠️ MANIFEST WARNING: Plugin ID "${plugin.id}" was NOT found in repo.json!`);
    } else {
      console.log(`  ✅ Manifest Check: Matched repo.json entry for ID "${plugin.id}".`);
    }
  } catch (e) {}
}

async function runPluginTests(pluginFile) {
  console.log(`\n========================================`);
  console.log(`🚀 DIAGNOSTIC TEST RUNNER: ${pluginFile}`);
  console.log(`========================================`);

  if (!fs.existsSync(pluginFile)) {
    console.error(`❌ File not found: ${pluginFile}`);
    return;
  }

  const plugin = loadPlugin(pluginFile);
  console.log(`Loaded plugin ID: "${plugin.id}" | Name: "${plugin.name}"`);
  verifyManifestMatch(plugin);

  // 1. Tags Test
  try {
    console.log("\n--- 1. Testing tags() ---");
    if (typeof plugin.tags === "function") {
      const tags = await plugin.tags();
      console.log(`✅ Fetched ${tags?.length || 0} tags.`);
      if (tags?.length > 0) {
        console.log("Sample:", tags.slice(0, 3));
        const invalidTags = tags.filter((t) => !t.id || !t.name);
        if (invalidTags.length > 0) {
          console.warn(`  ⚠️ HARBOR SANITIZATION WARNING: ${invalidTags.length} tags missing 'id' or 'name'.`);
        }
      }
    }
  } catch (err) {
    console.error("❌ Error in tags():", err);
  }

  // 2. Popular Test
  let popularItems = [];
  try {
    console.log("\n--- 2. Testing popular(0) ---");
    popularItems = await plugin.popular(0);
    console.log(`✅ Fetched ${popularItems?.length || 0} popular titles.`);
    if (popularItems?.length > 0) {
      console.log("Top 3 Popular Titles:", popularItems.slice(0, 3).map((i) => i.title));

      const invalidCovers = popularItems.filter((i) => i.cover && !/^https?:\/\//i.test(i.cover));
      if (invalidCovers.length > 0) {
        console.warn(`  ⚠️ HARBOR SANITIZATION WARNING: ${invalidCovers.length} relative covers will be dropped!`);
      }
      const invalidSummaries = popularItems.filter((i) => !i.id || !i.title);
      if (invalidSummaries.length > 0) {
        console.warn(`  ⚠️ HARBOR SANITIZATION WARNING: ${invalidSummaries.length} items missing 'id' or 'title'!`);
      }
    }
  } catch (err) {
    console.error("❌ Error in popular():", err);
  }

  // 3. Search Test
  let searchItems = [];
  try {
    let searchQuery = "jujutsu";
    if (popularItems?.length > 0 && popularItems[0].title) {
      const extractedWord = popularItems[0].title.split(" ")[0].replace(/[^a-zA-Z0-9]/g, "").trim();
      if (extractedWord) searchQuery = extractedWord;
    }

    console.log(`\n--- 3. Testing search('${searchQuery}', 0) ---`);
    searchItems = await plugin.search(searchQuery, 0);
    console.log(`✅ Fetched ${searchItems?.length || 0} search results.`);
    if (searchItems?.length > 0) console.log("Search Results:", searchItems.map((i) => i.title));
  } catch (err) {
    console.error("❌ Error in search():", err);
  }

  // Combine candidates
  const testCandidates = [...searchItems, ...popularItems];
  let selectedChapter = null;

  for (const item of testCandidates) {
    try {
      console.log(`\n--- 4. Testing detail('${item.id}') ---`);
      const detail = await plugin.detail(item.id);
      if (!detail) {
        console.warn(`⚠️ detail('${item.id}') returned null.`);
        continue;
      }

      console.log("✅ Detail Result:", {
        title: detail.title,
        status: detail.status,
        author: detail.author,
        coverValid: /^https?:\/\//.test(detail.cover || "")
      });

      console.log(`\n--- 5. Testing chapters('${item.id}') ---`);
      const chapters = await plugin.chapters(item.id);
      console.log(`✅ Fetched ${chapters?.length || 0} chapters for "${item.title}".`);

      if (chapters?.length > 0) {
        const missingIds = chapters.filter((c) => !c.id);
        if (missingIds.length > 0) {
          console.warn(`  ⚠️ HARBOR SANITIZATION WARNING: ${missingIds.length} chapters missing 'id'!`);
        }

        console.log("📊 Chapter Sequence Check:");
        console.log("  - First Chapter [Index 0]:", chapters[0].title, `(Ch: ${chapters[0].chapter})`);
        console.log("  - Last Chapter [Index N]:", chapters[chapters.length - 1].title, `(Ch: ${chapters[chapters.length - 1].chapter})`);

        if (parseFloat(chapters[0].chapter) <= parseFloat(chapters[chapters.length - 1].chapter)) {
          console.log("  ✅ Order Verification PASSED: Chapters start from early chapters and end at the latest.");
        } else {
          console.log("  ⚠️ Order Verification WARNING: Chapter sequence is inverted.");
        }

        selectedChapter = chapters[0];
        break;
      }
    } catch (err) {
      console.error(`❌ Error testing candidate '${item.id}':`, err);
    }
  }

  // 6. Page URLs Test
  if (!selectedChapter?.id) {
    console.warn("⚠️ Skipping pageUrls: No valid chapter found.");
    return;
  }

  try {
    console.log(`\n--- 6. Testing pageUrls('${selectedChapter.id}') ---`);
    const pages = await plugin.pageUrls(selectedChapter.id);
    console.log(`✅ Fetched ${pages?.length || 0} page URLs.`);
    if (pages?.length > 0) {
      console.log("Sample Pages:", pages.slice(0, 3));
      const invalidPages = pages.filter((p) => !/^https?:\/\//i.test(p));
      if (invalidPages.length > 0) {
        console.error(`❌ HARBOR SANITIZATION ERROR: ${invalidPages.length} relative or invalid page URLs!`);
      } else {
        console.log("  ✅ Image URL Protocol Check: PASSED");
      }
    }
  } catch (err) {
    console.error("❌ Error in pageUrls():", err);
  }
}

(async () => {
  const targetArg = process.argv[2];
  if (targetArg) {
    const file = targetArg.endsWith(".plugin.js") ? targetArg : `${targetArg}.plugin.js`;
    await runPluginTests(`./${file}`);
  } else if (fs.existsSync("./repo.json")) {
    const repo = JSON.parse(fs.readFileSync("./repo.json", "utf8"));
    for (const p of repo.plugins) {
      await runPluginTests(`./${p.entry}`);
    }
  }
})();