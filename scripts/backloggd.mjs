// Compagnon Backloggd d'Almanach.
//
// Backloggd n'a pas d'API publique et sert un défi anti-robot (Anubis/BotStopper) aux clients qui ne sont
// pas des navigateurs. Comme Apploggd (github.com/nik250dev/apploggd), on pilote donc un vrai navigateur,
// ici ton Edge ou ton Chrome via playwright-core, avec un profil dédié où tu t'es connecté une fois.
// Le navigateur tourne dans une vraie fenêtre, ouverte réduite : BotStopper refuse le mode headless, et on
// ne maquille pas le navigateur pour passer outre.
//
//   npm run backloggd -- login       ouvre une fenêtre pour te connecter à Backloggd (une seule fois)
//   npm run backloggd                lit le journal, les listes Backlog / Playing, les jeux aimés, les favoris
//                                    et les critiques, puis écrit les fins en attente
//   npm run backloggd -- pull        lecture seule
//   npm run backloggd -- push        écriture seule
//   options : --visible (fenêtre affichée au lieu de réduite), --pages=N (pages de journal lues, 3 par défaut),
//             --user=pseudo (sinon celui des Réglages), --debug (affiche ce qui est lu)

import { chromium } from "playwright-core";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PROFILE = path.join(ROOT, ".backloggd-profile");
const BASE = "https://backloggd.com";

const args = process.argv.slice(2);
const command = args.find((a) => !a.startsWith("--")) ?? "sync";
const flag = (name) => args.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
const flagValue = (name) => flag(name)?.split("=")[1];
const visible = Boolean(flag("visible")) || command === "login";
const debug = Boolean(flag("debug"));
const pages = Number(flagValue("pages") ?? 3);

const APP = (process.env.ALMANACH_URL ?? "http://localhost:3000").replace(/\/$/, "");
const TOKEN = process.env.ALMANACH_TOKEN ?? "";

function log(...m) {
  console.log("[backloggd]", ...m);
}

