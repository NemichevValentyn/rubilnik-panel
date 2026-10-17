import { ACCESS_KEY_HASH } from "./panel-data.js?v=11";

const STORAGE_KEY = "rubilnik_access";

export function getUrlKey() {
  const params = new URLSearchParams(window.location.search);
  return (params.get("k") || "").trim();
}

export function getGrantedKey() {
  const fromUrl = getUrlKey();
  if (fromUrl) return fromUrl;
  try {
    return sessionStorage.getItem(STORAGE_KEY) || "";
  } catch (_) {
    return "";
  }
}

async function sha256Hex(text) {
  const data = new TextEncoder().encode(text);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(buf)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function hasAccess() {
  const fromUrl = getUrlKey();
  if (fromUrl) {
    const digest = await sha256Hex(fromUrl);
    if (digest === ACCESS_KEY_HASH) {
      try {
        sessionStorage.setItem(STORAGE_KEY, fromUrl);
      } catch (_) {
        /* private mode */
      }
      return true;
    }
  }
  try {
    const saved = sessionStorage.getItem(STORAGE_KEY) || "";
    if (!saved) return false;
    return (await sha256Hex(saved)) === ACCESS_KEY_HASH;
  } catch (_) {
    return false;
  }
}

function isAspNet() {
  return window.location.pathname.includes("/Home");
}

function siteDir() {
  const path = window.location.pathname;
  if (path.endsWith("/")) return path;
  return path.replace(/\/[^/]*$/, "/");
}

export function panelUrlWithKey(origin = window.location.origin) {
  const key = getGrantedKey();
  const base = origin.replace(/\/$/, "");
  if (isAspNet()) {
    return `${base}/Home/Index?k=${encodeURIComponent(key)}`;
  }
  return `${base}${siteDir()}?k=${encodeURIComponent(key)}`;
}

export function qrPageHref() {
  const key = getGrantedKey();
  if (isAspNet()) {
    return `/Home/Qr?k=${encodeURIComponent(key)}`;
  }
  return `qr.html?k=${encodeURIComponent(key)}`;
}

export function panelPageHref() {
  const key = getGrantedKey();
  if (isAspNet()) {
    return `/Home/Index?k=${encodeURIComponent(key)}`;
  }
  return `./?k=${encodeURIComponent(key)}`;
}
