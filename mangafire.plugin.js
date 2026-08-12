const BASE = "https://mangafire.to";
const API_BASE = "https://mangafire.to/api";
const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

const TABLE_1_B64 =
  "yINlmUNho8VYJT+ibTIP+9ESiULpVEtMOoD6U6lRE0R/xwXo/Xp9NrUgC4cw/Lmo33vUyjUE40kUoEWIr/fxfNNcq2s79ShQ5NhNrFnJ4hXPwOu/SuXzIbuTQKGFvfm08E9jvCfqAtoDqvQq3dVWPQFmJjgvkISBeXY3BgANR+yVnjGbcxZ47d6kLNfZPIayTq3/YGySb1KuVZodWp/WGNAO5pfMcpaK53Hhs0allBszaMaxuouOwdxbwgxIw6YunSsXjI05Yi0j9j4eHKfSXR8Ifo/Od+8iamRfCXTyvm7NGRGYdcQ0ywcK/u6RXhrbcCm4t2eCtrDgQVecJGkQ+A==";
const KEY_1_B64 = "0Ec58JOY3uBzJK9m3zqIOpdlF7UFiax9DmA=";

const TABLE_2_B64 =
  "IUFltCxD3Oc2cwCgkJffthaOg9cgPUb0LgW6H/VtfcF0kc5F25t+aWj6JH9VOhOaY0rAFdUxlDnl5BLNvwEJvQtP5qcw7vdb/K+chnbwnspSHT8mz5lqwz41TezG0hkO06FTjJZhsyNuFLDpD2ZZxQj/QIRcF90zpmQ7Byu483WsQqUE0C342HL+JXngRB6fRzxRyVTaKu83h7UYTJ0QMt6ixFh6S3F8gqkKwrGTL3jHNBsD45UnifK8+RGtishQV2K3rujLKEkiZxpr2dYcudFW4oFsDKhad3CLBvuyTqsCo4B7mL5IKQ1vXo/MOOvq1I1d8ar9X6Ttu5KF4fZgiA==";
const KEY_2_B64 = "AAdjb1iPY8CiDmq9H34tKTBF8a3oDQ==";

const TABLE_3_B64 =
  "NQHlu1/wVO5EmkwQymF810qqY2xG1k2obcas4Z9mCsPEIFl9pRIjFxbJ7ybMHbBckT5Ton85E0FOeHezbh/mjlEYpmpnlXOS8dgrqeq2KfxImTh1YK9y0PeMNhzA1OQzSY9brYOJq/l2QnE/hwOeZIhPixVSKIUlDb5vLcH6RWKxkIEMuP0bDwIqQ71AJJaEaMJL7A6YtyIwoRT+L5v4aZzodN/0+3nOGsfblFjgxSfPzVDjNFeNl5P26+kEC/8AHgdrpAbt3hHz3HrRN1Y6e+JHgF7ncFWnoF0y3THL1S71WgWGCa6KtSzTCCG58n68nTyj2T3Sshk7utqCtMi/ZQ==";
const KEY_3_B64 = "DELOJgPsVaCcblDtTGMdHzM=";