async function app(method, body) {
  const res = await fetch(`${APP}/api/compagnon/backloggd`, {
    method,
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`Almanach a répondu ${res.status} : ${await res.text()} (vérifie ALMANACH_URL et ALMANACH_TOKEN)`);
  return res.json();
}

async function open() {
  const channel = process.env.BACKLOGGD_BROWSER || "msedge";
  try {
    return await chromium.launchPersistentContext(PROFILE, {
      channel,
      headless: false,
      args: visible ? [] : ["--start-minimized"],
      viewport: { width: 1600, height: 1000 },
      locale: "en-US",
    });
  } catch (err) {
    throw new Error(`Impossible de lancer ${channel} (${err.message.split("\n")[0]}). Essaie BACKLOGGD_BROWSER=chrome.`);
  }
}

// Attend la fin du défi Anubis (« Making sure you're not a bot! »), que le navigateur résout seul.
async function settle(page) {
  try {
    await page.waitForFunction(() => !/not a bot/i.test(document.title), null, { timeout: 45000 });
  } catch {
    throw new Error("Le défi anti-robot de Backloggd ne s'est pas terminé. Relance avec --visible pour voir ce qui bloque.");
  }
  const title = await page.title();
  if (/oh noes/i.test(title)) throw new Error("Backloggd a refusé l'accès (BotStopper). Relance avec --visible.");
  return title;
}

async function goto(page, url) {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  return settle(page);
}

// Pseudo du compte connecté, lu dans la barre de navigation (lien /u/<pseudo>/).
async function loggedUser(page) {
  return page.evaluate(() => {
    for (const a of document.querySelectorAll("nav a[href^='/u/'], header a[href^='/u/']")) {
      const m = a.getAttribute("href").match(/^\/u\/([^/]+)/);
      if (m) return m[1];
    }
    return null;
  });
}

// ---------------------------------------------------------------------------------------------

async function login() {
  const ctx = await open();
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  await goto(page, `${BASE}/login/`);
  log("Connecte-toi dans la fenêtre (et accepte les cookies). Elle se fermera toute seule.");
  const deadline = Date.now() + 10 * 60 * 1000;
  let user = null;
  while (Date.now() < deadline && !user) {
    await page.waitForTimeout(2000);
    if (page.isClosed()) break;
    user = await loggedUser(page).catch(() => null);
  }
  await ctx.close();
  if (!user) throw new Error("Connexion non détectée.");
  fs.writeFileSync(path.join(PROFILE, "almanach-user.txt"), user);
  log(`Connecté en tant que ${user}. Mets ce pseudo dans les Réglages d'Almanach si ce n'est pas fait.`);
}

// Le journal liste les sessions par mois : un .journal_entry est soit un en-tête de mois
// (.month-year-date h4, « October 2026 »), soit une session (.result) qui ne donne que le jour.
async function readJournalPage(page) {
  return page.evaluate(() => {
    const out = [];
    let month = "";
    for (const entry of document.querySelectorAll(".journal_entry")) {
      const head = entry.querySelector(".month-year-date h4");
      if (head) month = head.textContent.trim();
      const result = entry.querySelector(".result");
      if (!result) continue;
      const a = result.querySelector(".game-name a");
      const href = a?.getAttribute("href") ?? "";
      const texts = [...result.querySelectorAll(".journal-time")].map((n) => n.textContent.trim());
      out.push({
        title: a?.textContent.trim() ?? "",
        slug: href.match(/\/games\/([^/]+)/)?.[1] ?? "",
        cover: result.querySelector(".card-img")?.getAttribute("src") ?? "",
        // Note en étoiles : largeur de la rangée pleine, 80 % = 4 étoiles = 8/10.
        stars: result.querySelector(".journal-rating .stars-top")?.style.width ?? "",
        day: result.querySelector(".date-day")?.textContent.trim() ?? "",
        month,
        texts,
        all: result.textContent.replace(/\s+/g, " ").trim(),
      });
    }
    return out;
  });
}

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

function toEntry(raw) {
  // En-tête « October, 2026 ».
  const [monthName, year] = raw.month.toLowerCase().replace(/,/g, " ").trim().split(/\s+/);
  const m = MONTHS.indexOf(monthName);
  const d = Number(raw.day);
  if (m < 0 || !Number(year) || !d || !raw.slug) return null;
  // Durée : le champ .journal-time qui ressemble à « 2h 30m » (les autres portent « Started… », etc.).
  let minutes = 0;
  for (const t of raw.texts) {
    if (/started|finished/i.test(t)) continue;
    const h = t.match(/(\d+)\s*h/);
    const mm = t.match(/(\d+)\s*m(?!o)/);
    if (h || mm) {
      minutes = Number(h?.[1] ?? 0) * 60 + Number(mm?.[1] ?? 0);
      break;
    }
  }
  return {
    slug: raw.slug,
    title: raw.title,
    cover: raw.cover,
    day: `${year}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`,
    minutes,
    rating: parseFloat(raw.stars) ? Math.round((parseFloat(raw.stars) / 10) * 2) / 2 : undefined,
    // Libellés « Started » / « Finished » de la colonne .journal-time (pas le texte libre de la critique).
    started: raw.texts.some((t) => /^started/i.test(t)),
    finished: raw.texts.some((t) => /^finished/i.test(t)),
  };
}

async function pull(ctx, user) {
  const page = await ctx.newPage();
  const entries = [];
  const seen = new Set();
  for (let p = 1; p <= pages; p++) {
    const title = await goto(page, `${BASE}/u/${user}/journal${p > 1 ? `?page=${p}` : "/"}`);
    if (/404/.test(title)) throw new Error(`Profil Backloggd « ${user} » introuvable.`);
    await page.waitForSelector(".journal_entry", { timeout: 10000 }).catch(() => {});
    const raw = await readJournalPage(page);
    if (debug) console.dir(raw, { depth: 3 });
    let fresh = 0;
    for (const r of raw) {
      const e = toEntry(r);
      if (!e) continue;
      const key = `${e.slug}|${e.day}`;
      if (seen.has(key)) continue;
      seen.add(key);
      entries.push(e);
      fresh++;
    }
    if (!fresh) break; // page vide ou identique à la précédente : fin du journal
  }
  await page.close();
  log(`${entries.length} sessions lues dans le journal de ${user}.`);
  if (entries.length) {
    const { report } = await app("POST", { entries });
    log(`Almanach : ${report.created} jeux ajoutés, ${report.logs} fins.`);
  }
}

// Critiques du profil (/u/<pseudo>/reviews, 15 par page) : jeu, note, statut (« Completed »…) et date de la
// critique, qui sert de date de fin aux jeux sans journal. Lues après le journal, qui reste prioritaire.
async function pullReviews(ctx, user) {
  const page = await ctx.newPage();
  const reviews = [];
  const seen = new Set();
  for (let p = 1; p <= 100; p++) {
    await goto(page, `${BASE}/u/${user}/reviews${p > 1 ? `?page=${p}` : "/"}`);
    const raw = await page.evaluate(() =>
      [...document.querySelectorAll(".review-card")].map((card) => {
        const img = card.querySelector("img.card-img");
        const href = card.querySelector("a[href^='/games/']")?.getAttribute("href") ?? "";
        const width = card.querySelector(".stars-top")?.style.width ?? "";
        return {
          id: card.querySelector(".review-body")?.getAttribute("review_id") ?? "",
          slug: href.match(/\/games\/([^/]+)/)?.[1] ?? "",
          title: img?.getAttribute("alt") ?? "",
          cover: img?.getAttribute("src") ?? "",
          stars: parseFloat(width) || 0,
          status: card.querySelector(".play-type")?.textContent.trim() ?? "",
          date: card.querySelector("time[datetime]")?.getAttribute("datetime") ?? "",
          text: card.querySelector(".card-text")?.innerText.trim() ?? "",
        };
      }),
    );
    if (debug) console.dir(raw, { depth: 2 });
    const fresh = raw.filter((r) => r.id && r.slug && r.date && !seen.has(r.id));
    for (const r of fresh) {
      seen.add(r.id);
      reviews.push({
        slug: r.slug,
        title: r.title,
        cover: r.cover,
        // Jour de la critique dans le fuseau de l'appli, comme le reste.
        day: new Date(r.date).toLocaleDateString("sv-SE", { timeZone: process.env.NEXT_PUBLIC_TIMEZONE || "Europe/Paris" }),
        rating: r.stars ? Math.round(r.stars / 10) : undefined,
        status: r.status,
        text: r.text,
      });
    }
    if (raw.length < 15 || !fresh.length) break;
  }
  await page.close();
  log(`${reviews.length} critiques lues sur le profil de ${user}.`);
  if (reviews.length) {
    const { report } = await app("POST", { reviews });
    log(`Almanach : ${report.created} jeux ajoutés, ${report.logs} fins datées par les critiques.`);
  }
}

// Grille d'une liste de jeux du profil : cartes .game-cover, lien a.cover-link vers /games/<slug>/,
// titre en .game-text-centered (ou alt de l'image). 40 jeux par page, ?page=N.
async function readGrid(page) {
  return page.evaluate(() =>
    [...document.querySelectorAll(".game-cover")].map((card) => {
      const img = card.querySelector("img.card-img");
      const href = card.querySelector("a.cover-link")?.getAttribute("href") ?? card.closest("a")?.getAttribute("href") ?? "";
      return {
        slug: href.match(/\/games\/([^/]+)/)?.[1] ?? "",
        title: card.querySelector(".game-text-centered")?.textContent.trim() || img?.getAttribute("alt") || "",
        cover: img?.getAttribute("src") ?? "",
        // Note du profil affiché (data-rating, sur 10) sur les grilles « games ».
        rating: Number(card.getAttribute("data-rating")) || undefined,
      };
    }),
  );
}

// Listes du profil : Backlog, Playing, Played (par statut : Completed, Played, Retired, Shelved, Abandoned) et jeux
// aimés (grilles paginées, ?page=N), puis les favoris du profil (#profile-favorites ; le premier, .ultimate_fav,
// porte la couronne).
async function pullLists(ctx, user) {
  const page = await ctx.newPage();
  const lists = [];
  const sources = [
    ["backlog", (p) => `${BASE}/u/${user}/games/backlog/categories:all${p > 1 ? `?page=${p}` : "/"}`],
    ["playing", (p) => `${BASE}/u/${user}/games/playing/categories:all${p > 1 ? `?page=${p}` : "/"}`],
    ["liked", (p) => `${BASE}/u/${user}/likes/games/${p > 1 ? `?page=${p}` : ""}`],
    // Le statut d'un jeu joué n'est pas sur sa carte : une grille filtrée par statut.
    ...["completed", "played", "retired", "shelved", "abandoned"].map((status) => [
      "played",
      (p) => `${BASE}/u/${user}/games/played/by/added/type:played;game_status:${status};/${p > 1 ? `?page=${p}` : ""}`,
      status,
    ]),
  ];
  for (const [list, url, status] of sources) {
    const seen = new Set();
    for (let p = 1; p <= 100; p++) {
      const title = await goto(page, url(p));
      if (/404/.test(title)) throw new Error(`Profil Backloggd « ${user} » introuvable.`);
      const games = (await readGrid(page)).filter((g) => g.slug && !seen.has(g.slug));
      if (debug) console.dir(games, { depth: 2 });
      for (const g of games) {
        seen.add(g.slug);
        lists.push({ ...g, list, status });
      }
      // Grilles de 40 (listes) ou plus (Played) : on s'arrête à la première page sans nouveau jeu ou incomplète.
      if (games.length < 40) break;
    }
    log(`${status ? `${list} (${status})` : list} : ${seen.size} jeux.`);
  }
  await goto(page, `${BASE}/u/${user}/`);
  const favorites = await page.evaluate(() =>
    [...document.querySelectorAll("#profile-favorites .game-cover")].map((card, i) => {
      const img = card.querySelector("img.card-img");
      const href = card.querySelector("a.cover-link")?.getAttribute("href") ?? "";
      return {
        slug: href.match(/\/games\/([^/]+)/)?.[1] ?? "",
        title: card.querySelector(".game-text-centered")?.textContent.trim() || img?.getAttribute("alt") || "",
        cover: img?.getAttribute("src") ?? "",
        rank: i + 1,
      };
    }),
  );
  for (const f of favorites) if (f.slug) lists.push({ ...f, list: "favorites" });
  log(`favoris : ${favorites.length} jeux.`);
  await page.close();
  if (lists.length) {
    const { report } = await app("POST", { lists });
    log(`Almanach : ${report.created} jeux ajoutés depuis les listes.`);
  }
}

// Écrit une fin dans le journal, par l'éditeur de log du site (même parcours qu'à la main) :
// bouton Log → onglet Journal → mois du jour voulu → clic sur le jour → coche « Finished » → enregistrer.
async function writeFinish(page, item) {
  let slug = item.slug;
  if (!slug) {
    await goto(page, `${BASE}/search/games/${encodeURIComponent(item.title)}/`);
    const href = await page
      .locator("#search-results .result:has(.main_game) .game-name a, #search-results .result .game-name a")
      .first()
      .getAttribute("href", { timeout: 10000 })
      .catch(() => null);
    slug = href?.match(/\/games\/([^/]+)/)?.[1];
    if (!slug) throw new Error(`« ${item.title} » introuvable sur Backloggd`);
  }
  await goto(page, `${BASE}/games/${slug}/`);
  const logBtn = ".side-section .d-none.d-md-flex .log-editor-btn";
  await page.waitForSelector(logBtn, { timeout: 20000 });
  await page.click(logBtn);
  await page.click("#journal-nav");
  await page.click("#jump-to-today");

  const day = item.finished_on;
  const now = new Date();
  const [y, m] = day.split("-").map(Number);
  const back = (now.getFullYear() - y) * 12 + (now.getMonth() + 1 - m);
  for (let i = 0; i < back; i++) await page.click("#month-prev");
  const cell = `td.fc-daygrid-day[data-date='${day}']:not(.fc-day-other)`;
  await page.waitForSelector(cell, { state: "visible" });

  const openDay = async () => {
    // Sur un jour vide, le premier clic crée la session « Played » ; le suivant ouvre la fenêtre.
    await page.locator(cell).click({ force: true });
    await page.waitForTimeout(500);
    if (!(await page.isVisible("#playthrough-modal-content"))) await page.locator(cell).click({ force: true });
    await page.waitForSelector("#playthrough-modal-content", { state: "visible" });
  };
  await openDay();
  if (!(await page.isChecked("#is_finish_session")) && (await page.isEnabled("#is_finish_session"))) {
    await page.click("label[for='is_finish_session']");
  }
  await page.click("#play-date-update");
  await page.waitForSelector("#playthrough-modal-content", { state: "hidden" });
  await page.click("#btn-save-log");
  await page.waitForSelector("#journal-game-modal", { state: "hidden" });
  return slug;
}

async function push(ctx, pending) {
  if (!pending.length) {
    log("Aucune fin à écrire.");
    return;
  }
  const page = await ctx.newPage();
  const done = [];
  for (const item of pending) {
    try {
      const slug = await writeFinish(page, item);
      done.push({ log_id: item.log_id, slug });
      log(`✓ ${item.title} terminé le ${item.finished_on}`);
    } catch (err) {
      log(`✗ ${item.title} : ${err.message.split("\n")[0]}`);
    }
  }
  await page.close();
  if (done.length) await app("POST", { done });
}

async function main() {
  if (command === "login") return login();
  if (!TOKEN) throw new Error("ALMANACH_TOKEN manquant : copie-le depuis Réglages → Backloggd dans .env.local.");
  const state = await app("GET");
  const saved = path.join(PROFILE, "almanach-user.txt");
  const user = flagValue("user") || state.user || (fs.existsSync(saved) ? fs.readFileSync(saved, "utf8").trim() : "");
  if (!user) throw new Error("Pseudo Backloggd inconnu : renseigne-le dans Réglages, ou lance d'abord « login ».");
  const ctx = await open();
  try {
    if (command === "sync" || command === "pull") {
      await pullLists(ctx, user);
      await pull(ctx, user);
      await pullReviews(ctx, user);
    }
    if (command === "sync" || command === "push") await push(ctx, state.pending);
  } finally {
    await ctx.close();
  }
}

main().catch((err) => {
  console.error("[backloggd]", err.message);
  process.exit(1);
});
