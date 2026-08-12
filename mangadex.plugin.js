const API_BASE = "https://api.mangadex.org";
const CDN_BASE = "https://uploads.mangadex.org";

async function fetchJson(url) {
  const res = await harbor.http(url, { responseType: "json" });
  if (!res.ok) throw new Error("HTTP " + res.status + " for " + url);
  return res.body;
}

function getTitle(titleObj, altTitles) {
  if (!titleObj) return "Untitled";
  if (titleObj.en) return titleObj.en;
  const firstLang = Object.keys(titleObj)[0];
  if (firstLang) return titleObj[firstLang];
  if (Array.isArray(altTitles)) {
    for (const alt of altTitles) {
      if (alt.en) return alt.en;
      const k = Object.keys(alt)[0];
      if (k) return alt[k];
    }
  }
  return "Untitled";
}

function getCoverUrl(mangaId, relationships) {
  if (!relationships) return undefined;
  const coverRel = relationships.find((r) => r.type === "cover_art");
  if (coverRel && coverRel.attributes && coverRel.attributes.fileName) {
    return `${CDN_BASE}/covers/${mangaId}/${coverRel.attributes.fileName}`;
  }
  return undefined;
}

function parseMangaItem(item) {
  if (!item) return null;
  const id = item.id;
  const title = getTitle(item.attributes?.title, item.attributes?.altTitles);
  const cover = getCoverUrl(id, item.relationships);
  return { id, title, cover };
}

const plugin = {
  id: "mangadex",
  name: "MangaDex",

  async popular(offset, tagId) {
    const limit = 20;
    let url = `${API_BASE}/manga?order[followedCount]=desc&availableTranslatedLanguage[]=en&limit=${limit}&offset=${offset}&includes[]=cover_art&contentRating[]=safe&contentRating[]=suggestive`;
    if (tagId) url += `&includedTags[]=${encodeURIComponent(tagId)}`;

    const data = await fetchJson(url);
    if (!data || !Array.isArray(data.data)) return [];
    return data.data.map(parseMangaItem).filter(Boolean);
  },

  async search(query, offset, tagId) {
    const limit = 20;
    let url = `${API_BASE}/manga?limit=${limit}&offset=${offset}&includes[]=cover_art&contentRating[]=safe&contentRating[]=suggestive&contentRating[]=erotica&contentRating[]=pornographic`;
    if (query && query.trim()) url += `&title=${encodeURIComponent(query.trim())}`;
    if (tagId) url += `&includedTags[]=${encodeURIComponent(tagId)}`;

    const data = await fetchJson(url);
    if (!data || !Array.isArray(data.data)) return [];
    return data.data.map(parseMangaItem).filter(Boolean);
  },

  async detail(id) {
    const cleanId = id.replace(/^\/manga\//, "").replace(/^\/title\//, "").split("/")[0];
    const url = `${API_BASE}/manga/${cleanId}?includes[]=cover_art&includes[]=author&includes[]=artist`;
    const data = await fetchJson(url);
    const manga = data?.data;
    if (!manga) return null;

    const title = getTitle(manga.attributes?.title, manga.attributes?.altTitles);
    const cover = getCoverUrl(manga.id, manga.relationships);

    const authors = (manga.relationships || [])
      .filter((r) => r.type === "author" || r.type === "artist")
      .map((r) => r.attributes?.name)
      .filter(Boolean);

    const statusMap = {
      ongoing: "Ongoing",
      completed: "Completed",
      hiatus: "Hiatus",
      cancelled: "Cancelled",
    };
    const status = statusMap[manga.attributes?.status] || "Unknown";

    let description = manga.attributes?.description?.en || "";
    if (!description && manga.attributes?.description) {
      const first = Object.keys(manga.attributes.description)[0];
      if (first) description = manga.attributes.description[first];
    }

    description = description.replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1").trim();

    return {
      id: manga.id,
      title,
      cover,
      description,
      status,
      author: Array.from(new Set(authors)).join(", "),
      lastChapter: undefined,
    };
  },

  async chapters(id) {
    const cleanId = id.replace(/^\/manga\//, "").replace(/^\/title\//, "").split("/")[0];
    const limit = 500;
    const url = `${API_BASE}/manga/${cleanId}/feed?limit=${limit}&offset=0&translatedLanguage[]=en&order[volume]=desc&order[chapter]=desc&includes[]=scanlation_group&includeFuturePublishAt=0&includeEmptyPages=0`;
    const data = await fetchJson(url);

    if (!data || !Array.isArray(data.data)) return [];

    return data.data
      .filter((c) => !c.attributes?.externalUrl || c.attributes?.pages > 0)
      .map((c) => {
        const attr = c.attributes || {};
        const chNum = attr.chapter || null;
        let title = attr.title || "";
        if (!title && chNum) title = `Chapter ${chNum}`;
        if (!title) title = "Oneshot";

        return {
          id: c.id,
          chapter: chNum,
          title: title,
          volume: attr.volume || null,
          pages: attr.pages || 0,
          language: "en",
          publishAt: attr.publishAt || undefined,
        };
      });
  },

  async pageUrls(chapterId) {
    const cleanId = chapterId.replace(/^\/chapter\//, "");
    const url = `${API_BASE}/at-home/server/${cleanId}`;
    const data = await fetchJson(url);

    if (!data || !data.baseUrl || !data.chapter) return [];

    const baseUrl = data.baseUrl;
    const hash = data.chapter.hash;
    const pageFiles = data.chapter.data || [];

    return pageFiles.map((file) => `${baseUrl}/data/${hash}/${file}`);
  },

  async tags() {
    const url = `${API_BASE}/manga/tag`;
    const data = await fetchJson(url);
    if (!data || !Array.isArray(data.data)) return [];

    return data.data.map((tag) => ({
      id: tag.id,
      name: tag.attributes?.name?.en || tag.id,
      group: tag.attributes?.group
        ? tag.attributes.group.charAt(0).toUpperCase() + tag.attributes.group.slice(1)
        : "Tag",
    }));
  },
};