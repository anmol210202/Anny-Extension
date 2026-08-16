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

  const anchor =
    element.querySelector("a[href*='/comic/']") ||
    element.querySelector("a.line-clamp-2") ||
    element.querySelector("a");

  if (!anchor) return null;

  const href = anchor.attr("href");
  const slug = cleanSlug(href);
  if (!slug || slug.includes("/auth/") || slug.includes("/news/")) return null;

  const img = element.querySelector("img");
  const cover = img ? img.attr("src") || img.attr("data-src") : undefined;
  const title =
    (img && img.attr("alt")) ||
    (anchor.text() && anchor.text().trim()) ||
    "Unknown";

  return {
    id: slug,
    title: title.replace(/\s+/g, " ").trim(),
    cover: abs(cover)
  };
}

const plugin = {
  id: "readcomicsonline",
  name: "Read Comics Online",

  async popular(offset, tagId) {
    const page = Math.floor(offset / 30) + 1;
    let url = `${BASE}/comic-list?sort=views&page=${page}`;

    if (tagId) {
      url = `${BASE}/comic-list/category/${encodeURIComponent(tagId)}?sort=views&page=${page}`;
    }

    let html = await requestHtml(url);

    // Fallback to home page if comic-list is empty on first page
    if (!html && offset === 0) {
      html = await requestHtml(`${BASE}/`);
    }

    if (!html) return [];

    const doc = harbor.parseHtml(html);

    // Collect all card patterns present in the HTML (releases, hot items, and standard grid)
    const cardNodes = [
      ...doc.querySelectorAll(".reveal-card"),
      ...doc.querySelectorAll(".release-card"),
      ...doc.querySelectorAll(".hot-item"),
      ...doc.querySelectorAll(".grid > .group")
    ];

    const seenIds = new Set();
    const items = [];

    for (const el of cardNodes) {
      const card = parseMangaCard(el);
      if (card && card.id && !seenIds.has(card.id)) {
        seenIds.add(card.id);
        items.push(card);
      }
    }

    return items;
  },

  async search(query, offset, tagId) {
    const page = Math.floor(offset / 30) + 1;
    const cleanQuery = (query || "").trim();

    let url = `${BASE}/comic-list?page=${page}`;
    if (cleanQuery) {
      url = `${BASE}/advanced-search?name=${encodeURIComponent(cleanQuery)}&page=${page}`;
    } else if (tagId) {
      url = `${BASE}/comic-list/category/${encodeURIComponent(tagId)}?page=${page}`;
    } else {
      url = `${BASE}/latest-release?page=${page}`;
    }

    const html = await requestHtml(url);
    if (!html) return [];

    const doc = harbor.parseHtml(html);
    const cardNodes = [
      ...doc.querySelectorAll(".reveal-card"),
      ...doc.querySelectorAll(".release-card"),
      ...doc.querySelectorAll(".grid > .group"),
      ...doc.querySelectorAll(".comic-list-layout .group")
    ];

    const seenIds = new Set();
    const items = [];

    for (const el of cardNodes) {
      const card = parseMangaCard(el);
      if (card && card.id && !seenIds.has(card.id)) {
        seenIds.add(card.id);
        items.push(card);
      }
    }

    return items;
  },

  async detail(id) {
    const slug = cleanSlug(id);
    const html = await requestHtml(`${BASE}/comic/${slug}`);
    if (!html) return null;

    const doc = harbor.parseHtml(html);

    const titleEl = doc.querySelector("h1.text-2xl") || doc.querySelector("h1");
    const imgEl =
      doc.querySelector("img.rounded-xl") ||
      doc.querySelector("img[src*='/cover/']") ||
      doc.querySelector("img");

    const descEl =
      doc.querySelector(".bg-ink-900 p.text-sm") ||
      doc.querySelector("p.text-sm.leading-relaxed") ||
      doc.querySelector("p.mt-5");

    let status = "unknown";
    const statusSpan = doc.querySelector("span.rounded-full");
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
      const href = a.attr("href") || "";
      if (href.includes("/author/")) {
        authors.push(a.text().trim());
      } else if (href.includes("/category/")) {
        genres.push(a.text().trim());
      }
    });

    const chipEls = doc.querySelectorAll(".rc-chip");
    chipEls.forEach((chip) => {
      const t = chip.text().trim();
      if (t && !t.startsWith("👁")) {
        genres.push(t);
      }
    });

    return {
      id: slug,
      title: titleEl ? titleEl.text().trim() : slug,
      cover: imgEl ? abs(imgEl.attr("src") || imgEl.attr("data-src")) : undefined,
      description: descEl ? descEl.text().trim() : undefined,
      status,
      author: authors.length > 0 ? Array.from(new Set(authors)).join(", ") : undefined
    };
  },

  async chapters(id) {
    const slug = cleanSlug(id);
    const html = await requestHtml(`${BASE}/comic/${slug}`);
    if (!html) return [];

    const doc = harbor.parseHtml(html);
    const elements =
      doc.querySelectorAll(".divide-y a") ||
      doc.querySelectorAll("section a[href*='/comic/']");

    const parsedChapters = [];
    const seenChapterIds = new Set();

    elements.forEach((el) => {
      const href = el.attr("href");
      if (!href || !href.includes(`/comic/${slug}/`)) return;

      const chPath = href.replace(/^https?:\/\/[^\/]+/, "").replace(/^\/+|\/+$/g, "");
      if (seenChapterIds.has(chPath)) return;
      seenChapterIds.add(chPath);

      const nameEl = el.querySelector(".text-brand-400");
      const numSpan = nameEl ? nameEl.text() : "";
      const fullText = el.text().trim();

      const numMatch = (numSpan || fullText).match(/#?(\d+(?:\.\d+)?)/);
      const numStr = numMatch ? numMatch[1] : "0";

      let titleText = `Chapter #${numStr}`;
      if (numSpan) {
        titleText = `Issue ${numSpan}`;
      }

      const dateEl = el.querySelector(".text-slate-500");
      const rawDate = dateEl ? dateEl.text().trim() : undefined;

      parsedChapters.push({
        id: chPath,
        chapter: numStr,
        title: titleText,
        pages: 0,
        language: "en",
        publishAt: rawDate ? new Date(rawDate).toISOString() : undefined,
        _num: parseFloat(numStr) || 0
      });
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
    const cleanPath = String(chapterId).replace(/^https?:\/\/[^\/]+/, "").replace(/^\/+|\/+$/g, "");
    const fullPath = cleanPath.startsWith("comic/") ? cleanPath : `comic/${cleanPath}`;

    const html = await requestHtml(`${BASE}/${fullPath}`);
    if (!html) return [];

    const doc = harbor.parseHtml(html);

    // Extract all images directly from the '#reader-all' container
    let images = doc.querySelectorAll("#reader-all img");

    // Fallback to single reader image if '#reader-all' is absent
    if (!images || images.length === 0) {
      images = doc.querySelectorAll("#reader-wrap img");
    }

    return images
      .map((img) => abs(img.attr("src") || img.attr("data-src")))
      .filter(Boolean);
  },

  async tags() {
    const publishersAndGenres = [
      { id: "marvel-comics", name: "Marvel Comics" },
      { id: "dc-comics", name: "DC Comics" },
      { id: "image-comics", name: "Image Comics" },
      { id: "dark-horse", name: "Dark Horse" },
      { id: "idw", name: "IDW" },
      { id: "boom-studios", name: "Boom Studios" },
      { id: "dynamite", name: "Dynamite" },
      { id: "oni-press", name: "Oni Press" },
      { id: "mad-cave", name: "Mad Cave" },
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
    return publishersAndGenres.map((g) => ({ id: g.id, name: g.name, group: "Category" }));
  }
};
