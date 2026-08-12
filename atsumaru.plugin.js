const BASE = "https://atsu.moe";
const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

function absImage(imgPath) {
  if (!imgPath) return undefined;
  let str = "";
  if (typeof imgPath === "string") {
    str = imgPath;
  } else if (typeof imgPath === "object" && imgPath !== null) {
    str = imgPath.image || imgPath.poster || imgPath.url || "";
  }
  if (!str) return undefined;
  if (/^https?:\/\//i.test(str)) return str;
  if (str.startsWith("//")) return "https:" + str;

  let clean = str.replace(/^\/+/, "");
  if (clean.startsWith("static/")) {
    clean = clean.substring(7);
  }
  return `${BASE}/static/${clean}`;
}

async function requestJson(url) {
  try {
    const res = await harbor.http(url, {
      responseType: "text",
      headers: {
        "User-Agent": USER_AGENT,
        "Accept": "*/*",
        "Content-Type": "application/json"
      }
    });
    if (!res || !res.ok || !res.body) return null;
    return typeof res.body === "string" ? JSON.parse(res.body) : res.body;
  } catch (e) {
    return null;
  }
}

function parseMangaCard(item) {
  if (!item || !item.id) return null;
  const imgPath = item.poster || item.image || item.imagePath;
  const coverUrl = absImage(imgPath);

  return {
    id: String(item.id),
    title: item.title || "Unknown",
    cover: coverUrl
  };
}

const plugin = {
  id: "atsumaru",
  name: "Atsumaru",

  async popular(offset, tagId) {
    return this.search("", offset, tagId);
  },

  async search(query, offset, tagId) {
    const cleanQuery = (query || "").trim();
    const page = Math.floor(offset / 40) + 1;

    if (!cleanQuery && !tagId) {
      const data = await requestJson(
        `${BASE}/api/infinite/trending?page=${page - 1}&types=Manga,Manwha,Manhua,OEL`
      );
      const items = data?.items || [];
      if (Array.isArray(items) && items.length > 0) {
        return items.map(parseMangaCard).filter(Boolean);
      }
    }

    let filterQuery =
      "hidden:!=true && (mbContentRating:=[`Safe`,`Suggestive`,`Erotica`] || mbContentRating:!=*) && views:>0";
    if (tagId) {
      filterQuery = `hidden:!=true && (genreIds:=\`${tagId}\` || tagIds:=\`${tagId}\`) && (mbContentRating:=[\`Safe\`,\`Suggestive\`,\`Erotica\`] || mbContentRating:!=*) && views:>0`;
    }

    const params = new URLSearchParams({
      q: cleanQuery || "*",
      page: page.toString(),
      per_page: "40",
      filter_by: filterQuery
    });

    if (cleanQuery) {
      params.set("query_by", "title,englishTitle,otherNames,authors");
      params.set("query_by_weights", "4,3,2,1");
      params.set("num_typos", "4,3,2,1");
    }

    const resObj = await requestJson(
      `${BASE}/collections/manga/documents/search?${params.toString()}`
    );

    let rawList = [];
    if (resObj?.hits && Array.isArray(resObj.hits)) {
      rawList = resObj.hits.map((h) => h.document);
    } else if (resObj?.items && Array.isArray(resObj.items)) {
      rawList = resObj.items;
    }

    return rawList.map(parseMangaCard).filter(Boolean);
  },

  async detail(id) {
    const data = await requestJson(`${BASE}/api/manga/page?id=${id}`);
    const manga = data?.mangaPage;
    if (!manga) return null;

    const descLines = [];
    if (manga.avgRating && manga.avgRating > 0) {
      descLines.push(`Rating: ${Number(manga.avgRating).toFixed(2)}/10`);
    }
    if (manga.released && manga.released > 0) {
      const year = new Date(manga.released).getFullYear();
      if (year) descLines.push(`Year: ${year}`);
    }
    if (manga.views) {
      const v = typeof manga.views === "object" ? manga.views.content : manga.views;
      if (v) descLines.push(`Views: ${v}`);
    }
    if (manga.synopsis && manga.synopsis.trim()) {
      descLines.push(`Synopsis: ${manga.synopsis.trim()}`);
    }
    if (Array.isArray(manga.otherNames) && manga.otherNames.length > 0) {
      const alt = manga.otherNames.filter((n) => n !== manga.title).map((n) => `- ${n}`).join("\n");
      if (alt) descLines.push(`Alternative Names:\n${alt}`);
    }

    let status = "unknown";
    if (manga.status) {
      const s = String(manga.status).toLowerCase().trim();
      if (s.includes("ongoing")) status = "ongoing";
      else if (s.includes("completed")) status = "completed";
      else if (s.includes("hiatus")) status = "on_hiatus";
      else if (s.includes("cancel")) status = "cancelled";
    }

    let authorStr = "";
    if (Array.isArray(manga.authors)) {
      authorStr = manga.authors
        .map((a) => (typeof a === "string" ? a : a.name))
        .filter(Boolean)
        .join(", ");
    }

    return {
      id: String(manga.id || id),
      title: manga.title || id,
      cover: absImage(manga.poster || manga.image),
      description: descLines.join("\n\n") || undefined,
      status,
      author: authorStr || undefined
    };
  },

  async chapters(id) {
    const detailData = await requestJson(`${BASE}/api/manga/page?id=${id}`);
    const chaptersData = await requestJson(`${BASE}/api/manga/allChapters?mangaId=${id}`);

    const scanlatorMap = new Map();
    if (detailData?.mangaPage?.scanlators && Array.isArray(detailData.mangaPage.scanlators)) {
      for (const s of detailData.mangaPage.scanlators) {
        if (s.id && s.name) scanlatorMap.set(String(s.id), s.name);
      }
    }

    const rawList = chaptersData?.chapters || [];
    if (!Array.isArray(rawList)) return [];

    const parsedChapters = rawList.map((ch) => {
      const numStr =
        ch.number !== undefined && ch.number !== null
          ? String(ch.number).replace(/\.0$/, "")
          : "0";

      const scanlatorName = ch.scanlationMangaId
        ? scanlatorMap.get(String(ch.scanlationMangaId))
        : undefined;

      let titleText = ch.title || `Chapter ${numStr}`;
      if (scanlatorName) titleText += ` [${scanlatorName}]`;

      return {
        id: `${id}/${ch.id}`,
        chapter: numStr,
        title: titleText,
        group: scanlatorName,
        pages: 0,
        language: "en",
        publishAt: ch.createdAt ? new Date(ch.createdAt).toISOString() : undefined,
        _num: typeof ch.number === "number" ? ch.number : parseFloat(numStr) || 0
      };
    });

    // Sort ascending, prioritizing Official scanlators if present
    parsedChapters.sort((a, b) => {
      if (a._num !== b._num) return a._num - b._num;
      const aOfficial = String(a.group).toLowerCase().includes("official") ? 0 : 1;
      const bOfficial = String(b.group).toLowerCase().includes("official") ? 0 : 1;
      return aOfficial - bOfficial;
    });

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
    const parts = chapterId.split("/");
    const mangaId = parts[0];
    const chId = parts[1] || parts[0];

    const data = await requestJson(
      `${BASE}/api/read/chapter?mangaId=${mangaId}&chapterId=${chId}`
    );
    const pages = data?.readChapter?.pages || [];

    if (!Array.isArray(pages)) return [];

    return pages.map((p) => absImage(p.image)).filter(Boolean);
  },

  async tags() {
    const genres = [
      { name: "Action", id: "39" },
      { name: "Adult", id: "46" },
      { name: "Adventure", id: "37" },
      { name: "Boys Love", id: "180" },
      { name: "Comedy", id: "6" },
      { name: "Drama", id: "31" },
      { name: "Fantasy", id: "36" },
      { name: "Girls Love", id: "4" },
      { name: "Hentai", id: "10" },
      { name: "Historical", id: "45" },
      { name: "Horror", id: "44" },
      { name: "Martial Arts", id: "29" },
      { name: "Mystery", id: "32" },
      { name: "Psychological", id: "18" },
      { name: "Romance", id: "9" },
      { name: "Sci-Fi", id: "1" },
      { name: "Slice of Life", id: "7" },
      { name: "Smut", id: "41" },
      { name: "Supernatural", id: "22" },
      { name: "Thriller", id: "19" },
      { name: "Tragedy", id: "5" }
    ];
    return genres.map((g) => ({ id: g.id, name: g.name, group: "Genre" }));
  }
};