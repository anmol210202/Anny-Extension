const BASE = "https://asurascans.com";
const API_BASE = "https://api.asurascans.com/api";
const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const URL_RANDOM_PART = /-[a-z0-9]{8}$/i;

function abs(url) {
  if (!url) return undefined;
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith("//")) return "https:" + url;
  if (url.startsWith("/")) return BASE + url;
  return BASE + "/" + url;
}

function decodeHtmlEntities(str) {
  if (!str) return "";
  return str
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(dec))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

function cleanSlug(urlOrPath) {
  if (!urlOrPath) return "";
  const parts = urlOrPath.split("/comics/");
  const raw = parts.length > 1 ? parts[1].split("/")[0] : urlOrPath.split("/").pop();
  return raw.replace(URL_RANDOM_PART, "").trim();
}

function unwrapAstro(data) {
  if (data === null || data === undefined) return null;
  if (Array.isArray(data)) {
    if (data.length <= 1) return null;
    if (
      data.length === 2 &&
      (typeof data[0] === "number" || typeof data[0] === "string" || typeof data[0] === "boolean")
    ) {
      return unwrapAstro(data[1]);
    }
    return data.map(unwrapAstro);
  }
  if (typeof data === "object") {
    const res = {};
    for (const key in data) {
      res[key] = unwrapAstro(data[key]);
    }
    return res;
  }
  return data;
}

function extractAstroPropsFromHtml(html, ...keys) {
  if (!html) return null;
  const regex = /props=(?:"([^"]+)"|'([^']+)')/g;
  let match;

  while ((match = regex.exec(html)) !== null) {
    const rawAttr = match[1] || match[2];
    if (!rawAttr) continue;

    const hasAllKeys = keys.every((k) => rawAttr.includes(k));
    if (!hasAllKeys) continue;

    try {
      const unescaped = decodeHtmlEntities(rawAttr);
      const parsed = JSON.parse(unescaped);
      const unwrapped = unwrapAstro(parsed);
      if (unwrapped) return unwrapped;
    } catch (e) {
      // Continue to next match
    }
  }
  return null;
}

// Recursively walks the Astro props tree to find any array containing manga objects
function findMangaArray(obj) {
  if (!obj) return [];
  if (Array.isArray(obj)) {
    if (obj.length > 0 && typeof obj[0] === "object" && (obj[0].title || obj[0].slug || obj[0].public_url)) {
      return obj;
    }
    for (const item of obj) {
      const found = findMangaArray(item);
      if (found.length > 0) return found;
    }
  } else if (typeof obj === "object") {
    for (const key in obj) {
      const found = findMangaArray(obj[key]);
      if (found.length > 0) return found;
    }
  }
  return [];
}

// Safely extracts title from DOM elements while skipping rating badges (e.g. 8.3, 9.8)
function extractTitleFromCard(aEl) {
  if (!aEl) return "";

  const attrTitle = aEl.attr("title");
  if (attrTitle && attrTitle.trim() && !/^\d+(\.\d+)?$/.test(attrTitle.trim())) {
    return decodeHtmlEntities(attrTitle.trim());
  }

  for (const tag of ["h1", "h2", "h3", "h4"]) {
    const heading = aEl.querySelector(tag);
    if (heading) {
      const txt = heading.text().trim();
      if (txt && !/^\d+(\.\d+)?$/.test(txt)) return decodeHtmlEntities(txt);
    }
  }

  const spans = aEl.querySelectorAll("span, div, p");
  for (const el of spans) {
    const txt = el.text().trim();
    if (
      txt &&
      !/^\d+(\.\d+)?$/.test(txt) &&
      !/^(ongoing|completed|hiatus|axed|dropped|bookmark|rating)$/i.test(txt) &&
      !/^ch(apter)?\s*\d+/i.test(txt)
    ) {
      return decodeHtmlEntities(txt);
    }
  }

  return decodeHtmlEntities(aEl.text().trim());
}

