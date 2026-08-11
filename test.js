const fs = require("fs");
const fetch = require("node-fetch");
const { JSDOM } = require("jsdom");

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

global.harbor = {
  async http(url, opts = {}) {
    const headers = {
      "User-Agent": USER_AGENT,
      ...(opts.headers || {}),
    };

    const res = await fetch(url, { ...opts, headers });
    const body = await res.text();

    return {
      ok: res.ok,
      status: res.status,
      body: opts.responseType === "json" ? JSON.parse(body) : body,
    };
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

let code = fs.readFileSync("./weebcentral.plugin.js", "utf8");
code = code.replace(/const\s+plugin\s*=/, "global.plugin =");
eval(code);

(async () => {
  console.log("\n=== 1. TESTING TAGS ===");
  const tags = await plugin.tags();
  console.log(`Fetched ${tags.length} tags:`);
  console.dir(tags.slice(0, 10), { depth: null });

  console.log("\n=== 2. TESTING POPULAR ===");
  const popular = await plugin.popular(0);
  console.log(`Fetched ${popular.length} manga:`);
  console.log(popular.slice(0, 3));

  if (popular.length > 0) {
    const testId = popular[0].id;

    console.log(`\n=== 3. TESTING DETAIL (${testId}) ===`);
    const detail = await plugin.detail(testId);
    console.log(detail);

    console.log(`\n=== 4. TESTING CHAPTERS (${testId}) ===`);
    const chapters = await plugin.chapters(testId);
    console.log(`Fetched ${chapters.length} chapters. First & Last:`);
    console.log([chapters[0], chapters[chapters.length - 1]]);

    if (chapters.length > 0) {
      const chapterId = chapters[0].id;
      console.log(`\n=== 5. TESTING PAGE URLS (${chapterId}) ===`);
      const pages = await plugin.pageUrls(chapterId);
      console.log(`Fetched ${pages.length} pages. Sample:`, pages.slice(0, 3));
    }
  }
})().catch(console.error);