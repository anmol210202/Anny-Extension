const BASE = "https://comix.to";
const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

function abs(url) {
  if (!url) return undefined;
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith("//")) return "https:" + url;
  if (url.startsWith("/")) return BASE + url;
  return BASE + "/" + url;
}

function cleanPath(urlOrPath) {
  if (!urlOrPath) return "";
  let p = String(urlOrPath).replace(/^https?:\/\/[^\/]+/, "");
  p = p.replace(/^\/?title\//, "");
  return p.replace(/^\/+|\/+$/g, "");
}

function decodeHtmlEntities(str) {
  if (!str) return "";
  return str
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(parseInt(dec, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

function extractInitialData(html) {
  if (!html) return null;
  const match = html.match(/<script[^>]*id=["']?initial-data["']?[^>]*>([\s\S]*?)<\/script>/i);
  if (!match || !match[1]) return null;

  const content = match[1].trim();
  try {
    return JSON.parse(content);
  } catch (e) {
    try {
      return JSON.parse(decodeHtmlEntities(content));
    } catch (e2) {
      return null;
    }
  }
}

function findMangaList(obj) {
  if (!obj || typeof obj !== "object") return null;

  if (Array.isArray(obj)) {
    if (
      obj.length > 0 &&
      typeof obj[0] === "object" &&
      obj[0] !== null &&
      (obj[0].hid || obj[0].poster || (obj[0].title && (obj[0].url || obj[0].contentRating)))
    ) {
      return obj;
    }
    for (const item of obj) {
      const found = findMangaList(item);
      if (found) return found;
    }
    return null;
  }

  for (const key of Object.keys(obj)) {
    const found = findMangaList(obj[key]);
    if (found) return found;
  }

  return null;
}

function findDetailObject(obj) {
  if (!obj || typeof obj !== "object") return null;

  if (
    !Array.isArray(obj) &&
    obj.hid &&
    (obj.title || obj.synopsis !== undefined || obj.poster)
  ) {
    return obj;
  }

  if (Array.isArray(obj)) {
    for (const item of obj) {
      const found = findDetailObject(item);
      if (found) return found;
    }
    return null;
  }

  for (const key of Object.keys(obj)) {
    const found = findDetailObject(obj[key]);
    if (found) return found;
  }

  return null;
}

function findChapterList(obj) {
  if (!obj || typeof obj !== "object") return null;

  if (Array.isArray(obj)) {
    if (
      obj.length > 0 &&
      typeof obj[0] === "object" &&
      obj[0] !== null &&
      (obj[0].number !== undefined || obj[0].votes !== undefined) &&
      (obj[0].id !== undefined || obj[0].url !== undefined)
    ) {
      return obj;
    }
    for (const item of obj) {
      const found = findChapterList(item);
      if (found) return found;
    }
    return null;
  }

  for (const key of Object.keys(obj)) {
    const found = findChapterList(obj[key]);
    if (found) return found;
  }

  return null;
}

function findPagesObject(obj) {
  if (!obj || typeof obj !== "object") return null;

  if (obj.pages && Array.isArray(obj.pages.items)) {
    return obj.pages;
  }
  if (obj.baseUrl && Array.isArray(obj.items) && obj.items.length > 0) {
    return obj;
  }

  if (Array.isArray(obj)) {
    for (const item of obj) {
      const found = findPagesObject(item);
      if (found) return found;
    }
    return null;
  }

  for (const key of Object.keys(obj)) {
    const found = findPagesObject(obj[key]);
    if (found) return found;
  }

  return null;
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

function parseMangaCard(item) {
  if (!item) return null;
  const rawUrl = item.url || item.hid || "";
  const slug = cleanPath(rawUrl);
  if (!slug) return null;

  let cover = undefined;
  if (item.poster) {
    cover = item.poster.large || item.poster.medium || item.poster.small;
  } else if (typeof item.image === "string") {
    cover = item.image;
  }

  return {
    id: slug,
    title: decodeHtmlEntities(item.title || "Unknown"),
    cover: abs(cover)
  };
}

const plugin = {
  id: "comix-source",
  name: "Comix",

  async popular(offset, tagId) {
    return this.search("", offset, tagId);
  },

  async search(query, offset, tagId) {
    const page = Math.floor(offset / 32) + 1;
    const cleanQuery = (query || "").trim();

    try {
      const browseParams = new URLSearchParams({
        page: page.toString(),
        content_rating: "safe,suggestive,erotica,pornographic"
      });

      if (cleanQuery) {
        browseParams.set("q", cleanQuery);
        browseParams.set("sort", "relevance:desc");
      } else {
        browseParams.set("order[score]", "desc");
      }

      if (tagId) {
        browseParams.append("genres_in[]", tagId);
      }

      const html = await requestHtml(`${BASE}/browse?${browseParams.toString()}`);
      if (html) {
        const initialData = extractInitialData(html);
        const items = findMangaList(initialData);

        if (Array.isArray(items) && items.length > 0) {
          const parsed = items.map(parseMangaCard).filter(Boolean);
          if (parsed.length > 0) return parsed;
        }
      }
    } catch (e) {}

    return [];
  },

  async detail(id) {
    try {
      const slug = cleanPath(id);
      const html = await requestHtml(`${BASE}/title/${slug}`);
      if (!html) return null;

      const initialData = extractInitialData(html);
      const manga = findDetailObject(initialData);

      if (!manga) {
        const doc = harbor.parseHtml(html);
        const h1 = doc.querySelector("h1");
        return { id: slug, title: h1 ? h1.text() : slug };
      }

      let status = "unknown";
      if (manga.status) {
        const s = String(manga.status).toLowerCase();
        if (s === "releasing") status = "ongoing";
        else if (s === "finished") status = "completed";
        else if (s === "on_hiatus") status = "on_hiatus";
        else if (s === "discontinued") status = "cancelled";
      }

      const authorsList = [
        ...(manga.authors || manga.author || []),
        ...(manga.artists || manga.artist || [])
      ];
      const authorStr = authorsList
        .map((a) => (typeof a === "string" ? a : a.title || a.name))
        .filter(Boolean)
        .join(", ");

      const altTitles = manga.altTitles || manga.alt_titles || [];
      const altStr = Array.isArray(altTitles) ? altTitles.join(", ") : undefined;

      let cover = undefined;
      if (manga.poster) {
        cover = manga.poster.large || manga.poster.medium || manga.poster.small;
      } else if (typeof manga.image === "string") {
        cover = manga.image;
      }

      return {
        id: slug,
        title: decodeHtmlEntities(manga.title || slug),
        altTitle: altStr || undefined,
        cover: abs(cover),
        description:
          decodeHtmlEntities((manga.synopsis || "").replace(/<[^>]*>/g, "").trim()) ||
          undefined,
        status,
        author: authorStr || undefined
      };
    } catch (e) {
      return null;
    }
  },

  async chapters(id) {
    try {
      const slug = cleanPath(id);
      const html = await requestHtml(`${BASE}/title/${slug}`);
      if (!html) return [];

      const initialData = extractInitialData(html);
      const rawChapters = findChapterList(initialData) || [];

      if (!Array.isArray(rawChapters)) return [];

      const parsedChapters = rawChapters.map((ch) => {
        const numStr =
          ch.number !== undefined && ch.number !== null
            ? String(ch.number).replace(/\.0$/, "")
            : "0";

        const groupName = ch.group ? ch.group.name : ch.isOfficial ? "Official" : undefined;
        let titleText = ch.name ? `Chapter ${numStr}: ${ch.name}` : `Chapter ${numStr}`;
        if (groupName) titleText += ` [${groupName}]`;

        let chPath = ch.url || "";
        if (chPath.includes("/title/")) {
          chPath = chPath.substring(chPath.indexOf("/title/") + 7);
        } else if (!chPath) {
          chPath = `title/${slug}/${ch.id}-chapter-${numStr}`;
        }
        chPath = cleanPath(chPath);

        return {
          id: chPath || `${slug}/${ch.id}`,
          chapter: numStr,
          title: decodeHtmlEntities(titleText),
          group: groupName,
          pages: 0,
          language: "en",
          _num: typeof ch.number === "number" ? ch.number : parseFloat(numStr) || 0
        };
      });

      parsedChapters.sort((a, b) => a._num - b._num);

      return parsedChapters.map(({ _num, ...rest }) => rest);
    } catch (e) {
      return [];
    }
  },

  async pageUrls(chapterId) {
    try {
      const cleanChPath = cleanPath(chapterId);
      const fullPath = cleanChPath.startsWith("title/") ? cleanChPath : `title/${cleanChPath}`;

      const html = await requestHtml(`${BASE}/${fullPath}`);
      if (!html) return [];

      const initialData = extractInitialData(html);
      const pagesObj = findPagesObject(initialData);

      if (!pagesObj || !Array.isArray(pagesObj.items)) {
        return [];
      }

      const baseUrlStr = (pagesObj.baseUrl || "").replace(/\/$/, "");
      const items = pagesObj.items || [];

      return items
        .map((img, index) => {
          const imgUrl = typeof img === "string" ? img : img.url || "";
          if (!imgUrl) return null;

          const full = imgUrl.startsWith("http")
            ? imgUrl
            : `${baseUrlStr}/${imgUrl.replace(/^\//, "")}`;

          const isV3 = (img && img.s === 1) || full.includes("?v3");
          const isLegacyScramble = !isV3 && (index + 1) % 4 === 0;

          let finalUrl = full;
          if (isV3) {
            finalUrl = full.includes("?v3") ? full : `${full}?v3`;
          } else if (isLegacyScramble) {
            finalUrl = `${full}#scrambled`;
          }

          return abs(finalUrl);
        })
        .filter(Boolean);
    } catch (e) {
      return [];
    }
  },

  async tags() {
    const genres = [
      { id: "6", name: "Action" },
      { id: "87264", name: "Adult" },
      { id: "7", name: "Adventure" },
      { id: "8", name: "Boys Love" },
      { id: "9", name: "Comedy" },
      { id: "10", name: "Crime" },
      { id: "11", name: "Drama" },
      { id: "87265", name: "Ecchi" },
      { id: "12", name: "Fantasy" },
      { id: "13", name: "Girls Love" },
      { id: "40", name: "Harem" },
      { id: "87266", name: "Hentai" },
      { id: "14", name: "Historical" },
      { id: "15", name: "Horror" },
      { id: "16", name: "Isekai" },
      { id: "17", name: "Magical Girls" },
      { id: "87267", name: "Mature" },
      { id: "18", name: "Mecha" },
      { id: "19", name: "Medical" },
      { id: "20", name: "Mystery" },
      { id: "21", name: "Philosophical" },
      { id: "22", name: "Psychological" },
      { id: "23", name: "Romance" },
      { id: "24", name: "Sci-Fi" },
      { id: "25", name: "Slice of Life" },
      { id: "87268", name: "Smut" },
      { id: "26", name: "Sports" },
      { id: "27", name: "Superhero" },
      { id: "28", name: "Thriller" },
      { id: "29", name: "Tragedy" },
      { id: "30", name: "Wuxia" }
    ];
    return genres.map((g) => ({ id: g.id, name: g.name, group: "Genre" }));
  }
};