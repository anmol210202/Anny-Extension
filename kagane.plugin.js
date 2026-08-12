const BASE = "https://kagane.to";
const API_BASE = "https://kagane.to/api/v2";
const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

function abs(url) {
  if (!url) return undefined;
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith("//")) return "https:" + url;
  if (url.startsWith("/")) return BASE + url;
  return BASE + "/" + url;
}

async function requestJson(url, opts = {}) {
  try {
    const res = await harbor.http(url, {
      method: opts.method || "GET",
      responseType: "text",
      body: opts.body,
      headers: {
        "User-Agent": USER_AGENT,
        "Accept": "application/json, text/plain, */*",
        "Content-Type": "application/json",
        ...(opts.headers || {})
      }
    });

    if (!res || !res.ok || !res.body) return null;
    return typeof res.body === "string" ? JSON.parse(res.body) : res.body;
  } catch (e) {
    return null;
  }
}

async function getIntegrityToken() {
  try {
    await harbor.http(`${BASE}/`, {
      responseType: "text",
      headers: { "User-Agent": USER_AGENT }
    });

    const resObj = await requestJson(`${BASE}/api/integrity`, {
      method: "POST",
      body: "{}"
    });

    return resObj?.token || null;
  } catch (e) {
    return null;
  }
}

async function getChallengeResponse(chapterId) {
  const token = await getIntegrityToken();
  const url = `${API_BASE}/books/${chapterId}?is_datasaver=false`;

  const headers = {};
  if (token) {
    headers["x-integrity-token"] = token;
  }

  return await requestJson(url, {
    method: "POST",
    body: "{}",
    headers
  });
}

function parseMangaCard(item) {
  if (!item || !item.series_id) return null;
  const coverId = item.cover_image_id || item.coverImage;

  return {
    id: String(item.series_id),
    title: (item.title || "Unknown").trim(),
    cover: coverId ? `${API_BASE}/image/${coverId}` : undefined
  };
}

