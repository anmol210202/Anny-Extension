const fs = require("fs");
const { execSync } = require("child_process");
const { JSDOM } = require("jsdom");

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

global.harbor = {
  async http(url, opts = {}) {
    try {
      // Use system curl to bypass Node.js TLS fingerprinting blocked by Cloudflare
      const headers = {
        "User-Agent": USER_AGENT,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Referer": "https://comix.to/",
        ...(opts.headers || {}),
      };

      const headerFlags = Object.entries(headers)
        .map(([k, v]) => `-H ${JSON.stringify(`${k}: ${v}`)}`)
        .join(" ");

      const cmd = `curl -sL -w "\n%{http_code}" ${headerFlags} ${JSON.stringify(url)}`;
      const output = execSync(cmd, { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 });

      const lines = output.trim().split("\n");
      const statusCode = parseInt(lines.pop(), 10);
      const body = lines.join("\n");

      let parsedBody = body;
      if (opts.responseType === "json") {
        try {
          parsedBody = JSON.parse(body);
        } catch (e) {
          parsedBody = null;
        }
      }

      return {
        ok: statusCode >= 200 && statusCode < 300,
        status: statusCode,
        body: parsedBody,
      };
    } catch (err) {
      return {
        ok: false,
        status: 500,
        body: err.message,
      };
    }
  },

  parseHtml(htmlString) {
    const dom = new JSDOM(htmlString);
    const doc = dom.window.document;

    function wrap(el) {
      if (!el) return null;
      return {
        text: () => el.textContent || "",
        attr: (name) => el.getAttribute(name) || "",
        querySelector: (sel) => wrap(el.querySelector(sel)),
        querySelectorAll: (sel) => Array.from(el.querySelectorAll(sel)).map(wrap),
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

async function runPluginTests(pluginFile) {
  console.log(`\n========================================`);
  console.log(`🚀 TESTING PLUGIN: ${pluginFile}`);
  console.log(`========================================`);

  if (!fs.existsSync(pluginFile)) {
    console.error(`❌ File not found: ${pluginFile}`);
    return;
  }

  const plugin = loadPlugin(pluginFile);
  console.log(`Loaded plugin ID: "${plugin.id}" | Name: "${plugin.name}"`);

  // 1. Tags
  try {
    console.log("\n--- 1. Testing tags() ---");
    if (typeof plugin.tags === "function") {
      const tags = await plugin.tags();
      console.log(`✅ Fetched ${tags?.length || 0} tags.`);
      if (tags?.length > 0) console.log("Sample:", tags.slice(0, 3));
    } else {
      console.log("ℹ️ Optional tags() method not implemented.");
    }
  } catch (err) {
    console.error("❌ Error in tags():", err.message);
  }

  // 2. Popular
  let popularItem = null;
  try {
    console.log("\n--- 2. Testing popular(0) ---");
    const popular = await plugin.popular(0);
    console.log(`✅ Fetched ${popular?.length || 0} titles.`);
    if (popular?.length > 0) {
      console.log("Sample:", popular.slice(0, 2));
      popularItem = popular[0];
    }
  } catch (err) {
    console.error("❌ Error in popular():", err.message);
  }

  // 3. Search
  try {
    console.log("\n--- 3. Testing search('jujutsu', 0) ---");
    const searchResults = await plugin.search("jujutsu", 0);
    console.log(`✅ Fetched ${searchResults?.length || 0} search results.`);
    if (searchResults?.length > 0) {
      console.log("Sample:", searchResults.slice(0, 2));
    }
  } catch (err) {
    console.error("❌ Error in search():", err.message);
  }

  // 4. Detail
  const testId = popularItem?.id;
  if (!testId) {
    console.log("⚠️ Skipping detail/chapters/pages tests (no title ID retrieved from popular).");
    return;
  }

  try {
    console.log(`\n--- 4. Testing detail('${testId}') ---`);
    const detail = await plugin.detail(testId);
    console.log("✅ Detail Result:", detail);
  } catch (err) {
    console.error("❌ Error in detail():", err.message);
  }

  // 5. Chapters
  let chapterItem = null;
  try {
    console.log(`\n--- 5. Testing chapters('${testId}') ---`);
    const chapters = await plugin.chapters(testId);
    console.log(`✅ Fetched ${chapters?.length || 0} chapters.`);
    if (chapters?.length > 0) {
      console.log("First chapter:", chapters[0]);
      console.log("Last chapter:", chapters[chapters.length - 1]);
      chapterItem = chapters[0];
    }
  } catch (err) {
    console.error("❌ Error in chapters():", err.message);
  }

  // 6. Page URLs
  if (chapterItem?.id) {
    try {
      console.log(`\n--- 6. Testing pageUrls('${chapterItem.id}') ---`);
      const pages = await plugin.pageUrls(chapterItem.id);
      console.log(`✅ Fetched ${pages?.length || 0} page URLs.`);
      if (pages?.length > 0) {
        console.log("Sample pages:", pages.slice(0, 3));
      } else {
        console.warn("⚠️ Warning: 0 page URLs returned!");
      }
    } catch (err) {
      console.error("❌ Error in pageUrls():", err.message);
    }
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
  } else {
    console.log("Usage: node test.js [plugin_name]");
  }
})();