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

// Optimized HTTP fetcher
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

// Fast JSON-LD extractor without DOM overhead
function extractJsonLd(html, expectedType) {
  if (!html) return null;
  const regex = /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = regex.exec(html)) !== null) {
    try {
      const data = JSON.parse(match[1]);
      if (data && data["@type"] === expectedType) {
        return data;
      }
    } catch (e) {}
  }
  return null;
}

function parseCardElement(el) {
  if (!el) return null;

  let href = el.attr("href");
  let anchor = el;
  if (!href || !href.includes("/comic/")) {
    anchor = el.querySelector("a[href*='/comic/']") || el.querySelector("a[data-smartlink]") || el.querySelector("a");
    href = anchor ? anchor.attr("href") : "";
  }
  if (!href) return null;

  const cleanPath = href.replace(/^https?:\/\/[^\/]+/, "").replace(/^\/+|\/+$/g, "");
  const segments = cleanPath.split("/");

  // Only match series links (/comic/Slug), ignore issue reader links (/comic/Slug/1)
  if (segments.length !== 2 || segments[0] !== "comic") {
    return null;
  }

  const slug = segments[1];
  if (!slug || slug.includes("search") || slug.includes("genre") || slug.includes("publisher")) return null;

  const img = el.querySelector("img");
  let cover = img ? img.attr("src") || img.attr("data-src") : undefined;

  // Use fast thumbnail endpoint for browse/popular grids
  if (cover && cover.includes("/covers/")) {
    cover = cover.replace("/covers/", "/covers-sm/");
  } else if (!cover) {
    cover = `https://cdn.readcomicsonline.lol/covers-sm/${slug}/1.webp`;
  }

  const titleEl = el.querySelector("h3") || el.querySelector("h2");
  const title =
    (titleEl ? titleEl.text().trim() : "") ||
    (anchor ? anchor.attr("data-track-label") : "") ||
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

    const doc = await harbor.parseHtml(html);
    const cardNodes = doc.querySelectorAll("a[href*='/comic/']");

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
    } else {
      url = `${BASE}/new-comics`;
    }

    const html = await requestHtml(url);
    if (!html) return [];

    const doc = await harbor.parseHtml(html);
    const cardNodes = doc.querySelectorAll("a[href*='/comic/']");

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

    const doc = await harbor.parseHtml(html);
    const jsonLd = extractJsonLd(html, "ComicSeries");

    let title = jsonLd?.name;
    // Prefer full high-res cover for the detail screen
    let cover = jsonLd?.image || `https://cdn.readcomicsonline.lol/covers/${slug}/1.webp`;
    let description = jsonLd?.description;
    let author = "";

    const rawAuthor = jsonLd?.author || jsonLd?.creator || jsonLd?.illustrator;
    if (rawAuthor) {
      if (Array.isArray(rawAuthor)) {
        author = rawAuthor.map((a) => (typeof a === "object" ? a.name : a)).filter(Boolean).join(", ");
      } else if (typeof rawAuthor === "object") {
        author = rawAuthor.name;
      } else {
        author = String(rawAuthor);
      }
    }

    if (!title) {
      const titleEl = doc.querySelector("h1.font-serif") || doc.querySelector("h1");
      title = titleEl ? titleEl.text().trim() : slug;
    }

    if (!description) {
      const descEl = doc.querySelector("p.font-sf-compact") || doc.querySelector("p");
      description = descEl ? descEl.text().trim() : undefined;
    }

    let status = "ongoing";
    const bodyText = (doc.text ? doc.text() : html).toLowerCase();
    if (bodyText.includes("completed")) {
      status = "completed";
    }

    return {
      id: slug,
      title: title ? title.trim() : slug,
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

    const doc = await harbor.parseHtml(html);
    const links = doc.querySelectorAll("a[href*='/comic/']");

    const parsedChapters = [];
    const seenIds = new Set();

    for (const a of links) {
      const href = a.attr("href") || "";
      const cleanPath = href.replace(/^https?:\/\/[^\/]+/, "").replace(/^\/+|\/+$/g, "");
      const segments = cleanPath.split("/");

      if (segments.length === 3 && segments[0] === "comic" && segments[1].toLowerCase() === slug.toLowerCase()) {
        const issueId = segments[2];
        const fullId = `${slug}/${issueId}`;

        if (seenIds.has(fullId)) continue;
        seenIds.add(fullId);

        const numMatch = issueId.match(/(\d+(?:\.\d+)?)/);
        const numStr = numMatch ? numMatch[1] : issueId;

        const textContent = a.text().trim();
        const dateMatch = textContent.match(/\d{4}-\d{2}-\d{2}/);
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

    // 1. Fast regex extraction of total pages (avoids slow DOM queries)
    let totalPages = null;
    const jsonLd = extractJsonLd(html, "ComicIssue");
    if (jsonLd && jsonLd.numberOfPages) {
      totalPages = parseInt(jsonLd.numberOfPages, 10);
    }

    if (!totalPages) {
      const maxMatch =
        html.match(/aria-valuemax="(\d+)"/) ||
        html.match(/Page\s+\d+\s*\/\s*(\d+)/i) ||
        html.match(/"numberOfPages"\s*:\s*(\d+)/);
      if (maxMatch) {
        totalPages = parseInt(maxMatch[1], 10);
      }
    }

    // 2. Fast regex pattern match for the WebP page CDN path
    const imgMatch = html.match(/src="([^"]+\/pages\/[^\/]+\/[^\/]+\/(p?)(\d+)(\.[a-zA-Z0-9]+))"/);

    if (imgMatch && totalPages && totalPages > 0) {
      const fullUrl = imgMatch[1];
      const pChar = imgMatch[2] || "p";
      const padLength = imgMatch[3].length;
      const ext = imgMatch[4] || ".webp";
      const prefixUrl = fullUrl.substring(0, fullUrl.lastIndexOf("/") + 1);

      const pages = new Array(totalPages);
      for (let i = 1; i <= totalPages; i++) {
        const paddedIndex = String(i).padStart(padLength, "0");
        pages[i - 1] = `${prefixUrl}${pChar}${paddedIndex}${ext}`;
      }
      return pages;
    }

    // Fallback: DOM query if regex pattern didn't match
    const doc = await harbor.parseHtml(html);
    const allImages = doc.querySelectorAll("img[src*='/pages/']");
    return Array.from(allImages)
      .map((img) => abs(img.attr("src")))
      .filter(Boolean);
  },

  async tags() {
    return [
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
  }
};

harbor.register(plugin);