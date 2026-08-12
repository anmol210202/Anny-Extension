const BASE = "https://readcomicsonline.ru";
const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

function abs(url) {
  if (!url) return undefined;
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith("//")) return "https:" + url;
  if (url.startsWith("/")) return BASE + url;
  return BASE + "/" + url;
}

function cleanSlug(urlOrPath) {
  if (!urlOrPath) return "";
  let p = String(urlOrPath).replace(/^https?:\/\/[^\/]+/, "");
  p = p.replace(/^\/?comic\//, "");
  return p.replace(/^\/+|\/+$/g, "");
}

async function requestHtml(url) {
  try {
    const res = await harbor.http(url, {
      responseType: "text",
      headers: {
        "User-Agent": USER_AGENT,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
      }
    });
    if (!res || !res.ok || !res.body) return null;
    return res.body;
  } catch (e) {
    return null;
  }
}

function parseMangaCard(element) {
  if (!element) return null;
  const anchor = element.querySelector("a.block.text-sm.font-semibold") || element.querySelector("a");
  if (!anchor) return null;

  const href = anchor.attr("href");
  const slug = cleanSlug(href);
  if (!slug) return null;

  const img = element.querySelector("img");
  const cover = img ? img.attr("data-src") || img.attr("src") : undefined;

  return {
    id: slug,
    title: anchor.text() || "Unknown",
    cover: abs(cover)
  };
}

const plugin = {
  id: "readcomicsonline",
  name: "Read Comics Online",

  async popular(offset, tagId) {
    const page = Math.floor(offset / 30) + 1;
    const url = tagId
      ? `${BASE}/comic-list?category=${tagId}&sort=views&page=${page}`
      : `${BASE}/comic-list?sort=views&page=${page}`;

    const html = await requestHtml(url);
    if (!html) return [];

    const doc = harbor.parseHtml(html);
    const elements = doc.querySelectorAll("div.comic-list-layout .grid > .group") || doc.querySelectorAll(".grid > .group");

    return elements.map(parseMangaCard).filter(Boolean);
  },

  async search(query, offset, tagId) {
    const page = Math.floor(offset / 30) + 1;
    const cleanQuery = (query || "").trim();

    let url = `${BASE}/comic-list?page=${page}`;
    if (cleanQuery) {
      url += `&keyword=${encodeURIComponent(cleanQuery)}`;
    } else {
      url += `&sort=latest`;
    }

    if (tagId) {
      url += `&category=${encodeURIComponent(tagId)}`;
    }

    const html = await requestHtml(url);
    if (!html) return [];

    const doc = harbor.parseHtml(html);
    const elements = doc.querySelectorAll("div.comic-list-layout .grid > .group") || doc.querySelectorAll(".grid > .group");

    return elements.map(parseMangaCard).filter(Boolean);
  },

  async detail(id) {
    const slug = cleanSlug(id);
    const html = await requestHtml(`${BASE}/comic/${slug}`);
    if (!html) return null;

    const doc = harbor.parseHtml(html);

    const titleEl = doc.querySelector("h1.text-2xl") || doc.querySelector("h1");
    const imgEl = doc.querySelector("img.w-full.rounded-xl") || doc.querySelector("img");
    const descEl = doc.querySelector("p.mt-5.text-sm") || doc.querySelector("p.mt-5");

    let status = "unknown";
    const statusSpan = doc.querySelector("div.flex.flex-wrap.gap-2 span.rounded-full");
    if (statusSpan) {
      const st = statusSpan.text().toLowerCase();
      if (st.includes("ongoing")) status = "ongoing";
      else if (st.includes("complete") || st.includes("finished")) status = "completed";
      else if (st.includes("dropped") || st.includes("canceled")) status = "cancelled";
    }

    const allLinks = doc.querySelectorAll("a");
    const authors = [];
    const genres = [];

    allLinks.forEach((a) => {
      const href = a.attr("href");
      if (href.includes("/author/")) {
        authors.push(a.text());
      } else if (href.includes("/category/")) {
        genres.push(a.text());
      }
    });

    return {
      id: slug,
      title: titleEl ? titleEl.text() : slug,
      cover: imgEl ? abs(imgEl.attr("data-src") || imgEl.attr("src")) : undefined,
      description: descEl ? descEl.text() : undefined,
      status,
      author: authors.length > 0 ? Array.from(new Set(authors)).join(", ") : undefined
    };
  },

  async chapters(id) {
    const slug = cleanSlug(id);
    const html = await requestHtml(`${BASE}/comic/${slug}`);
    if (!html) return [];

    const doc = harbor.parseHtml(html);
    const elements = doc.querySelectorAll(".overflow-hidden.border-ink-600 > a") || doc.querySelectorAll(".overflow-hidden a");

    const parsedChapters = [];
    const seenChapterIds = new Set();

    elements.forEach((el) => {
      const href = el.attr("href");
      if (!href) return;

      const chPath = href.replace(/^https?:\/\/[^\/]+/, "").replace(/^\/+|\/+$/g, "");
      if (seenChapterIds.has(chPath)) return;
      seenChapterIds.add(chPath);

      const nameEl = el.querySelector(".text-brand-400");
      const rawName = nameEl ? nameEl.text() : el.text();

      const numMatch = rawName.match(/#?(\d+(?:\.\d+)?)/);
      const numStr = numMatch ? numMatch[1] : "0";

      parsedChapters.push({
        id: chPath,
        chapter: numStr,
        title: rawName.trim(),
        pages: 0,
        language: "en",
        _num: parseFloat(numStr) || 0
      });
    });

    // Sort in ascending order (Chapter 1 -> Latest)
    parsedChapters.sort((a, b) => a._num - b._num);

    return parsedChapters.map(({ _num, ...rest }) => rest);
  },

  async pageUrls(chapterId) {
    const cleanPath = String(chapterId).replace(/^https?:\/\/[^\/]+/, "").replace(/^\/+|\/+$/g, "");
    const html = await requestHtml(`${BASE}/${cleanPath}`);
    if (!html) return [];

    const doc = harbor.parseHtml(html);
    const images = doc.querySelectorAll("#reader-all img");

    return images
      .map((img) => abs(img.attr("data-src") || img.attr("src")))
      .filter(Boolean);
  },

  async tags() {
    const genres = [
      { id: "action", name: "Action" },
      { id: "adventure", name: "Adventure" },
      { id: "funny", name: "Comedy" },
      { id: "drama", name: "Drama" },
      { id: "fantasy", name: "Fantasy" },
      { id: "horror", name: "Horror" },
      { id: "mystery", name: "Mystery" },
      { id: "romance", name: "Romance" },
      { id: "sci-fi", name: "Sci-Fi" },
      { id: "superhero", name: "Superhero" },
      { id: "thriller", name: "Thriller" }
    ];
    return genres.map((g) => ({ id: g.id, name: g.name, group: "Genre" }));
  }
};