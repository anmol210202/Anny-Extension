const BASE = "https://kagane.to";
const API_BASE = "https://kagane.to/api/v2";

async function fetchJson(url, options = {}) {
  const res = await harbor.http(url, {
    responseType: "json",
    ...options,
  });
  if (!res.ok) throw new Error("HTTP " + res.status + " for " + url);
  return res.body;
}

function abs(url) {
  if (!url) return undefined;
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith("//")) return "https:" + url;
  if (url.startsWith("/")) return BASE + url;
  return BASE + "/" + url;
}

function bookToSummary(book) {
  if (!book) return null;
  const coverImage = book.cover_image_id ? `${API_BASE}/image/${book.cover_image_id}` : undefined;
  return {
    id: book.series_id || book.id,
    title: (book.title || "").trim(),
    cover: coverImage,
  };
}

async function searchSeries(query, offset, sortParam, tagId) {
  const limit = 35;
  const page = Math.floor(offset / limit);

  let url = `${API_BASE}/search/series?page=${page}&size=${limit}`;
  if (sortParam) url += `&sort=${encodeURIComponent(sortParam)}`;

  const payload = {
    source_type: ["Official", "Unofficial", "Mixed"],
    content_lang: [
      "en", "ja", "ko", "zh-Hans", "zh-Hant", "es", "es-419",
      "fr", "de", "pt", "pt-BR", "ru", "it", "id", "vi", "th", "pl", "hi", "ar"
    ]
  };

  if (query && query.trim()) {
    payload.title = query.trim();
  }

  if (tagId) {
    payload.genres = { values: [tagId] };
  }

  const data = await fetchJson(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!data || !Array.isArray(data.content)) return [];
  return data.content.map(bookToSummary).filter(Boolean);
}

const plugin = {
  id: "kagane",
  name: "Kagane",

  async popular(offset, tagId) {
    return searchSeries("", offset, "total_views,desc", tagId);
  },

  async search(query, offset, tagId) {
    return searchSeries(query, offset, "", tagId);
  },

  async detail(id) {
    const data = await fetchJson(`${API_BASE}/series/${id}`);
    if (!data) return null;

    const coverId = data.series_covers && data.series_covers[0] ? data.series_covers[0].image_id : null;
    const cover = coverId ? `${API_BASE}/image/${coverId}` : undefined;

    const authors = (data.series_staff || [])
      .filter((s) => /author|story/i.test(s.role || ""))
      .map((s) => s.name);

    let description = data.description || "";
    if (data.series_alternate_titles && data.series_alternate_titles.length > 0) {
      description += "\n\nAssociated Name(s):\n" +
        data.series_alternate_titles.map((t) => "• " + t.title).join("\n");
    }

    let status = "Unknown";
    if (data.upload_status) {
      const st = data.upload_status.toUpperCase();
      if (st === "ONGOING") status = "Ongoing";
      else if (st === "COMPLETED") status = "Completed";
      else if (st === "HIATUS") status = "Hiatus";
      else if (st === "ABANDONED") status = "Cancelled";
    }

    return {
      id,
      title: data.title || id,
      cover,
      description: description.trim(),
      status,
      author: authors.join(", "),
      lastChapter: undefined,
    };
  },

  async chapters(id) {
    const data = await fetchJson(`${API_BASE}/series/${id}`);
    if (!data || !Array.isArray(data.series_books)) return [];

    const books = data.series_books.slice().reverse();

    return books.map((book) => {
      const chapterId = `${id}/${book.book_id}`;
      let chapterNum = book.chapter_no || (book.sort_no != null ? String(book.sort_no) : null);
      let title = book.title ? book.title.trim() : "";

      if (!title) {
        if (book.chapter_no) title = "Ch." + book.chapter_no;
        else if (book.volume_no) title = "Vol." + book.volume_no;
      }

      return {
        id: chapterId,
        chapter: chapterNum,
        title: title,
        volume: book.volume_no || null,
        pages: book.page_count || 0,
        language: "all",
        publishAt: book.created_at || undefined,
      };
    });
  },

  async pageUrls(chapterId) {
    const parts = chapterId.split("/");
    const bookId = parts[parts.length - 1];

    // 1. Retrieve integrity token
    const integrityData = await fetchJson(`${BASE}/api/integrity`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}"
    });

    const integrityToken = integrityData.token;

    // 2. Resolve challenge and get chapter manifest
    const challengeUrl = `${API_BASE}/books/${bookId}?is_datasaver=false`;
    const challengeData = await fetchJson(challengeUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-integrity-token": integrityToken
      },
      body: "{}"
    });

    const accessToken = challengeData.access_token;
    const cacheUrl = challengeData.cache_url;
    const pages = challengeData.manifest?.pages || [];

    return pages.map((page) => {
      const ext = page.ext || "jxl";
      return `${cacheUrl}/api/v2/books/page/${bookId}/${page.page_id}.${ext}?token=${accessToken}`;
    });
  },

  async tags() {
    const genres = await fetchJson(`${API_BASE}/genres/list`);
    if (!Array.isArray(genres)) return [];
    return genres.map((g) => ({
      id: g.id,
      name: g.genre_name,
      group: "Genre"
    }));
  },
};