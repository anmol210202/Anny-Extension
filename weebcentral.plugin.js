const BASE = "https://weebcentral.com";

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
};

function abs(url) {
  if (!url) return undefined;
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith("//")) return "https:" + url;
  return BASE + (url.startsWith("/") ? "" : "/") + url;
}

async function getDoc(path) {
  const res = await harbor.http(BASE + path, {
    headers: HEADERS,
    responseType: "text",
  });
  if (!res.ok) throw new Error("HTTP " + res.status + " for " + path);
  return harbor.parseHtml(res.body);
}

function extractSeriesId(href) {
  if (!href) return "";
  const match = href.match(/\/series\/([A-Z0-9]+)/i);
  return match ? match[1] : "";
}

function parseSeriesList(doc) {
  const seen = new Set();
  const list = [];

  const articles = doc.querySelectorAll("article");
  for (const article of articles) {
    const link = article.querySelector('a[href*="/series/"]');
    if (!link) continue;

    const href = link.attr("href") || "";
    const id = extractSeriesId(href);
    if (!id || seen.has(id)) continue;

    const img = article.querySelector("img");
    const rawAlt = img?.attr("alt") || "";
    const title = (
      rawAlt.replace(/\s*cover$/i, "").trim() ||
      article.querySelector(".truncate")?.text()?.trim() ||
      article.querySelector(".font-semibold")?.text()?.trim() ||
      link.text()?.trim() ||
      id
    );

    let coverUrl = img?.attr("src") || img?.attr("data-src");
    if (!coverUrl || coverUrl.includes("/static/")) {
      const source = article.querySelector("source");
      if (source) {
        coverUrl = source.attr("srcset")?.split(" ")[0];
      }
    }

    seen.add(id);
    list.push({
      id,
      title,
      cover: abs(coverUrl),
    });
  }

  if (list.length === 0) {
    const links = doc.querySelectorAll('a[href*="/series/"]');
    for (const a of links) {
      const href = a.attr("href") || "";
      const id = extractSeriesId(href);
      if (!id || seen.has(id)) continue;

      const img = a.querySelector("img");
      const title = (
        img?.attr("alt")?.replace(/\s*cover$/i, "")?.trim() ||
        a.text()?.trim() ||
        id
      );
      const coverUrl = img?.attr("src") || img?.attr("data-src");

      seen.add(id);
      list.push({
        id,
        title,
        cover: abs(coverUrl),
      });
    }
  }

  return list;
}