function b64ToUint8Array(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function uint8ArrayToBase64Url(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

const STAGES = [
  { table: b64ToUint8Array(TABLE_1_B64), key: b64ToUint8Array(KEY_1_B64), iv: 0x5a },
  { table: b64ToUint8Array(TABLE_2_B64), key: b64ToUint8Array(KEY_2_B64), iv: 0x35 },
  { table: b64ToUint8Array(TABLE_3_B64), key: b64ToUint8Array(KEY_3_B64), iv: 0xba }
];

function encryptStage(data, table, key, iv) {
  const out = new Uint8Array(data.length);
  let prev = iv;
  const keySize = key.length;
  for (let i = 0; i < data.length; i++) {
    prev = table[(data[i] ^ key[i % keySize] ^ prev) & 0xff];
    out[i] = prev;
  }
  return out;
}

function signVrf(path) {
  let data = new TextEncoder().encode(path);
  for (const stage of STAGES) {
    data = encryptStage(data, stage.table, stage.key, stage.iv);
  }
  return uint8ArrayToBase64Url(data);
}

function abs(url) {
  if (!url) return undefined;
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith("//")) return "https:" + url;
  if (url.startsWith("/")) return BASE + url;
  return BASE + "/" + url;
}

function getHid(urlOrId) {
  if (!urlOrId) return "";
  let clean = String(urlOrId)
    .replace(/^https?:\/\/[^\/]+/, "")
    .replace(/^\/?title\//, "")
    .replace(/\/$/, "");
  const lastPart = clean.substring(clean.lastIndexOf("/") + 1);
  if (lastPart.includes(".")) {
    return lastPart.substring(lastPart.lastIndexOf(".") + 1);
  }
  if (lastPart.includes("-")) {
    return lastPart.substring(0, lastPart.indexOf("-"));
  }
  return lastPart;
}

async function requestApi(endpoint, params = []) {
  const sortedParams = [...params].sort((a, b) => a[0].localeCompare(b[0]));

  let pathForSigning = endpoint;
  if (sortedParams.length > 0) {
    let lastKey = "";
    let index = 0;
    const queryParts = sortedParams.map(([key, value]) => {
      let newKey = key;
      if (key.endsWith("[]")) {
        if (lastKey !== key) index = 0;
        lastKey = key;
        newKey = key.replace("[]", `[${index++}]`);
      }
      return `${newKey}=${value}`;
    });
    pathForSigning += "?" + queryParts.join("&");
  }

  const vrf = signVrf(pathForSigning);

  const finalQueryParams = [
    ...sortedParams.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`),
    `vrf=${encodeURIComponent(vrf)}`
  ].join("&");

  const fullUrl = `${API_BASE}${endpoint}?${finalQueryParams}`;

  try {
    const res = await harbor.http(fullUrl, {
      responseType: "text",
      headers: {
        "User-Agent": USER_AGENT,
        "Accept": "application/json"
      }
    });

    if (!res || !res.ok || !res.body) return null;
    return typeof res.body === "string" ? JSON.parse(res.body) : res.body;
  } catch (e) {
    return null;
  }
}

function parseMangaCard(item) {
  if (!item || !item.hid) return null;
  let cover = undefined;
  if (item.poster) {
    cover = item.poster.large || item.poster.medium || item.poster.small;
  }

  return {
    id: item.hid,
    title: (item.title || "Unknown").trim(),
    cover: abs(cover)
  };
}

const plugin = {
  id: "mangafire",
  name: "MangaFire",

  async popular(offset, tagId) {
    const page = Math.floor(offset / 50) + 1;
    const params = [
      ["order[views_30d]", "desc"],
      ["page", page.toString()],
      ["limit", "50"]
    ];

    if (tagId) {
      params.push(["genres_in[]", tagId]);
    }

    const data = await requestApi("/titles", params);
    const items = data?.items || [];
    if (!Array.isArray(items)) return [];

    return items.map(parseMangaCard).filter(Boolean);
  },

  async search(query, offset, tagId) {
    const page = Math.floor(offset / 50) + 1;
    const cleanQuery = (query || "").trim();
    const params = [
      ["page", page.toString()],
      ["limit", "50"]
    ];

    if (cleanQuery) {
      params.push(["keyword", cleanQuery]);
    } else {
      params.push(["order[chapter_updated_at]", "desc"]);
    }

    if (tagId) {
      params.push(["genres_in[]", tagId]);
    }

    const data = await requestApi("/titles", params);
    const items = data?.items || [];
    if (!Array.isArray(items)) return [];

    return items.map(parseMangaCard).filter(Boolean);
  },

  async detail(id) {
    const hid = getHid(id);
    const res = await requestApi(`/titles/${hid}`);
    const data = res?.data;
    if (!data) return null;

    let status = "unknown";
    if (data.status) {
      const s = String(data.status).toLowerCase();
      if (s === "releasing") status = "ongoing";
      else if (s === "finished") status = "completed";
      else if (s === "on_hiatus") status = "on_hiatus";
      else if (s === "discontinued") status = "cancelled";
    }

    const authors = Array.isArray(data.authors) ? data.authors.map((a) => a.title) : [];
    const artists = Array.isArray(data.artists) ? data.artists.map((a) => a.title) : [];
    const authorStr = Array.from(new Set([...authors, ...artists])).join(", ");

    let cover = undefined;
    if (data.poster) {
      cover = data.poster.large || data.poster.medium || data.poster.small;
    }

    const desc = (data.synopsisHtml || "").replace(/<[^>]*>/g, "").trim();

    return {
      id: hid,
      title: (data.title || hid).trim(),
      cover: abs(cover),
      description: desc || undefined,
      status,
      author: authorStr || undefined
    };
  },

  async chapters(id) {
    const hid = getHid(id);

    const firstParams = [
      ["language", "en"],
      ["sort", "number"],
      ["order", "desc"],
      ["page", "1"],
      ["limit", "200"]
    ];

    const firstData = await requestApi(`/titles/${hid}/chapters`, firstParams);
    const items = [...(firstData?.items || [])];
    const lastPage = firstData?.meta?.lastPage || 1;

    if (lastPage > 1) {
      for (let p = 2; p <= lastPage; p++) {
        const pParams = [
          ["language", "en"],
          ["sort", "number"],
          ["order", "desc"],
          ["page", p.toString()],
          ["limit", "200"]
        ];
        const pageData = await requestApi(`/titles/${hid}/chapters`, pParams);
        if (Array.isArray(pageData?.items)) {
          items.push(...pageData.items);
        }
      }
    }

    const seenChapterIds = new Set();
    const parsedChapters = [];

    for (const ch of items) {
      const chId = String(ch.id);
      const fullId = `${hid}:${chId}`;
      if (seenChapterIds.has(fullId)) continue;
      seenChapterIds.add(fullId);

      const numStr =
        ch.number !== undefined && ch.number !== null
          ? String(ch.number).replace(/\.0$/, "")
          : "0";

      let titleText = `Ch. ${numStr}`;
      if (ch.name) {
        titleText += ` - ${ch.name}`;
      }

      parsedChapters.push({
        id: fullId,
        chapter: numStr,
        title: titleText,
        group: ch.type || "Unknown",
        pages: 0,
        language: "en",
        publishAt: ch.createdAt ? new Date(ch.createdAt * 1000).toISOString() : undefined,
        _num: typeof ch.number === "number" ? ch.number : parseFloat(numStr) || 0
      });
    }

    parsedChapters.sort((a, b) => a._num - b._num);

    return parsedChapters.map(({ _num, ...rest }) => rest);
  },

  async pageUrls(chapterId) {
    const chId = String(chapterId).split(":").pop().replace(/^[^\d]*/, "").replace(/-.*$/, "");
    const res = await requestApi(`/chapters/${chId}`);
    const pages = res?.data?.pages || [];

    if (!Array.isArray(pages)) return [];

    return pages.map((p) => abs(p.url)).filter(Boolean);
  },

  async tags() {
    const genres = [
      { id: "1", name: "Action" },
      { id: "268929", name: "Adult" },
      { id: "78", name: "Adventure" },
      { id: "5", name: "Comedy" },
      { id: "6", name: "Drama" },
      { id: "7", name: "Ecchi" },
      { id: "79", name: "Fantasy" },
      { id: "9", name: "Girls Love" },
      { id: "11", name: "Harem" },
      { id: "268930", name: "Hentai" },
      { id: "268922", name: "Historical" },
      { id: "530", name: "Horror" },
      { id: "13", name: "Isekai" },
      { id: "15", name: "Josei" },
      { id: "534", name: "Martial Arts" },
      { id: "268931", name: "Mature" },
      { id: "19", name: "Mecha" },
      { id: "268924", name: "Medical" },
      { id: "22", name: "Mystery" },
      { id: "26", name: "Romance" },
      { id: "28", name: "Sci-Fi" },
      { id: "537", name: "Seinen" },
      { id: "30", name: "Shoujo" },
      { id: "31", name: "Shounen" },
      { id: "538", name: "Slice of Life" },
      { id: "34", name: "Sports" },
      { id: "76", name: "Supernatural" },
      { id: "38", name: "Thriller" },
      { id: "39", name: "Vampire" },
      { id: "268928", name: "Wuxia" }
    ];
    return genres.map((g) => ({ id: g.id, name: g.name, group: "Genre" }));
  }
};