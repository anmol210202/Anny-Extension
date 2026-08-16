const BASE = "https://readcomicsonline.lol";
const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

function abs(url) {
  if (!url) return undefined;
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith("//")) return "https:" + url;
  if (url.startsWith("/")) return BASE + url;
  return BASE + "/" + url;
}

function cleanSlug(urlOrPath) {
  if (!urlOrPath) return "";
  let p = String(urlOrPath)
    .replace(/^https?:\/\/[^\/]+/, "")
    .replace(/^\/?comic\//, "");
  return p.replace(/^\/+|\/+$/g, "");
}

async function requestHtml(url) {
  try {
    const res = await harbor.http(url, {
      responseType: "text",
      headers: {
        "User-Agent": USER_AGENT,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
      }
    });
    if (!res || !res.ok || !res.body) return null;
    return res.body;
  } catch (e) {
    return null;
  }
}

function parseJsonLd(doc, expectedType) {
  const scripts = doc.querySelectorAll('script[type="application/ld+json"]');
  for (const script of scripts) {
    try {
      const text = script.text();
      if (!text) continue;
      const data = JSON.parse(text);
      if (data["@type"] === expectedType) {
        return data;
      }
    } catch (e) {}
  }
  return null;
}

function parseCardElement(element) {
  if (!element) return null;

  const anchor =
    element.querySelector("a[href*='/comic/']") ||
    element.querySelector("a[data-smartlink]") ||
    element.querySelector("a");

  if (!anchor) return null;

  const href = anchor.attr("href") || "";
  const cleanPath = href.replace(/^https?:\/\/[^\/]+/, "").replace(/^\/+|\/+$/g, "");
  const segments = cleanPath.split("/");

  // Only match series links (/comic/Slug), not issue links (/comic/Slug/Issue)
  if (segments.length !== 2 || segments[0] !== "comic") {
    return null;
  }

  const slug = segments[1];
  if (!slug || slug.includes("search") || slug.includes("genre")) return null;

  const img = element.querySelector("img");
  const cover = img ? img.attr("src") || img.attr("data-src") : undefined;

  const titleEl = element.querySelector("h3") || element.querySelector("h2");
  const title =
    (titleEl ? titleEl.text().trim() : "") ||
    anchor.attr("data-track-label") ||
    (img ? img.attr("alt") : "") ||
    slug;

  return {
    id: slug,
    title: title.replace(/comic cover$/i, "").trim(),
    cover: abs(cover)
  };
}

const plugin = {
  id: "readcomicsonlinelol",
  name: "ReadComicsOnline (.lol)",

  async popular(offset, tagId) {
    let url = `${BASE}/`;

    if (tagId) {
      if (["marvel", "dc", "image"].includes(tagId)) {
        url = `${BASE}/publisher/${encodeURIComponent(tagId)}`;
      } else {
        url = `${BASE}/genre/${encodeURIComponent(tagId)}`;
      }
    }

    const html = await requestHtml(url);
    if (!html) return [];

    const doc = harbor.parseHtml(html);
    const cardNodes = [
      ...doc.querySelectorAll("div.grid a"),
      ...doc.querySelectorAll("div.contents a"),
      ...doc.querySelectorAll("div.overflow-x-auto a")
    ];

    const seenIds = new Set();
    const items = [];

    for (const el of cardNodes) {
      const card = parseCardElement(el);
      if (card && card.id && !seenIds.has(card.id)) {
        seenIds.add(card.id);
        items.push(card);
      }
    }

    return items;
  },

  async search(query, offset, tagId) {
    const cleanQuery = (query || "").trim();
    let url = `${BASE}/`;

    if (cleanQuery) {
      url = `${BASE}/search?q=${encodeURIComponent(cleanQuery)}`;
    } else if (tagId) {
      if (["marvel", "dc", "image"].includes(tagId)) {
        url = `${BASE}/publisher/${encodeURIComponent(tagId)}`;
      } else {
        url = `${BASE}/genre/${encodeURIComponent(tagId)}`;
      }
    }

    const html = await requestHtml(url);
    if (!html) return [];

    const doc = harbor.parseHtml(html);
    const cardNodes = [
      ...doc.querySelectorAll("div.grid a"),
      ...doc.querySelectorAll("div.contents a"),
      ...doc.querySelectorAll("div.overflow-x-auto a")
    ];

    const seenIds = new Set();
    const items = [];

    for (const el of cardNodes) {
      const card = parseCardElement(el);
      if (card && card.id && !seenIds.has(card.id)) {
        seenIds.add(card.id);
        items.push(card);
      }
    }

    return items;
  },

  async detail(id) {
    const slug = cleanSlug(id);
    const html = await requestHtml(`${BASE}/comic/${slug}`);
    if (!html) return null;

    const doc = harbor.parseHtml(html);
    const jsonLd = parseJsonLd(doc, "ComicSeries");

    let title = jsonLd?.name;
    let cover = jsonLd?.image;
    let description = jsonLd?.description;
    let author = "";

    if (jsonLd?.author) {
      author = typeof jsonLd.author === "object" ? jsonLd.author.name : jsonLd.author;
    }

    // Fallbacks from DOM
    if (!title) {
      const titleEl = doc.querySelector("h1.font-serif") || doc.querySelector("h1");
      title = titleEl ? titleEl.text().trim() : slug;
    }

    if (!cover) {
      const imgEl = doc.querySelector("img[alt*='comic cover']") || doc.querySelector("img");
      cover = imgEl ? imgEl.attr("src") : undefined;
    }

    if (!description) {
      const descEl = doc.querySelector("p.font-sf-compact") || doc.querySelector("main p");
      description = descEl ? descEl.text().trim() : undefined;
    }

    let status = "ongoing";
    const bodyText = (doc.text ? doc.text() : html).toLowerCase();
    if (bodyText.includes("completed")) {
      status = "completed";
    }

    return {
      id: slug,
      title: title.trim(),
      cover: abs(cover),
      description: description ? description.trim() : undefined,
      status,
      author: author ? String(author).trim() : undefined
    };
  },

  async chapters(id) {
    const slug = cleanSlug(id);
    const html = await requestHtml(`${BASE}/comic/${slug}`);
    if (!html) return [];

    const doc = harbor.parseHtml(html);
    const links = doc.querySelectorAll("a[href*='/comic/']");

    const parsedChapters = [];
    const seenIds = new Set();

    for (const a of links) {
      const href = a.attr("href") || "";
      const cleanPath = href.replace(/^https?:\/\/[^\/]+/, "").replace(/^\/+|\/+$/g, "");
      const segments = cleanPath.split("/");

      // Match issue link: comic / SeriesSlug / IssueNumber
      if (segments.length === 3 && segments[0] === "comic" && segments[1].toLowerCase() === slug.toLowerCase()) {
        const issueId = segments[2];
        const fullId = `${slug}/${issueId}`;

        if (seenIds.has(fullId)) continue;
        seenIds.add(fullId);

        const titleText = a.text().trim();
        const numMatch = (titleText || issueId).match(/#?(\d+(?:\.\d+)?)/);
        const numStr = numMatch ? numMatch[1] : issueId;

        // Try extracting release date (format: YYYY-MM-DD)
        const dateMatch = a.text().match(/\d{4}-\d{2}-\d{2}/);
        const publishAt = dateMatch ? new Date(dateMatch[0]).toISOString() : undefined;

        parsedChapters.push({
          id: fullId,
          chapter: numStr,
          title: `Issue #${numStr}`,
          pages: 0,
          language: "en",
          publishAt,
          _num: parseFloat(numStr) || 0
        });
      }
    }

    // Deduplicate by chapter number
    const chapterMap = new Map();
    for (const ch of parsedChapters) {
      if (!chapterMap.has(ch._num)) {
        chapterMap.set(ch._num, ch);
      }
    }

    const deduplicated = Array.from(chapterMap.values());
    deduplicated.sort((a, b) => a._num - b._num);

    return deduplicated.map(({ _num, ...rest }) => rest);
  },

  async pageUrls(chapterId) {
    const cleanPath = cleanSlug(chapterId);
    const html = await requestHtml(`${BASE}/comic/${cleanPath}`);
    if (!html) return [];

    const doc = harbor.parseHtml(html);
    const jsonLd = parseJsonLd(doc, "ComicIssue");

    let totalPages = jsonLd?.numberOfPages;

    // Fallback: extract total pages from page indicator text (e.g., "1 / 27")
    if (!totalPages) {
      const pageTextMatch = html.match(/\b\d+\s*\/\s*(\d+)\b/);
      if (pageTextMatch) {
        totalPages = parseInt(pageTextMatch[1], 10);
      }
    }

    // Find the first page URL
    const imgEl = doc.querySelector("img[src*='/pages/']");
    const firstImgSrc = imgEl ? imgEl.attr("src") : undefined;

    if (firstImgSrc && totalPages && totalPages > 0) {
      // Matches pattern: .../pages/Series/Issue/p001.webp or 001.webp
      const patternMatch = firstImgSrc.match(/^(https?:\/\/.*\/pages\/[^\/]+\/[^\/]+\/)(p?)(\d+)(\.[a-zA-Z0-9]+)/);
      if (patternMatch) {
        const prefixUrl = patternMatch[1];
        const pChar = patternMatch[2] || "p";
        const ext = patternMatch[4] || ".webp";

        const pages = [];
        for (let i = 1; i <= totalPages; i++) {
          const paddedIndex = String(i).padStart(3, "0");
          pages.push(`${prefixUrl}${pChar}${paddedIndex}${ext}`);
        }
        return pages;
      }
    }

    // Fallback: return any reader images found directly in the DOM
    const allImages = doc.querySelectorAll("img[src*='/pages/']");
    return Array.from(allImages)
      .map((img) => abs(img.attr("src")))
      .filter(Boolean);
  },

  async tags() {
    const tags = [
      { id: "marvel", name: "Marvel", group: "Publisher" },
      { id: "dc", name: "DC Comics", group: "Publisher" },
      { id: "image", name: "Image Comics", group: "Publisher" },
      { id: "action", name: "Action", group: "Genre" },
      { id: "adventure", name: "Adventure", group: "Genre" },
      { id: "comedy", name: "Comedy", group: "Genre" },
      { id: "crime", name: "Crime", group: "Genre" },
      { id: "drama", name: "Drama", group: "Genre" },
      { id: "fantasy", name: "Fantasy", group: "Genre" },
      { id: "graphic-novels", name: "Graphic Novels", group: "Genre" },
      { id: "historical", name: "Historical", group: "Genre" },
      { id: "horror", name: "Horror", group: "Genre" },
      { id: "mature", name: "Mature", group: "Genre" },
      { id: "mystery", name: "Mystery", group: "Genre" },
      { id: "sci-fi", name: "Sci-Fi", group: "Genre" },
      { id: "superhero", name: "Superhero", group: "Genre" }
    ];
    return tags;
  }
};