const plugin = {
  id: "kagane",
  name: "Kagane",

  async popular(offset, tagId) {
    return this.search("", offset, tagId);
  },

  async search(query, offset, tagId) {
    const page = Math.floor(offset / 35);
    const cleanQuery = (query || "").trim();

    const bodyObj = {
      source_type: ["Official", "Unofficial", "Mixed"],
      content_lang: ["en", "ja", "ko", "zh-Hans", "zh-Hant"]
    };

    if (cleanQuery) {
      bodyObj.title = cleanQuery;
    }

    if (tagId) {
      bodyObj.genres = { values: [tagId] };
    }

    const sortParam = cleanQuery ? "" : "total_views,desc";
    const url = `${API_BASE}/search/series?page=${page}&size=35${
      sortParam ? "&sort=" + sortParam : ""
    }`;

    const resObj = await requestJson(url, {
      method: "POST",
      body: JSON.stringify(bodyObj)
    });

    const content = resObj?.content || [];
    if (!Array.isArray(content)) return [];

    return content.map(parseMangaCard).filter(Boolean);
  },

  async detail(id) {
    const data = await requestJson(`${API_BASE}/series/${id}`);
    if (!data) return null;

    let status = "unknown";
    if (data.upload_status) {
      const s = String(data.upload_status).toUpperCase();
      if (s === "ONGOING") status = "ongoing";
      else if (s === "COMPLETED") status = "completed";
      else if (s === "HIATUS") status = "on_hiatus";
      else if (s === "ABANDONED") status = "cancelled";
    }

    const staffList = Array.isArray(data.series_staff) ? data.series_staff : [];
    const authors = staffList
      .filter((s) => /author|story/i.test(s.role || ""))
      .map((s) => s.name);
    const artists = staffList
      .filter((s) => /artist|art/i.test(s.role || ""))
      .map((s) => s.name);

    const authorStr = Array.from(new Set([...authors, ...artists])).join(", ");

    let cover = undefined;
    if (Array.isArray(data.series_covers) && data.series_covers.length > 0) {
      const imgId = data.series_covers[0].image_id;
      if (imgId) cover = `${API_BASE}/image/${imgId}`;
    }

    let desc = (data.description || "").replace(/<[^>]*>/g, "").trim();
    if (Array.isArray(data.series_alternate_titles) && data.series_alternate_titles.length > 0) {
      const alts = data.series_alternate_titles.map((a) => `- ${a.title}`).join("\n");
      if (alts) desc += `\n\nAlternative Names:\n${alts}`;
    }

    return {
      id: String(id),
      title: (data.title || id).trim(),
      cover: abs(cover),
      description: desc || undefined,
      status,
      author: authorStr || undefined
    };
  },

  async chapters(id) {
    const data = await requestJson(`${API_BASE}/series/${id}`);
    const rawBooks = data?.series_books;
    if (!Array.isArray(rawBooks)) return [];

    const parsedChapters = rawBooks.map((book) => {
      const bookId = String(book.book_id || book.id);
      const numStr =
        book.sort_no !== undefined && book.sort_no !== null
          ? String(book.sort_no).replace(/\.0$/, "")
          : book.chapter_no || "0";

      let titleText = (book.title || "").trim();
      if (!titleText) {
        if (book.chapter_no) {
          titleText = `Chapter ${book.chapter_no}`;
        } else if (book.volume_no) {
          titleText = `Volume ${book.volume_no}`;
        } else {
          titleText = `Chapter ${numStr}`;
        }
      }

      const groupNames = Array.isArray(book.groups)
        ? book.groups.map((g) => g.title).filter(Boolean).join(", ")
        : undefined;

      if (groupNames) {
        titleText += ` [${groupNames}]`;
      }

      return {
        id: `${id}:${bookId}`,
        chapter: numStr,
        title: titleText,
        group: groupNames,
        pages: book.page_count || 0,
        language: "en",
        publishAt: book.created_at || undefined
      };
    });

    // Reverses list so Chapter 1 is at index 0 and latest chapter is at the end
    return parsedChapters.reverse();
  },

  async pageUrls(chapterId) {
    const parts = chapterId.split(":");
    const bookId = parts.length > 1 ? parts[1] : parts[0];

    const challengeResp = await getChallengeResponse(bookId);
    if (!challengeResp || !challengeResp.cache_url || !challengeResp.access_token) {
      return [];
    }

    const cacheUrl = challengeResp.cache_url.replace(/\/$/, "");
    const accessToken = challengeResp.access_token;
    const pages = challengeResp.manifest?.pages || [];

    return pages
      .map((p) => {
        const ext = p.ext || "jxl";
        return `${cacheUrl}/api/v2/books/page/${bookId}/${p.page_id}.${ext}?token=${accessToken}`;
      })
      .filter(Boolean);
  },

  async tags() {
    const genres = [
      { id: "action", name: "Action" },
      { id: "adventure", name: "Adventure" },
      { id: "comedy", name: "Comedy" },
      { id: "drama", name: "Drama" },
      { id: "ecchi", name: "Ecchi" },
      { id: "fantasy", name: "Fantasy" },
      { id: "harem", name: "Harem" },
      { id: "hentai", name: "Hentai" },
      { id: "historical", name: "Historical" },
      { id: "horror", name: "Horror" },
      { id: "isekai", name: "Isekai" },
      { id: "martial-arts", name: "Martial Arts" },
      { id: "mecha", name: "Mecha" },
      { id: "mystery", name: "Mystery" },
      { id: "psychological", name: "Psychological" },
      { id: "romance", name: "Romance" },
      { id: "sci-fi", name: "Sci-Fi" },
      { id: "slice-of-life", name: "Slice of Life" },
      { id: "smut", name: "Smut" },
      { id: "sports", name: "Sports" },
      { id: "supernatural", name: "Supernatural" },
      { id: "thriller", name: "Thriller" },
      { id: "tragedy", name: "Tragedy" }
    ];
    return genres.map((g) => ({ id: g.id, name: g.name, group: "Genre" }));
  }
};