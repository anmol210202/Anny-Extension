const BASE = "https://weebcentral.com";

function cleanPath(urlOrPath) {
  if (!urlOrPath) return "";
  let p = urlOrPath.replace(/^https?:\/\/[^\/]+/, "");
  return p.replace(/^\/+|\/+$/g, "");
}

function extractUlid(str) {
  if (!str) return null;
  const match = str.match(/([0-9A-Z]{26})/i);
  return match ? match[1] : null;
}

function abs(url) {
  if (!url) return undefined;
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith("//")) return "https:" + url;
  if (url.startsWith("/")) return BASE + url;
  return BASE + "/" + url;
}

async function getDoc(path) {
  const clean = cleanPath(path);
  const url = BASE + "/" + clean;
  const res = await harbor.http(url, { responseType: "text" });
  if (!res.ok) throw new Error("HTTP " + res.status + " for " + url);
  return harbor.parseHtml(res.body);
}

function extractCover(el) {
  if (!el) return undefined;
  const source = el.querySelector("source");
  if (source) {
    const srcset = source.attr("srcset");
    if (srcset) return abs(srcset.replace("small", "normal"));
  }
  const img = el.querySelector("img");
  if (img) {
    return abs(img.attr("src") || img.attr("data-src"));
  }
  return undefined;
}

function extractTitle(aEl) {
  if (!aEl) return "Unknown";
  const titleAttr = aEl.attr("title");
  if (titleAttr && titleAttr.trim()) return titleAttr.trim();

  const divs = aEl.querySelectorAll("div");
  for (let i = divs.length - 1; i >= 0; i--) {
    const txt = divs[i].text().trim();
    if (txt && !txt.match(/^(Ongoing|Complete|Hiatus|Canceled|Manga|Manhwa|Manhua|OEL)$/i)) {
      return txt;
    }
  }
  return aEl.text().trim() || "Unknown";
}

function parseMangaCard(aEl) {
  const href = aEl.attr("href") || "";
  if (!href) return null;

  return {
    id: cleanPath(href),
    title: extractTitle(aEl),
    cover: extractCover(aEl)
  };
}

