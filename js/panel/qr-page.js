import { hasAccess, panelUrlWithKey, panelPageHref } from "./access.js?v=10";

const lockScreen = document.getElementById("lock-screen");
const qrPage = document.getElementById("qr-page");

const allowed = await hasAccess();

if (!allowed) {
  if (lockScreen) lockScreen.hidden = false;
  if (qrPage) qrPage.hidden = true;
} else {
  if (lockScreen) lockScreen.hidden = true;
  if (qrPage) qrPage.hidden = false;

  const target = panelUrlWithKey();
  const urlEl = document.getElementById("qr-url");
  const img = document.getElementById("qr-img");
  const openLink = document.getElementById("link-panel");

  if (urlEl) urlEl.textContent = target;
  if (img) {
    img.src =
      "https://api.qrserver.com/v1/create-qr-code/?size=240x240&margin=8&data=" +
      encodeURIComponent(target);
  }
  if (openLink) openLink.href = panelPageHref();

  const copyBtn = document.getElementById("btn-copy-url");
  if (copyBtn) {
    copyBtn.addEventListener("click", async function () {
      try {
        await navigator.clipboard.writeText(target);
        this.textContent = "Скопійовано";
        const btn = this;
        setTimeout(() => {
          btn.textContent = "Скопіювати посилання";
        }, 1600);
      } catch {
        prompt("Скопіюй посилання:", target);
      }
    });
  }
}
