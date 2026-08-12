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
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(parseInt(dec, 10)))
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

function extractAstroPropsFromRawHtml(html, ...requiredKeys) {
  if (!html) return null;
  const propRegex = /props=(?:"([^"]+)"|'([^']+)')/g;
  let match;

  while ((match = propRegex.exec(html)) !== null) {
    const rawAttr = match[1] || match[2];
    if (!rawAttr) continue;

    const hasKeys = requiredKeys.every((k) => rawAttr.includes(k));
    if (!hasKeys) continue;

    try {
      const unescaped = decodeHtmlEntities(rawAttr);
      const parsed = JSON.parse(unescaped);
      const unwrapped = unwrapAstro(parsed);
      if (unwrapped) return unwrapped;
    } catch (e) {}
  }
  return null;
}

async function requestJson(url) {
  try {
    const res = await harbor.http(url, {
      responseType: "text",
      headers: { "User-Agent": USER_AGENT }
    });
    if (!res || !res.ok || !res.body) return null;
    return typeof res.body === "string" ? JSON.parse(res.body) : res.body;
  } catch (e) {
    return null;
  }
}

const plugin = {
  id: "asurascans",
  name: "Asura Scans",

  async popular(offset, tagId) {
    return this.search("", offset, tagId);
  },

  async search(query, offset, tagId) {
    // 1. Asura REST API
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

      const resObj = await requestJson(`${API_BASE}/series?${params.toString()}`);

      if (resObj && Array.isArray(resObj.data)) {
        const items = resObj.data
          .map((item) => {
            const slug = cleanSlug(item.slug || item.public_url || "");
            const title = decodeHtmlEntities(item.title || "");
            const cover = abs(item.cover || item.coverUrl);

            if (!slug || !title || /^\d+(\.\d+)?$/.test(title)) return null;

            return { id: slug, title, cover };
          })
          .filter(Boolean);

        if (items.length > 0) return items;
      }
    } catch (e) {
      // Fallback to HTML
    }

    // 2. HTML /browse Fallback
    try {
      const page = Math.floor(offset / 20) + 1;
      const browseUrl = `${BASE}/browse?page=${page}${
        query ? "&search=" + encodeURIComponent(query.trim()) : ""
      }${tagId ? "&genres=" + encodeURIComponent(tagId) : ""}`;

      const res = await harbor.http(browseUrl, {
        responseType: "text",
        headers: { "User-Agent": USER_AGENT }
      });

      if (!res || !res.ok || !res.body) return [];

      const rawProps = extractAstroPropsFromRawHtml(res.body, "series");
      const seriesArray = rawProps?.series || rawProps?.data?.series || [];

      if (Array.isArray(seriesArray) && seriesArray.length > 0) {
        const items = seriesArray
          .map((item) => {
            const slug = cleanSlug(item.slug || item.public_url || "");
            const title = decodeHtmlEntities(item.title || "");
            const cover = abs(item.cover || item.coverUrl || item.thumbnail);

            if (!slug || !title || !cover || /^\d+(\.\d+)?$/.test(title)) return null;

            return { id: slug, title, cover };
          })
          .filter(Boolean);

        if (items.length > 0) return items;
      }

      const doc = harbor.parseHtml(res.body);
      const links = doc.querySelectorAll('a[href*="/comics/"]');
      const results = [];
      const seen = new Set();

      for (const a of links) {
        const href = a.attr("href") || "";
        const slug = cleanSlug(href);
        if (!slug || seen.has(slug)) continue;

        const img = a.querySelector("img");
        const cover = abs(img?.attr("src") || img?.attr("data-src"));
        if (!cover || cover.includes("logo") || cover.includes("brand") || cover.includes("avatar")) continue;

        const titleEl = a.querySelector("h3") || a.querySelector("h2") || a.querySelector("span");
        let title = titleEl ? decodeHtmlEntities(titleEl.text().trim()) : "";

        if (!title || /^\d+(\.\d+)?$/.test(title) || /^(ongoing|completed|hiatus)$/i.test(title)) {
          title = decodeHtmlEntities(a.text().trim());
        }

        if (title && !/^\d+(\.\d+)?$/.test(title)) {
          seen.add(slug);
          results.push({ id: slug, title, cover });
        }
      }

      return results;
    } catch (e) {
      return [];
    }
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
        extractAstroPropsFromRawHtml(res.body, "title", "description") ||
        extractAstroPropsFromRawHtml(res.body, "title");

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

      const props = extractAstroPropsFromRawHtml(res.body, "chapters");
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

      const props = extractAstroPropsFromRawHtml(res.body, "pages");
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
    const genreList = [
      { id: "action", name: "Action" },
      { id: "adventure", name: "Adventure" },
      { id: "comedy", name: "Comedy" },
      { id: "crazy-mc", name: "Crazy MC" },
      { id: "dark-fantasy", name: "Dark Fantasy" },
      { id: "demon", name: "Demon" },
      { id: "drama", name: "Drama" },
      { id: "dungeons", name: "Dungeons" },
      { id: "fantasy", name: "Fantasy" },
      { id: "game", name: "Game" },
      { id: "genius-mc", name: "Genius MC" },
      { id: "isekai", name: "Isekai" },
      { id: "kuchikuchi", name: "Kuchikuchi" },
      { id: "magic", name: "Magic" },
      { id: "martial-arts", name: "Martial Arts" },
      { id: "murim", name: "Murim" },
      { id: "mystery", name: "Mystery" },
      { id: "necromancer", name: "Necromancer" },
      { id: "overpowered", name: "Overpowered" },
      { id: "psychological", name: "Psychological" },
      { id: "regression", name: "Regression" },
      { id: "reincarnation", name: "Reincarnation" },
      { id: "revenge", name: "Revenge" },
      { id: "romance", name: "Romance" },
      { id: "school-life", name: "School Life" },
      { id: "sci-fi", name: "Sci-fi" },
      { id: "shoujo", name: "Shoujo" },
      { id: "shounen", name: "Shounen" },
      { id: "system", name: "System" },
      { id: "tower", name: "Tower" },
      { id: "tragedy", name: "Tragedy" },
      { id: "villain", name: "Villain" },
      { id: "violence", name: "Violence" }
    ];

    return genreList.map((g) => ({ id: g.id, name: g.name, group: "Genre" }));
  }
};