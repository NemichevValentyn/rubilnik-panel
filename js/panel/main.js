import {
  PANEL_INFO,
  ENCRYPTED_BREAKERS,
  setBreakers,
} from "./panel-data.js?v=6";
import { hasAccess, qrPageHref, getGrantedKey } from "./access.js?v=6";
import { decryptBreakers } from "./crypto.js?v=6";
import { PanelScene } from "./panel-scene.js?v=6";

const lockScreen = document.getElementById("lock-screen");
const appRoot =
  document.getElementById("panel-app") || document.querySelector(".panel-app");

const allowed = await hasAccess();

if (!allowed) {
  if (lockScreen) lockScreen.hidden = false;
  if (appRoot) appRoot.hidden = true;
} else {
  try {
    const list = await decryptBreakers(getGrantedKey(), ENCRYPTED_BREAKERS);
    setBreakers(list);
  } catch (err) {
    console.error(err);
    if (lockScreen) {
      lockScreen.hidden = false;
      const p = lockScreen.querySelector("p");
      if (p) p.textContent = "Не вдалося розшифрувати дані щитка.";
    }
    if (appRoot) appRoot.hidden = true;
    throw err;
  }

  if (lockScreen) lockScreen.hidden = true;
  if (appRoot) appRoot.hidden = false;

  const canvas = document.getElementById("panel-canvas");
  if (!canvas) {
    throw new Error("Canvas #panel-canvas not found");
  }

  const titleEl = document.getElementById("panel-title");
  if (titleEl) titleEl.textContent = PANEL_INFO.title;

  const qrLink = document.getElementById("link-qr");
  if (qrLink) qrLink.href = qrPageHref();

  const ui = {
    hint: document.getElementById("panel-hint"),
    openBtn: document.getElementById("btn-toggle-door"),
    resetBtn: document.getElementById("btn-reset-view"),
    infoCard: document.getElementById("info-card"),
    infoTitle: document.getElementById("info-title"),
    infoLabel: document.getElementById("info-label"),
    infoDesc: document.getElementById("info-desc"),
    closeInfoBtn: document.getElementById("btn-close-info"),
  };

  document.body.addEventListener(
    "touchmove",
    (e) => {
      if (e.target === canvas || canvas.contains(e.target)) {
        e.preventDefault();
      }
    },
    { passive: false }
  );

  new PanelScene(canvas, ui);
}
