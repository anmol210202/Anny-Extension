const BASE = "https://asurascans.com";
const API_BASE = "https://api.asurascans.com/api";
const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

function abs(url) {
  if (!url) return undefined;
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith("//")) return "https:" + url;
  if (url.startsWith("/")) return BASE + url;
  return BASE + "/" + url;
}

function unwrapAstro(data) {
  if (data === null || data === undefined) return null;
  if (Array.isArray(data)) {
    if (data.length === 0 || data.length === 1) return null;
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

function extractAstroProps(doc, ...keys) {
  const selector = keys.map((k) => `[props*="${k}"]`).join("");
  const el = doc.querySelector(selector);
  if (!el) return null;

  const propsRaw = el.attr("props");
  if (!propsRaw) return null;

  try {
    return unwrapAstro(JSON.parse(propsRaw));
  } catch (e) {
    return null;
  }
}

async function getDoc(path) {
  const url = path.startsWith("http") ? path : BASE + (path.startsWith("/") ? path : "/" + path);
  const res = await harbor.http(url, {
    responseType: "text",
    headers: { "User-Agent": USER_AGENT }
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return harbor.parseHtml(res.body);
}

async function getJson(url) {
  const res = await harbor.http(url, {
    responseType: "json",
    headers: { "User-Agent": USER_AGENT }
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.body;
}

const plugin = {
  id: "asurascans",
  name: "Asura Scans",

  async popular(offset, tagId) {
    return this.search("", offset, tagId);
  },

  async search(query, offset, tagId) {
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

    const res = await getJson(`${API_BASE}/series?${params.toString()}`);
    const list = res?.data || [];

    return list
      .map((item) => {
        const slug = item.slug || (item.public_url ? item.public_url.split("/").pop() : "");
        return {
          id: slug,
          title: item.title || "Unknown",
          cover: abs(item.cover || item.coverUrl)
        };
      })
      .filter((i) => i.id && i.title);
  },

  async detail(id) {
    const doc = await getDoc(`/comics/${id}`);
    const props = extractAstroProps(doc, "title", "description");

    if (!props) {
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
      title: props.title || id,
      cover: abs(props.coverUrl || props.cover),
      description: description.trim() || undefined,
      status,
      author: authors || undefined
    };
  },

  async chapters(id) {
    const doc = await getDoc(`/comics/${id}`);
    const props = extractAstroProps(doc, "chapters");
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
  },

  async pageUrls(chapterId) {
    const cleanPath = chapterId.startsWith("comics/") ? chapterId : `comics/${chapterId}`;
    const doc = await getDoc(`/${cleanPath}`);
    const props = extractAstroProps(doc, "pages");
    const pages = props?.pages || [];

    return pages.map((p) => abs(p.url)).filter(Boolean);
  },

  async tags() {
    try {
      const doc = await getDoc("/browse");
      const props = extractAstroProps(doc, "availableGenres");
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