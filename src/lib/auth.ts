// Session : cookie signé (HMAC) « id.expiration.signature ». Web Crypto uniquement : ce module est aussi
// chargé par src/proxy.ts. Le statut du compte (admin, membre, en attente) est vérifié côté serveur.

export const SESSION_COOKIE = "almanach_session";
export const SESSION_DAYS = 60;

const enc = new TextEncoder();

function secret(): string {
  const s = process.env.APP_SECRET;
  if (!s && process.env.NODE_ENV === "production") throw new Error("APP_SECRET manquant.");
  return s || "almanach-dev";
}

async function hmac(message: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret()), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, "0")).join("");
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function signSession(userId: number): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + SESSION_DAYS * 86400;
  return `${userId}.${exp}.${await hmac(`session:${userId}:${exp}`)}`;
}

// Renvoie l'id du compte si le cookie est valide et non expiré.
export async function readSession(cookie: string | undefined): Promise<number | null> {
  if (!cookie) return null;
  const [id, exp, sig] = cookie.split(".");
  if (!id || !exp || !sig || Number(exp) < Date.now() / 1000) return null;
  return safeEqual(sig, await hmac(`session:${id}:${exp}`)) ? Number(id) : null;
}

// Jeton du compagnon Backloggd d'un compte : « id.signature », affiché dans Réglages.
export async function companionToken(userId: number): Promise<string> {
  return `${userId}.${(await hmac(`companion:${userId}`)).slice(0, 32)}`;
}

export async function readCompanion(header: string | null): Promise<number | null> {
  if (!header) return null;
  const token = header.replace(/^Bearer\s+/i, "");
  const [id] = token.split(".");
  if (!Number(id)) return null;
  return safeEqual(token, await companionToken(Number(id))) ? Number(id) : null;
}

// État anti-falsification de la connexion Discord.
export async function signState(nonce: string): Promise<string> {
  return `${nonce}.${(await hmac(`state:${nonce}`)).slice(0, 24)}`;
}

export async function checkState(state: string | null, cookie: string | undefined): Promise<boolean> {
  if (!state || !cookie || state !== cookie) return false;
  const [nonce] = state.split(".");
  return safeEqual(state, await signState(nonce));
}