const plugin = {
  id: "asurascans",
  name: "Asura Scans",

  async popular(offset, tagId) {
    return this.search("", offset, tagId);
  },

  async search(query, offset, tagId) {
    const page = Math.floor(offset / 20) + 1;

    // Strategy 1: /browse Page HTML Scraping
    try {
      const browseUrl = `${BASE}/browse?page=${page}${
        query ? "&search=" + encodeURIComponent(query.trim()) : ""
      }${tagId ? "&genres=" + encodeURIComponent(tagId) : ""}`;

      const res = await harbor.http(browseUrl, {
        responseType: "text",
        headers: { "User-Agent": USER_AGENT }
      });

      if (res && res.ok && res.body) {
        const props =
          extractAstroPropsFromHtml(res.body, "title") ||
          extractAstroPropsFromHtml(res.body, "series") ||
          extractAstroPropsFromHtml(res.body, "manga");

        const seriesList = findMangaArray(props);

        if (seriesList.length > 0) {
          const items = seriesList
            .map((item) => {
              const title = decodeHtmlEntities(item.title || "");
              if (!title || /^\d+(\.\d+)?$/.test(title)) return null;

              return {
                id: cleanSlug(item.slug || item.public_url || ""),
                title,
                cover: abs(item.cover || item.coverUrl)
              };
            })
            .filter((i) => i && i.id && i.title);

          if (items.length > 0) return items;
        }

        // DOM Fallback
        const doc = harbor.parseHtml(res.body);
        const links = doc.querySelectorAll('a[href*="/comics/"]');
        const results = [];
        const seen = new Set();

        for (const a of links) {
          const href = a.attr("href") || "";
          const slug = cleanSlug(href);
          if (!slug || seen.has(slug)) continue;

          const title = extractTitleFromCard(a);
          if (!title || /^\d+(\.\d+)?$/.test(title)) continue;

          seen.add(slug);
          const img = a.querySelector("img");

          results.push({
            id: slug,
            title,
            cover: abs(img?.attr("src") || img?.attr("data-src"))
          });
        }

        if (results.length > 0) return results;
      }
    } catch (e) {
      // Fall through to API
    }

    // Strategy 2: API
    try {
      const params = new URLSearchParams({
        offset: offset.toString(),
        limit: "20",
        sort: "popular"
      });
      if (query && query.trim()) {
        params.set("search", query.trim());
        params.delete("sort");
      }
      if (tagId) params.set("genres", tagId);

      const res = await harbor.http(`${API_BASE}/series?${params.toString()}`, {
        responseType: "json",
        headers: { "User-Agent": USER_AGENT }
      });

      if (res && res.ok && res.body && Array.isArray(res.body.data)) {
        return res.body.data
          .map((item) => ({
            id: cleanSlug(item.slug || item.public_url || ""),
            title: decodeHtmlEntities(item.title || "Unknown"),
            cover: abs(item.cover || item.coverUrl)
          }))
          .filter((i) => i.id && i.title && !/^\d+(\.\d+)?$/.test(i.title));
      }
    } catch (e) {
      // Suppress network errors
    }

    return [];
  },

  async detail(id) {
    try {
      const slug = cleanSlug(id);
      const res = await harbor.http(`${BASE}/comics/${slug}`, {
        responseType: "text",
        headers: { "User-Agent": USER_AGENT }
      });

      if (!res || !res.ok || !res.body) return null;

      const props =
        extractAstroPropsFromHtml(res.body, "title", "description") ||
        extractAstroPropsFromHtml(res.body, "title");

      if (props) {
        let status = "unknown";
        if (props.status) {
          const s = String(props.status).toLowerCase();
          if (s.includes("ongoing")) status = "ongoing";
          else if (s.includes("completed")) status = "completed";
          else if (s.includes("hiatus")) status = "on_hiatus";
          else if (s.includes("dropped") || s.includes("axed")) status = "cancelled";
        }

        let description = props.description || "";
        description = decodeHtmlEntities(description.replace(/<[^>]*>/g, "").trim());

        if (props.popularityRank) description += `\n\nRank: #${props.popularityRank}`;
        if (props.rating) description += `\n\nRating: ${Number(props.rating).toFixed(2)}`;

        const authors = [props.author, props.artist].filter(Boolean).join(", ");

        return {
          id: slug,
          title: decodeHtmlEntities(props.title || slug),
          cover: abs(props.coverUrl || props.cover),
          description: description.trim() || undefined,
          status,
          author: authors || undefined
        };
      }

      const doc = harbor.parseHtml(res.body);
      const h1 = doc.querySelector("h1") || doc.querySelector("h2");
      const img = doc.querySelector("img");

      return {
        id: slug,
        title: decodeHtmlEntities(h1 ? h1.text() : slug),
        cover: abs(img?.attr("src") || img?.attr("data-src"))
      };
    } catch (e) {
      return null;
    }
  },

  async chapters(id) {
    try {
      const slug = cleanSlug(id);
      const res = await harbor.http(`${BASE}/comics/${slug}`, {
        responseType: "text",
        headers: { "User-Agent": USER_AGENT }
      });

      if (!res || !res.ok || !res.body) return [];

      const props = extractAstroPropsFromHtml(res.body, "chapters");
      const chapterList = props?.chapters || [];

      if (Array.isArray(chapterList) && chapterList.length > 0) {
        const chapters = chapterList
          .filter((ch) => !ch.is_locked)
          .map((ch) => {
            const numStr = ch.number !== undefined ? String(ch.number).replace(/\.0$/, "") : "0";
            const chTitle = ch.title
              ? `Chapter ${numStr} - ${decodeHtmlEntities(ch.title)}`
              : `Chapter ${numStr}`;

            return {
              id: `${slug}/chapter/${numStr}`,
              chapter: numStr,
              title: chTitle,
              pages: 0,
              language: "en",
              publishAt: ch.created_at || undefined
            };
          });

        return chapters.reverse();
      }

      const doc = harbor.parseHtml(res.body);
      const links = doc.querySelectorAll('a[href*="/chapter/"]');
      const chapters = [];
      const seen = new Set();

      for (const a of links) {
        const href = a.attr("href") || "";
        const match = href.match(/\/chapter\/([\d.]+)/);
        if (!match) continue;

        const numStr = match[1];
        const chapterId = `${slug}/chapter/${numStr}`;
        if (seen.has(chapterId)) continue;
        seen.add(chapterId);

        let titleText = decodeHtmlEntities(a.text().trim());
        if (!titleText.toLowerCase().includes("chapter")) {
          titleText = `Chapter ${numStr}${titleText ? " - " + titleText : ""}`;
        }

        chapters.push({
          id: chapterId,
          chapter: numStr,
          title: titleText,
          pages: 0,
          language: "en"
        });
      }

      return chapters.reverse();
    } catch (e) {
      return [];
    }
  },

  async pageUrls(chapterId) {
    try {
      const cleanPath = chapterId.startsWith("comics/") ? chapterId : `comics/${chapterId}`;
      const res = await harbor.http(`${BASE}/${cleanPath}`, {
        responseType: "text",
        headers: { "User-Agent": USER_AGENT }
      });

      if (!res || !res.ok || !res.body) return [];

      const props = extractAstroPropsFromHtml(res.body, "pages");
      const pages = props?.pages || [];

      if (Array.isArray(pages) && pages.length > 0) {
        return pages.map((p) => abs(p.url)).filter(Boolean);
      }

      const doc = harbor.parseHtml(res.body);
      const imgs = doc.querySelectorAll("img");
      const pageUrlsList = [];

      for (const img of imgs) {
        const src = img.attr("src") || img.attr("data-src") || "";
        if (
          src &&
          (src.includes("/chapters/") || src.includes("asura") || src.includes("storage")) &&
          !src.includes("logo") &&
          !src.includes("favicon") &&
          !src.includes("brand")
        ) {
          const absoluteUrl = abs(src);
          if (absoluteUrl) pageUrlsList.push(absoluteUrl);
        }
      }

      return pageUrlsList;
    } catch (e) {
      return [];
    }
  },

  async tags() {
    try {
      const res = await harbor.http(`${BASE}/browse`, {
        responseType: "text",
        headers: { "User-Agent": USER_AGENT }
      });

      if (!res || !res.ok || !res.body) return [];

      const props = extractAstroPropsFromHtml(res.body, "availableGenres");
      const genres = props?.availableGenres || [];

      return genres.map((g) => ({
        id: g.slug || g.name,
        name: decodeHtmlEntities(g.name),
        group: "Genre"
      }));
    } catch (e) {
      return [];
    }
  }
};