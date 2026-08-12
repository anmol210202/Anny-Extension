const BASE = "https://mangadot.net";

async function fetchRsc(path, route) {
  const res = await harbor.http(BASE + path, { responseType: "json" });
  if (!res.ok) throw new Error("HTTP " + res.status + " for " + path);
  return decodeRsc(res.body, route);
}

function decodeRsc(flat, route) {
  if (!Array.isArray(flat)) return null;
  const cache = new Array(flat.length);

  function resolve(i) {
    if (i < 0 || i === null || i === undefined) return null;
    if (cache[i] !== undefined) return cache[i];

    const el = flat[i];
    if (el === null || el === undefined) {
      cache[i] = null;
      return null;
    }
    if (typeof el !== "object") {
      cache[i] = el;
      return el;
    }
    if (Array.isArray(el)) {
      const arr = el.map((itemIdx) => resolve(itemIdx));
      cache[i] = arr;
      return arr;
    }

    const obj = {};
    cache[i] = obj;
    for (const [k, v] of Object.entries(el)) {
      const keyIdx = parseInt(k.replace(/^_/, ""), 10);
      const keyName = flat[keyIdx];
      obj[keyName] = resolve(v);
    }
    return obj;
  }

  const decoded = resolve(0);
  if (route && decoded && typeof decoded === "object") {
    return decoded[route] || null;
  }
  return decoded;
}

function abs(url) {
  if (!url) return undefined;
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith("//")) return "https:" + url;
  if (url.startsWith("/")) return BASE + url;
  return BASE + "/" + url;
}

function parseBrowseManga(item) {
  if (!item) return null;
  const id = String(item.manga_id || item.id || "");
  if (!id) return null;
  return {
    id,
    title: (item.title || "").trim(),
    cover: abs(item.photo),
  };
}

const plugin = {
  id: "mangadotnet",
  name: "Mangadotnet",

  async popular(offset, tagId) {
    const page = Math.floor(offset / 39) + 1;
    let path = `/view-all/most-tracked.data?adult=both&_routes=pages/ViewAllPage&page=${page}`;
    if (tagId) path += `&genre=${encodeURIComponent(tagId)}`;

    const data = await fetchRsc(path, "pages/ViewAllPage");
    const list = data?.data?.manga_list || data?.data?.results || [];
    return list.map(parseBrowseManga).filter(Boolean);
  },

  async search(query, offset, tagId) {
    const page = Math.floor(offset / 56) + 1;
    let path = `/search.data?page=${page}&perPage=56&adult=both&_routes=pages/SearchPage`;
    if (query && query.trim()) path += `&search=${encodeURIComponent(query.trim())}`;
    if (tagId) path += `&genre=${encodeURIComponent(tagId)}`;

    const data = await fetchRsc(path, "pages/SearchPage");
    const list = data?.results || data?.manga_list || [];
    return list.map(parseBrowseManga).filter(Boolean);
  },

  async detail(id) {
    const path = `/manga/${id}.data?_routes=pages/MangaDetailPage`;
    const data = await fetchRsc(path, "pages/MangaDetailPage");
    const manga = data?.mangaData?.manga;
    if (!manga) return null;

    let authorStr = "";
    if (manga.authors) {
      try {
        const parsed = JSON.parse(manga.authors);
        authorStr = Array.isArray(parsed) ? parsed.join(", ") : String(manga.authors);
      } catch (_) {
        authorStr = String(manga.authors);
      }
    }

    let statusStr = "Unknown";
    if (Array.isArray(manga.genres) && manga.genres.includes("One Shot")) {
      statusStr = "Completed";
    } else if (manga.hiatus === "Yes") {
      statusStr = "Hiatus";
    } else if (manga.status) {
      const s = manga.status.toLowerCase();
      if (s === "ongoing") statusStr = "Ongoing";
      else if (s === "completed") statusStr = "Completed";
    }

    let desc = manga.description || "";
    if (Array.isArray(manga.alt_titles) && manga.alt_titles.length > 0) {
      desc += "\n\nAlternative Names:\n" + manga.alt_titles.map((t) => "• " + t).join("\n");
    }

    return {
      id: String(id),
      title: (manga.title || id).trim(),
      altTitle: Array.isArray(manga.alt_titles) ? manga.alt_titles.join(", ") : undefined,
      cover: abs(manga.photo),
      description: desc.trim(),
      status: statusStr,
      author: authorStr,
      lastChapter: undefined,
    };
  },

  async chapters(id) {
    const res = await harbor.http(`${BASE}/api/manga/${id}/chapters/list?lang=en`, { responseType: "json" });
    if (!res.ok || !Array.isArray(res.body)) return [];

    return res.body
      .filter((c) => !c.language || c.language === "en")
      .map((c) => {
        const chNum = c.chapter_number != null ? String(c.chapter_number) : null;
        let title = c.chapter_title ? c.chapter_title.trim() : "";
        if (!title && chNum) title = `Chapter ${chNum}`;

        const source = c.source || "user";
        const compositeId = JSON.stringify({ id: String(c.id), source, isVolume: false });

        return {
          id: compositeId,
          chapter: chNum,
          title: title,
          volume: c.volume_number != null ? String(c.volume_number) : null,
          pages: c.page_count || 0,
          language: "en",
          publishAt: c.date_added || undefined,
        };
      })
      .reverse();
  },

  async pageUrls(chapterId) {
    let parsed;
    try {
      parsed = JSON.parse(chapterId);
    } catch (_) {
      parsed = { id: chapterId, source: "user", isVolume: false };
    }

    const segment = parsed.source === "user" ? "uploads" : "chapters";
    const url = `${BASE}/api/${segment}/${parsed.id}/images`;

    const res = await harbor.http(url, { responseType: "json" });
    if (!res.ok || !res.body || !Array.isArray(res.body.images)) return [];

    return res.body.images.map((img) => abs(img.url)).filter(Boolean);
  },

  async tags() {
    const data = await fetchRsc("/search.data?page=1&_routes=pages/SearchPage", "pages/SearchPage");
    const genres = data?.allGenres || [];
    return genres.map((g) => ({ id: g, name: g, group: "Genre" }));
  },
};