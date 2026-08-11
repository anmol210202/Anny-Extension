const BASE = "https://weebcentral.com";

function abs(url) {
  if (!url) return undefined;
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith("//")) return "https:" + url;
  return BASE + (url.startsWith("/") ? "" : "/") + url;
}

async function getDoc(path) {
  const res = await harbor.http(BASE + path, { responseType: "text" });
  if (!res.ok) throw new Error("HTTP " + res.status + " for " + path);
  return harbor.parseHtml(res.body);
}

function parseSeriesCard(el) {
  const link = el.querySelector('a[href*="/series/"]');
  if (!link) return null;

  const href = link.attr("href") || "";
  const id = href.replace(/^\/series\//, "");
  const img = el.querySelector("img");
  const rawAlt = img?.attr("alt") || "";
  const title = rawAlt.replace(/\s*cover$/i, "").trim() || el.querySelector(".truncate")?.text()?.trim() || id;

  return {
    id,
    title,
    cover: abs(img?.attr("src")),
  };
}

const plugin = {
  id: "weebcentral",
  name: "Weeb Central",

  async popular(offset, tagId) {
    const page = Math.floor(offset / 32) + 1;
    const tagQuery = tagId ? "&tag=" + encodeURIComponent(tagId) : "";
    const doc = await getDoc(`/search/data?sort=Popularity&order=Descending&display_mode=Full+Display&page=${page}${tagQuery}`);

    return doc.querySelectorAll("article").map(parseSeriesCard).filter(Boolean);
  },

  async search(query, offset, tagId) {
    const page = Math.floor(offset / 32) + 1;
    const tagQuery = tagId ? "&tag=" + encodeURIComponent(tagId) : "";
    const doc = await getDoc(`/search/data?text=${encodeURIComponent(query)}&sort=Popularity&order=Descending&display_mode=Full+Display&page=${page}${tagQuery}`);

    return doc.querySelectorAll("article").map(parseSeriesCard).filter(Boolean);
  },

  async detail(id) {
    const doc = await getDoc("/series/" + id);
    const title = doc.querySelector("h1")?.text()?.trim() || id;
    const cover = abs(doc.querySelector("picture img")?.attr("src"));
    const description = doc.querySelector(".description, #synopsis, article p")?.text()?.trim();
    const isOngoing = Boolean(doc.querySelector("img[src*='icon-ongoing']"));
    const author = doc.querySelector("a[href*='author']")?.text()?.trim();

    return {
      id,
      title,
      cover,
      description,
      status: isOngoing ? "Ongoing" : "Completed",
      author,
    };
  },

  async chapters(id) {
    let doc;
    try {
      doc = await getDoc("/series/" + id + "/full-chapter-list");
    } catch (e) {
      doc = await getDoc("/series/" + id);
    }

    return doc.querySelectorAll('a[href*="/chapters/"]').map((a) => {
      const href = a.attr("href") || "";
      const nameText = a.text()?.trim() || "";
      const match = nameText.match(/(?:Chapter|Episode)\s*([\d.]+)/i);

      return {
        id: href.replace(/^\/chapters\//, ""),
        chapter: match ? match[1] : null,
        title: nameText,
        language: "en",
        publishAt: a.querySelector("time")?.attr("datetime") || undefined,
      };
    }).filter((c) => c.id);
  },

  async pageUrls(chapterId) {
    let doc;
    try {
      doc = await getDoc("/chapters/" + chapterId + "/images?reading_style=long_strip");
    } catch (e) {
      doc = await getDoc("/chapters/" + chapterId);
    }

    return doc.querySelectorAll("img")
      .map((img) => abs(img.attr("data-src") || img.attr("src")))
      .filter((src) => src && !src.includes("/static/images/") && !src.includes("brand"));
  },

  async tags() {
    const doc = await getDoc("/search");
    return doc.querySelectorAll('a[href*="tag="]').map((a) => ({
      id: (a.attr("href") || "").split("tag=")[1] || "",
      name: a.text().trim(),
      group: "Genre",
    })).filter((t) => t.id && t.name);
  },
};