const plugin = {
  id: "weebcentral",
  name: "Weeb Central",

  async popular(offset, tagId) {
    const tagQuery = tagId ? `&included_tag=${encodeURIComponent(tagId)}` : "";
    const url = `/search/data?limit=32&offset=${offset}&sort=Popularity&order=Descending&display_mode=Full+Display${tagQuery}`;
    const doc = await getDoc(url);
    return parseSeriesList(doc);
  },

  async search(query, offset, tagId) {
    const tagQuery = tagId ? `&included_tag=${encodeURIComponent(tagId)}` : "";
    const url = `/search/data?limit=32&offset=${offset}&text=${encodeURIComponent(query)}&sort=Best+Match&order=Ascending&display_mode=Full+Display${tagQuery}`;
    const doc = await getDoc(url);
    return parseSeriesList(doc);
  },

  async detail(id) {
    const cleanId = extractSeriesId(id) || id;
    const doc = await getDoc("/series/" + cleanId);

    const title = doc.querySelector("h1")?.text()?.trim() || cleanId;
    const imgEl = doc.querySelector("picture img") || doc.querySelector("img[alt*='cover']");
    const cover = abs(imgEl?.attr("src") || imgEl?.attr("data-src"));
    const description = doc.querySelector(".description, #synopsis, article p, ul li p")?.text()?.trim();

    const isOngoing = Boolean(doc.querySelector("img[src*='icon-ongoing']"));
    const isCompleted = Boolean(doc.querySelector("img[src*='icon-completed']"));
    let status = "Unknown";
    if (isOngoing) status = "Ongoing";
    if (isCompleted) status = "Completed";

    const author = doc.querySelector("a[href*='author']")?.text()?.trim();

    return {
      id: cleanId,
      title,
      cover,
      description,
      status,
      author,
    };
  },

  async chapters(id) {
    const cleanId = extractSeriesId(id) || id;
    let doc;
    try {
      doc = await getDoc("/series/" + cleanId + "/full-chapter-list");
    } catch (e) {
      doc = await getDoc("/series/" + cleanId);
    }

    const chaptersList = doc
      .querySelectorAll('a[href*="/chapters/"]')
      .map((a) => {
        const href = a.attr("href") || "";
        const matchId = href.match(/\/chapters\/([A-Z0-9]+)/i);
        const chapterId = matchId ? matchId[1] : href.replace(/^\/chapters\//, "");

        const spans = a.querySelectorAll("span");
        let rawText = "";
        if (spans && spans.length > 0) {
          rawText = spans.map((s) => s.text()).join(" ");
        }
        if (!rawText.trim()) {
          rawText = a.text() || "";
        }

        const cleanTitle = rawText.split(/Last Read/i)[0].trim();
        const numMatch =
          cleanTitle.match(/(?:Chapter|Episode|Beat|Vol\.\d+|Ch\.)\s*([\d.]+)/i) ||
          cleanTitle.match(/([\d.]+)/);

        return {
          id: chapterId,
          chapter: numMatch ? numMatch[1] : null,
          title: cleanTitle || `Chapter ${numMatch ? numMatch[1] : ""}`,
          language: "en",
          publishAt: a.querySelector("time")?.attr("datetime") || undefined,
        };
      })
      .filter((c) => c.id);

    if (chaptersList.length > 1) {
      const firstNum = parseFloat(chaptersList[0].chapter || 0);
      const lastNum = parseFloat(chaptersList[chaptersList.length - 1].chapter || 0);
      if (firstNum < lastNum) {
        chaptersList.reverse();
      }
    }

    return chaptersList;
  },

  async pageUrls(chapterId) {
    const cleanChapterId = chapterId.match(/([A-Z0-9]+)$/i)?.[1] || chapterId;
    let doc;
    try {
      doc = await getDoc("/chapters/" + cleanChapterId + "/images?reading_style=long_strip");
    } catch (e) {
      doc = await getDoc("/chapters/" + cleanChapterId);
    }

    return doc
      .querySelectorAll("img")
      .map((img) => abs(img.attr("data-src") || img.attr("src")))
      .filter(
        (src) =>
          src &&
          !src.includes("/static/images/") &&
          !src.includes("brand") &&
          !src.includes("icon-")
      );
  },

  async tags() {
    let doc;
    try {
      doc = await getDoc("/search");
    } catch (e) {
      return [];
    }

    const tags = [];
    const seen = new Set();

    const inputs = doc.querySelectorAll('input[id^="tag-"][id$="-value"]');
    for (const input of inputs) {
      const val = input.attr("value")?.trim();
      if (val && !seen.has(val)) {
        seen.add(val);
        tags.push({ id: val, name: val, group: "Genre" });
      }
    }

    if (tags.length === 0) {
      const res = await harbor.http(BASE + "/search", {
        headers: HEADERS,
        responseType: "text",
      });
      if (res.ok) {
        const html = res.body || "";
        const regex = /id=["']tag-([^"']+)-value["'][^>]*value=["']([^"']+)["']/gi;
        let match;
        while ((match = regex.exec(html)) !== null) {
          const val = match[2].trim();
          if (val && !seen.has(val)) {
            seen.add(val);
            tags.push({ id: val, name: val, group: "Genre" });
          }
        }
      }
    }

    return tags;
  },
};