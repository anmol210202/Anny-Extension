const BASE = "https://mangadot.net";

function abs(url) {
  if (!url) return undefined;
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith("//")) return "https:" + url;
  if (url.startsWith("/")) return BASE + url;
  return BASE + "/" + url;
}

function decodeRsc(flat) {
  if (!Array.isArray(flat)) return flat;
  const cache = new Array(flat.length);
  const nil = Symbol("nil");

  function resolve(i) {
    if (typeof i !== "number" || i < 0 || i >= flat.length) return i;
    if (cache[i] !== undefined) {
      return cache[i] === nil ? null : cache[i];
    }
    const el = flat[i];
    let result = null;

    if (el === null || el === undefined) {
      result = null;
    } else if (Array.isArray(el)) {
      result = el.map((refIdx) => resolve(refIdx));
    } else if (typeof el === "object") {
      result = {};
      for (const [k, v] of Object.entries(el)) {
        const keyIndex = parseInt(k.replace(/^_/, ""), 10);
        const keyStr = typeof flat[keyIndex] === "string" ? flat[keyIndex] : String(flat[keyIndex] ?? k);
        result[keyStr] = resolve(v);
      }
    } else {
      result = el;
    }

    cache[i] = result === null ? nil : result;
    return result;
  }

  return resolve(0);
}

async function getRscData(path, routeKey) {
  const url = BASE + (path.startsWith("/") ? path : "/" + path);
  const res = await harbor.http(url, { responseType: "json" });
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status} for ${url}`);

  const decoded = decodeRsc(res.body);
  if (!decoded) throw new Error(`Failed to decode RSC data for ${url}`);

  if (routeKey) {
    return decoded[routeKey] || null;
  }
  return decoded;
}

function extractMangaList(obj) {
  if (!obj) return [];
  const possibleList =
    obj.manga_list ||
    obj.results ||
    obj.mangaList ||
    obj.data?.manga_list ||
    obj.data?.results ||
    obj.data?.mangaList ||
    obj.data?.data?.manga_list ||
    obj.data?.data?.results ||
    obj.data?.data?.mangaList ||
    [];
  return Array.isArray(possibleList) ? possibleList : [];
}

function parseMangaCard(manga) {
  if (!manga || manga.id === undefined || manga.id === null) return null;
  return {
    id: String(manga.id),
    title: manga.title || "Unknown",
    cover: abs(manga.photo)
  };
}

const plugin = {
  id: "mangadotnet",
  name: "Mangadotnet",

  async popular(offset, tagId) {
    const page = Math.floor(offset / 48) + 1;
    const params = new URLSearchParams({
      adult: "0",
      _routes: "pages/ViewAllPage",
      page: page.toString()
    });
    if (tagId) params.append("genre", tagId);

    const routeData = await getRscData("/view-all/most-tracked.data?" + params.toString(), "pages/ViewAllPage");
    const mangaList = extractMangaList(routeData);

    return mangaList.map(parseMangaCard).filter(Boolean);
  },

  async search(query, offset, tagId) {
    const page = Math.floor(offset / 48) + 1;
    const params = new URLSearchParams({
      page: page.toString(),
      perPage: "56",
      sortBy: "latest",
      sortOrder: "desc",
      _routes: "pages/SearchPage",
      adult: "0"
    });

    if (query && query.trim()) {
      params.append("search", query.trim());
    }
    if (tagId) {
      params.append("genre", tagId);
    }

    const routeData = await getRscData("/search.data?" + params.toString(), "pages/SearchPage");
    const mangaList = extractMangaList(routeData);

    return mangaList.map(parseMangaCard).filter(Boolean);
  },

  async detail(id) {
    const routeData = await getRscData(`/manga/${id}.data?_routes=pages/MangaDetailPage`, "pages/MangaDetailPage");
    const manga =
      routeData?.data?.mangaData?.manga ||
      routeData?.mangaData?.data?.manga ||
      routeData?.data?.data?.manga ||
      routeData?.data?.manga ||
      routeData?.manga;

    if (!manga) return null;

    let author = "";
    if (manga.authors) {
      try {
        const parsed = JSON.parse(manga.authors);
        if (Array.isArray(parsed)) author = parsed.join(", ");
      } catch (e) {
        author = String(manga.authors);
      }
    }

    let status = "unknown";
    if (manga.status) {
      const s = String(manga.status).toLowerCase();
      if (s.includes("ongoing")) status = "ongoing";
      else if (s.includes("completed")) status = "completed";
      else if (s.includes("hiatus")) status = "on_hiatus";
    }

    let desc = manga.description || "";
    if (manga.year) desc = `**Year:** ${manga.year}\n\n` + desc;

    return {
      id: String(manga.id || id),
      title: manga.title || id,
      cover: abs(manga.photo),
      description: desc.trim() || undefined,
      status,
      author: author || undefined
    };
  },

  async chapters(id) {
    const url = `${BASE}/api/manga/${id}/chapters/list?lang=en`;
    const res = await harbor.http(url, { responseType: "json" });

    if (!res.ok || !Array.isArray(res.body)) return [];

    return res.body
      .filter(ch => !ch.language || ch.language === "en")
      .map(ch => {
        const numStr = ch.chapter_number !== undefined && ch.chapter_number !== null 
          ? String(ch.chapter_number).replace(/\.0$/, "") 
          : "0";

        let name = ch.chapter_title ? ch.chapter_title.trim() : "";
        let fullTitle = name;
        if (!name.includes(numStr)) {
          fullTitle = `Chapter ${numStr}${name ? ": " + name : ""}`;
        }

        return {
          id: `${ch.id}:${ch.source || "user"}`,
          chapter: numStr,
          title: fullTitle,
          scanlator: ch.group_name || ch.scanlator || ch.group || undefined,
          pages: ch.page_count || 0,
          language: "en",
          publishAt: ch.date_added || undefined
        };
      });
  },

  async pageUrls(chapterId) {
    const parts = chapterId.split(":");
    const chId = parts[0];
    const source = parts[1] || "user";
    const segment = source === "user" ? "uploads" : "chapters";
    const url = `${BASE}/api/${segment}/${chId}/images`;

    const res = await harbor.http(url, { responseType: "json" });
    if (!res.ok || !res.body || !Array.isArray(res.body.images)) return [];

    return res.body.images
      .map(img => abs(img.url))
      .filter(Boolean);
  },

  async tags() {
    try {
      const routeData = await getRscData("/search.data?page=1&_routes=pages/SearchPage", "pages/SearchPage");
      const searchData = routeData?.data || routeData;
      const genres = searchData?.allGenres || searchData?.all_genres || [];
      const tags = searchData?.allTags || searchData?.all_tags || [];

      const genreItems = genres.map(g => ({ id: g, name: g, group: "Genre" }));
      const tagItems = [];

      if (Array.isArray(tags)) {
        for (const cat of tags) {
          if (Array.isArray(cat.tags)) {
            for (const t of cat.tags) {
              if (t.name) tagItems.push({ id: t.name, name: t.name, group: cat.category || "Tag" });
            }
          }
        }
      }

      return [...genreItems, ...tagItems];
    } catch (e) {
      return [];
    }
  }
};