const plugin = {
  id: "weebcentral",
  name: "Weeb Central",

  async popular(offset, tagId) {
    const params = new URLSearchParams({
      limit: "32",
      offset: offset.toString(),
      display_mode: "Full Display",
      sort: "Popularity"
    });
    if (tagId) params.append("included_tag", tagId);

    const doc = await getDoc("search/data?" + params.toString());
    return doc.querySelectorAll("article > section > a").map(parseMangaCard).filter(Boolean);
  },

  async search(query, offset, tagId) {
    const cleanQuery = (query || "").replace(/[!#:(),-]/g, " ").trim();
    const params = new URLSearchParams({
      text: cleanQuery,
      limit: "32",
      offset: offset.toString(),
      display_mode: "Full Display"
    });
    if (tagId) params.append("included_tag", tagId);

    const doc = await getDoc("search/data?" + params.toString());
    return doc.querySelectorAll("article > section > a").map(parseMangaCard).filter(Boolean);
  },

  async detail(id) {
    const clean = cleanPath(id);
    const ulid = extractUlid(clean);
    const path = ulid ? "series/" + ulid : clean;
    const doc = await getDoc(path);

    const h1 = doc.querySelector("h1");
    const title = h1 ? h1.text().trim() : clean;

    let cover = extractCover(doc.querySelector("section"));
    if (!cover || cover.includes("brand.png")) {
      const imgs = doc.querySelectorAll("img");
      for (const img of imgs) {
        const src = img.attr("src") || img.attr("data-src") || "";
        if (src.includes("/cover/")) {
          cover = abs(src);
          break;
        }
      }
    }

    const lis = doc.querySelectorAll("li");
    let author = "";
    let status = "unknown";
    let description = "";
    let altTitle = "";

    for (const li of lis) {
      const text = li.text();

      if (text.includes("Author")) {
        const links = li.querySelectorAll("a");
        author = links.map(a => a.text().trim()).filter(Boolean).join(", ");
      } else if (text.includes("Status")) {
        const statusA = li.querySelector("a");
        if (statusA) {
          const sText = statusA.text().trim().toLowerCase();
          if (sText.includes("ongoing")) status = "ongoing";
          else if (sText.includes("complete")) status = "completed";
          else if (sText.includes("hiatus")) status = "on_hiatus";
          else if (sText.includes("cancel")) status = "cancelled";
          else status = sText;
        }
      } else if (text.includes("Description")) {
        const p = li.querySelector("p");
        if (p) description = p.text().trim();
      } else if (text.includes("Associated Name")) {
        const altLis = li.querySelectorAll("li");
        if (altLis.length > 0) {
          altTitle = altLis.map(s => s.text().trim()).filter(Boolean).join(", ");
        }
      }
    }

    return {
      id: clean,
      title,
      altTitle: altTitle || undefined,
      cover: cover || undefined,
      description: description || undefined,
      status,
      author: author || undefined
    };
  },

  async chapters(id) {
    const clean = cleanPath(id);
    const ulid = extractUlid(clean);
    if (!ulid) return [];

    let doc = await getDoc("series/" + ulid + "/full-chapter-list");
    let links = doc.querySelectorAll("a");

    if (!links || links.length === 0) {
      doc = await getDoc("series/" + ulid);
      links = doc.querySelectorAll("a");
    }

    const chaptersList = [];
    for (const a of links) {
      const href = a.attr("href") || "";
      if (!href.toLowerCase().includes("chapter")) continue;

      let titleText = "";
      const span = a.querySelector("span.flex > span") || a.querySelector("span");
      if (span) {
        titleText = span.text();
      } else {
        titleText = a.text();
      }

      // Remove unwanted UI elements and clean up spacing
      titleText = titleText.replace(/Last Read/gi, "").replace(/\s+/g, " ").trim();
      if (!titleText) continue;

      const timeEl = a.querySelector("time");
      const publishAt = timeEl ? timeEl.attr("datetime") : undefined;

      const match = titleText.match(/(?:Chapter|Ch\.)\s*([\d.]+)/i) || titleText.match(/(\d+(?:\.\d+)?)/);
      const chapterNum = match ? match[1] : null;

      chaptersList.push({
        id: cleanPath(href),
        chapter: chapterNum,
        title: titleText,
        pages: 0,
        language: "en",
        publishAt: publishAt || undefined
      });
    }

    return chaptersList;
  },

  async pageUrls(chapterId) {
    const clean = cleanPath(chapterId);
    const ulid = extractUlid(clean);
    const chapterPath = ulid ? "chapters/" + ulid : clean;

    const doc = await getDoc(chapterPath + "/images?is_prev=False&reading_style=long_strip");

    const imgs = doc.querySelectorAll("img");
    const pageUrlsList = [];

    for (const img of imgs) {
      const src = img.attr("src") || img.attr("data-src") || "";
      if (
        src &&
        !src.includes("brand.png") &&
        !src.includes("logo") &&
        !src.includes("favicon") &&
        !src.includes("404")
      ) {
        const absoluteUrl = abs(src);
        if (absoluteUrl) pageUrlsList.push(absoluteUrl);
      }
    }

    return pageUrlsList;
  },

  async tags() {
    const tagsList = [
      "Action", "Adult", "Adventure", "Comedy", "Doujinshi", "Drama",
      "Ecchi", "Fantasy", "Gender Bender", "Harem", "Hentai", "Historical",
      "Horror", "Isekai", "Josei", "Lolicon", "Martial Arts", "Mature",
      "Mecha", "Mystery", "Psychological", "Romance", "School Life",
      "Sci-fi", "Seinen", "Shotacon", "Shoujo", "Shoujo Ai", "Shounen",
      "Shounen Ai", "Slice of Life", "Smut", "Sports", "Supernatural",
      "Tragedy", "Yaoi", "Yuri", "Other"
    ];
    return tagsList.map(tag => ({ id: tag, name: tag, group: "Genre" }));
  }
};