const BASE = "https://asurascans.com";
const API_BASE = "https://api.asurascans.com/api";
const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const URL_RANDOM_PART = /-[a-z0-9]{8}$/;

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

// Directly extracts Astro props from raw HTML body using Regex
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
      // Continue to next match if JSON parsing fails
    }
  }

  return null;
}

const plugin = {
  id: "asurascans",
  name: "Asura Scans",

  async popular(offset, tagId) {
    return this.search("", offset, tagId);
  },

  async search(query, offset, tagId) {
    const page = Math.floor(offset / 20) + 1;

    // 1. Try API First
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
      if (tagId) {
        params.set("genres", tagId);
      }

      const res = await harbor.http(`${API_BASE}/series?${params.toString()}`, {
        responseType: "json",
        headers: { "User-Agent": USER_AGENT }
      });

      if (res && res.ok && res.body && Array.isArray(res.body.data)) {
        const items = res.body.data
          .map((item) => {
            const slug = item.slug || (item.public_url ? item.public_url.split("/").pop() : "");
            return {
              id: slug,
              title: item.title || "Unknown",
              cover: abs(item.cover || item.coverUrl)
            };
          })
          .filter((i) => i.id && i.title);

        if (items.length > 0) return items;
      }
    } catch (e) {
      // Fall through to HTML scraping if API request fails
    }

    // 2. Web Scraping Fallback
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
          extractAstroPropsFromHtml(res.body, "series") ||
          extractAstroPropsFromHtml(res.body, "manga");
        const seriesList = props?.series || props?.mangaList || props?.manga || [];

        if (Array.isArray(seriesList) && seriesList.length > 0) {
          return seriesList
            .map((item) => {
              const slug = item.slug || (item.public_url ? item.public_url.split("/").pop() : "");
              return {
                id: slug,
                title: item.title || "Unknown",
                cover: abs(item.cover || item.coverUrl)
              };
            })
            .filter((i) => i.id && i.title);
        }

        // HTML DOM selector fallback
        const doc = harbor.parseHtml(res.body);
        const links = doc.querySelectorAll('a[href*="/comics/"]');
        const results = [];
        const seen = new Set();

        for (const a of links) {
          const href = a.attr("href") || "";
          const slug = href.split("/comics/")[1]?.split("/")[0]?.replace(URL_RANDOM_PART, "");
          if (!slug || seen.has(slug)) continue;
          seen.add(slug);

          const img = a.querySelector("img");
          const titleEl = a.querySelector("span") || a.querySelector("h3") || a;
          const title = titleEl.text().trim();

          if (title && slug) {
            results.push({
              id: slug,
              title,
              cover: abs(img?.attr("src") || img?.attr("data-src"))
            });
          }
        }
        return results;
      }
    } catch (e) {
      // Suppress unhandled exceptions
    }

    return [];
  },

  async detail(id) {
    try {
      const res = await harbor.http(`${BASE}/comics/${id}`, {
        responseType: "text",
        headers: { "User-Agent": USER_AGENT }
      });

      if (!res || !res.ok || !res.body) return null;

      const props =
        extractAstroPropsFromHtml(res.body, "title", "description") ||
        extractAstroPropsFromHtml(res.body, "title");

      if (!props) {
        const doc = harbor.parseHtml(res.body);
        const h1 = doc.querySelector("h1");
        return { id, title: h1 ? h1.text() : id };
      }

      let status = "unknown";
      if (props.status) {
        const s = String(props.status).toLowerCase();
        if (s.includes("ongoing")) status = "ongoing";
        else if (s.includes("completed")) status = "completed";
        else if (s.includes("hiatus")) status = "on_hiatus";
        else if (s.includes("dropped") || s.includes("axed")) status = "cancelled";
      }

      let description = props.description || "";
      description = description.replace(/<[^>]*>/g, "").trim();

      if (props.popularityRank) description += `\n\nRank: #${props.popularityRank}`;
      if (props.rating) description += `\n\nRating: ${Number(props.rating).toFixed(2)}`;

      const authors = [props.author, props.artist].filter(Boolean).join(", ");

      return {
        id,
        title: decodeHtmlEntities(props.title || id),
        cover: abs(props.coverUrl || props.cover),
        description: description.trim() || undefined,
        status,
        author: authors || undefined
      };
    } catch (e) {
      return null;
    }
  },

  async chapters(id) {
    try {
      const res = await harbor.http(`${BASE}/comics/${id}`, {
        responseType: "text",
        headers: { "User-Agent": USER_AGENT }
      });

      if (!res || !res.ok || !res.body) return [];

      const props = extractAstroPropsFromHtml(res.body, "chapters");
      const chapterList = props?.chapters || [];

      const chapters = chapterList
        .filter((ch) => !ch.is_locked)
        .map((ch) => {
          const numStr = ch.number !== undefined ? String(ch.number).replace(/\.0$/, "") : "0";
          const seriesSlug = ch.series_slug || id;
          const chTitle = ch.title ? `Chapter ${numStr} - ${ch.title}` : `Chapter ${numStr}`;

          return {
            id: `${seriesSlug}/chapter/${numStr}`,
            chapter: numStr,
            title: chTitle,
            pages: 0,
            language: "en",
            publishAt: ch.created_at || undefined
          };
        });

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

      return pages.map((p) => abs(p.url)).filter(Boolean);
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
        name: g.name,
        group: "Genre"
      }));
    } catch (e) {
      return [];
    }
  }
};