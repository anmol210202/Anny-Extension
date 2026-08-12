const BASE = "https://weebcentral.com";

async function getDoc(path) {
  const res = await harbor.http(BASE + path, { responseType: "text" });
  if (!res.ok) throw new Error("HTTP " + res.status + " for " + path);
  return harbor.parseHtml(res.body);
}

function abs(url) {
  if (!url) return undefined;
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith("//")) return "https:" + url;
  if (url.startsWith("/")) return BASE + url;
  return BASE + "/" + url;
}

function getSourceImg(el) {
  if (!el) return undefined;
  const source = el.querySelector("source");
  if (source) {
    const srcset = source.attr("srcset");
    if (srcset) return abs(srcset.replace("small", "normal"));
  }
  const img = el.querySelector("img");
  if (img) return abs(img.attr("data-src") || img.attr("src"));
  return undefined;
}

function parseCard(el) {
  const link = el.tagName === "A" ? el : el.querySelector("a");
  if (!link) return null;
  const href = link.attr("href") || "";
  
  // Extract relative series ID (e.g., "01J76.../manga-title-slug")
  const id = href.replace(/^https?:\/\/[^\/]+\/series\//, "").replace(/^\/series\//, "");
  
  const titleDivs = link.querySelectorAll("div");
  const title = titleDivs.length > 0 
    ? titleDivs[titleDivs.length - 1].text().trim() 
    : link.text().trim();

  const cover = getSourceImg(link);

  return { id, title, cover };
}

async function fetchSearch(query, offset, sort, tagId) {
  const limit = 32;
  const page = Math.floor(offset / limit);
  const cleanQuery = (query || "").replace(/[!#:(),-]/g, " ").trim();
  
  let url = "/search/data?limit=" + limit + "&offset=" + (page * limit) + "&display_mode=Full%20Display";
  
  if (cleanQuery) url += "&text=" + encodeURIComponent(cleanQuery);
  if (sort) url += "&sort=" + encodeURIComponent(sort);
  if (tagId) url += "&included_tag=" + encodeURIComponent(tagId);

  const doc = await getDoc(url);
  const cards = doc.querySelectorAll("article > section > a");
  return cards.map(parseCard).filter(Boolean);
}

const plugin = {
  id: "weeb-central",
  name: "Weeb Central",

  async popular(offset, tagId) {
    return fetchSearch("", offset, "Popularity", tagId);
  },

  async search(query, offset, tagId) {
    return fetchSearch(query, offset, "Best Match", tagId);
  },

  async detail(id) {
    const doc = await getDoc("/series/" + id);
    const sections = doc.querySelectorAll("section[x-data] > section");
    if (sections.length < 2) return null;

    const sec0 = sections[0];
    const sec1 = sections[1];

    const title = sec1.querySelector("h1")?.text()?.trim() || id;
    const cover = getSourceImg(sec0);

    let author = "";
    let status = "Unknown";
    const metaLis = sec0.querySelectorAll("ul > li");

    for (const li of metaLis) {
      const text = li.text();
      if (text.includes("Author")) {
        author = li.querySelectorAll("a").map((a) => a.text().trim()).join(", ");
      } else if (text.includes("Status")) {
        status = li.querySelector("a")?.text()?.trim() || "Unknown";
      }
    }

    let description = "";
    const allSec1Lis = sec1.querySelectorAll("ul > li");
    
    for (const li of allSec1Lis) {
      const liText = li.text();
      if (liText.includes("Description")) {
        const p = li.querySelector("p");
        if (p) description += p.text().trim().replace(/NOTE:\s*/g, "\n\nNOTE: ");
      } else if (liText.includes("Related Series")) {
        const relLinks = li.querySelectorAll("li");
        if (relLinks.length > 0) {
          description += "\n\nRelated Series:";
          relLinks.forEach((rel) => {
            const a = rel.querySelector("a");
            const span = rel.querySelector("span");
            if (a) {
              description += `\n- [${a.text().trim()}](${abs(a.attr("href"))}) ${span?.text()?.trim() || ""}`.trimEnd();
            }
          });
        }
      } else if (liText.includes("Associated Name")) {
        const altLis = li.querySelectorAll("li");
        if (altLis.length > 0) {
          description += "\n\nAssociated Name(s):";
          altLis.forEach((alt) => {
            description += `\n- ${alt.text().trim()}`;
          });
        }
      }
    }

    return {
      id,
      title,
      cover,
      description: description.trim(),
      status,
      author,
      lastChapter: undefined,
    };
  },

  async chapters(id) {
    const seriesId = id.split("/")[0];
    const doc = await getDoc("/series/" + seriesId + "/full-chapter-list");
    const chapterLinks = doc.querySelectorAll("div[x-data] > a");
    const totalChapters = chapterLinks.length;

    return chapterLinks
      .map((a, index) => {
        const href = a.attr("href") || "";
        const chapterId = href.replace(/^\//, "");
        const titleSpan = a.querySelector("span.flex > span");
        const chapterName = titleSpan ? titleSpan.text().trim() : "";
        const timeEl = a.querySelector("time[datetime]");
        const publishAt = timeEl ? timeEl.attr("datetime") : undefined;

        const seasonMatch = /(Season|S)\s*\d+/i.exec(chapterName);
        const chapterNum = seasonMatch ? String(totalChapters - index) : null;

        return {
          id: chapterId,
          chapter: chapterNum,
          title: chapterName,
          volume: null,
          pages: 0,
          language: "en",
          publishAt: publishAt,
        };
      })
      .filter((c) => c.id);
  },

  async pageUrls(chapterId) {
    const url = "/" + chapterId + "/images?is_prev=False&reading_style=long_strip";
    const doc = await getDoc(url);
    const images = doc.querySelectorAll("section[x-data] img, section img");

    return images
      .map((img) => abs(img.attr("src") || img.attr("data-src")))
      .filter(Boolean);
  },

  async tags() {
    const genres = [
      "Action", "Adult", "Adventure", "Comedy", "Doujinshi", "Drama",
      "Ecchi", "Fantasy", "Gender Bender", "Harem", "Hentai", "Historical",
      "Horror", "Isekai", "Josei", "Lolicon", "Martial Arts", "Mature",
      "Mecha", "Mystery", "Psychological", "Romance", "School Life",
      "Sci-fi", "Seinen", "Shotacon", "Shoujo", "Shoujo Ai", "Shounen",
      "Shounen Ai", "Slice of Life", "Smut", "Sports", "Supernatural",
      "Tragedy", "Yaoi", "Yuri", "Other",
    ];
    return genres.map((g) => ({ id: g, name: g, group: "Genre" }));
  },
};