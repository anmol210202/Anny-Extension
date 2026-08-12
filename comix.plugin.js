// Comix.to manga source plugin for Harbor

const BASE = "https://comix.to";

async function getDoc(path) {
  const res = await harbor.http(BASE + path, { responseType: "text" });
  if (!res.ok) throw new Error("HTTP " + res.status + " for " + path);
  return { doc: harbor.parseHtml(res.body), raw: res.body };
}

function abs(url) {
  if (!url) return undefined;
  url = url.trim();
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith("//")) return "https:" + url;
  if (url.startsWith("/")) return BASE + url;
  return BASE + "/" + url;
}

// Extraction from embedded JSON hydration data
function extractJsonData(rawHtml) {
  try {
    const match = rawHtml.match(/<script[^>]*id="initial-data"[^>]*>([\s\S]*?)<\/script>/i);
    if (!match) return null;
    return JSON.parse(match[1]);
  } catch (e) {
    return null;
  }
}

function itemToSummary(item) {
  if (!item || !item.hid) return null;
  const slug = item.url ? item.url.replace(/^\/title\//, "") : `${item.hid}-${(item.title || "").toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  
  return {
    id: slug.replace(/\/$/, ""),
    title: item.title || "",
    cover: abs(item.poster?.medium || item.poster?.large),
  };
}

function cardToSummary(el) {
  const link = el.querySelector("a.lrow__title-link") || el.querySelector("a.card") || el.querySelector("a");
  if (!link) return null;

  const href = link.attr("href") || "";
  if (!href.includes("/title/")) return null;

  const img = el.querySelector("img");
  const titleEl = el.querySelector(".lrow__title") || el.querySelector(".card__title") || el.querySelector("h3");
  const rawSrc = img?.attr("src") || img?.attr("data-src");

  return {
    id: href.replace(/^\/title\//, "").replace(/\/$/, ""),
    title: (titleEl?.text() || link.attr("title") || img?.attr("alt") || "").trim(),
    cover: abs(rawSrc),
  };
}

const plugin = {
  id: "comix-source",
  name: "Comix",

  async popular(offset, tagId) {
    const page = Math.floor(offset / 28) + 1;
    const genreParam = tagId ? "&genres_in=" + encodeURIComponent(tagId) : "";
    const { doc, raw } = await getDoc("/browse?sort=views_7d%3Adesc&page=" + page + genreParam);

    // Primary: Extract from hydration JSON
    const json = extractJsonData(raw);
    if (json?.list?.items && Array.isArray(json.list.items)) {
      return json.list.items.map(itemToSummary).filter(Boolean);
    }

    // Fallback: DOM Selectors
    const items = doc.querySelectorAll(".list-grid .lrow, .grid-updates .card, .swiper-slide .card");
    return items.map(cardToSummary).filter(Boolean);
  },

  async search(query, offset, tagId) {
    const page = Math.floor(offset / 28) + 1;
    const tagParam = tagId ? "&genres_in=" + encodeURIComponent(tagId) : "";
    const { doc, raw } = await getDoc("/browse?q=" + encodeURIComponent(query) + "&sort=relevance%3Adesc&page=" + page + tagParam);

    const json = extractJsonData(raw);
    if (json?.list?.items && Array.isArray(json.list.items)) {
      return json.list.items.map(itemToSummary).filter(Boolean);
    }

    const items = doc.querySelectorAll(".list-grid .lrow, .grid-updates .card");
    return items.map(cardToSummary).filter(Boolean);
  },

  async detail(id) {
    const { doc, raw } = await getDoc("/title/" + id);

    const json = extractJsonData(raw);
    const detailData = json?.queries ? Object.values(json.queries)[0] : null;

    if (detailData && detailData.title) {
      return {
        id,
        title: detailData.title,
        altTitle: Array.isArray(detailData.altTitles) ? detailData.altTitles.join(", ") : undefined,
        cover: abs(detailData.poster?.large || detailData.poster?.medium),
        description: detailData.synopsis || "",
        status: detailData.status,
        author: (detailData.authors || []).map((a) => a.title).join(", ") || undefined,
        lastChapter: detailData.latestChapter ? `Ch.${detailData.latestChapter}` : undefined,
      };
    }

    const root = doc.querySelector(".mpage");
    if (!root) return null;

    const posterImg = root.querySelector(".mpage__poster img");
    return {
      id,
      title: root.querySelector(".mpage__title")?.text()?.trim() || id,
      altTitle: root.querySelector(".mpage__alts-summary")?.text()?.trim(),
      cover: abs(posterImg?.attr("src") || posterImg?.attr("data-src")),
      description: root.querySelector(".mpage__desc")?.text()?.trim(),
      status: root.querySelector(".mpage__badge--status")?.text()?.trim(),
      author: root.querySelector("a.mpage__chip[href*='authors']")?.text()?.trim(),
      lastChapter: root.querySelector(".mchap-list .mchap-item:first-child .mchap-row__ch")?.text()?.trim(),
    };
  },

  async chapters(id) {
    const { doc } = await getDoc("/title/" + id);
    const items = doc.querySelectorAll(".mchap-list .mchap-item");

    return items
      .map((item) => {
        const link = item.querySelector("a.mchap-row__primary");
        if (!link) return null;

        const href = link.attr("href") || "";
        const rawCh = item.querySelector(".mchap-row__ch")?.text() || "";

        return {
          id: href.replace(/^\/title\//, "").replace(/\/$/, ""),
          chapter: rawCh.replace(/^Ch\.\s*/i, "").trim() || null,
          title: item.querySelector(".mchap-row__title")?.text()?.trim() || null,
          volume: item.querySelector(".mchap-row__vol")?.text()?.replace(/^Vol\.\s*/i, "").trim() || null,
          pages: 0,
          language: "en",
          publishAt: item.querySelector(".mchap-row__time")?.text()?.trim() || undefined,
        };
      })
      .filter((c) => c && c.id);
  },

  async pageUrls(chapterId) {
    const { doc, raw } = await getDoc("/title/" + chapterId);

    const domImages = doc
      .querySelectorAll(".rpage-page img, .rpage-main img, .reader img")
      .map((img) => abs(img.attr("src") || img.attr("data-src")))
      .filter(Boolean);

    if (domImages.length > 0) return [...new Set(domImages)];

    const images = [];
    const pattern = /(https?:\\?\/\\?\/[^"'\s\\]+\.(?:jpg|jpeg|png|webp))/gi;
    let match;

    while ((match = pattern.exec(raw)) !== null) {
      const cleanUrl = match[1].replace(/\\\/|\\/g, "/");
      if (!cleanUrl.includes("/avatars/") && !cleanUrl.includes("favicon") && !cleanUrl.includes("beacon")) {
        images.push(cleanUrl);
      }
    }

    return [...new Set(images)];
  },

  async tags() {
    return [
      { id: "6", name: "Action", group: "Genre" },
      { id: "7", name: "Adventure", group: "Genre" },
      { id: "8", name: "Boys Love", group: "Genre" },
      { id: "9", name: "Comedy", group: "Genre" },
      { id: "10", name: "Crime", group: "Genre" },
      { id: "11", name: "Drama", group: "Genre" },
      { id: "12", name: "Fantasy", group: "Genre" },
      { id: "13", name: "Girls Love", group: "Genre" },
      { id: "40", name: "Harem", group: "Genre" },
      { id: "14", name: "Historical", group: "Genre" },
      { id: "15", name: "Horror", group: "Genre" },
      { id: "16", name: "Isekai", group: "Genre" },
      { id: "17", name: "Magical Girls", group: "Genre" },
      { id: "18", name: "Mecha", group: "Genre" },
      { id: "19", name: "Medical", group: "Genre" },
      { id: "20", name: "Mystery", group: "Genre" },
      { id: "21", name: "Philosophical", group: "Genre" },
      { id: "22", name: "Psychological", group: "Genre" },
      { id: "23", name: "Romance", group: "Genre" },
      { id: "24", name: "Sci-Fi", group: "Genre" },
      { id: "25", name: "Slice of Life", group: "Genre" },
      { id: "26", name: "Sports", group: "Genre" },
      { id: "27", name: "Superhero", group: "Genre" },
      { id: "28", name: "Thriller", group: "Genre" },
      { id: "29", name: "Tragedy", group: "Genre" },
      { id: "30", name: "Wuxia", group: "Genre" },
      { id: "87267", name: "Mature", group: "Genre" },
    ];
  },
};