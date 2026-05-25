/**
 * @file Opt-in usage analytics via Umami (self-hosted, cookieless).
 * Consent is stored in localStorage. Nothing is sent unless the user accepts.
 */

/** @type {string} */
const ANALYTICS_CONSENT_KEY = "snapatlas-analytics-consent";

/**
 * Analytics interface.
 * @type {{
 *   consent: boolean,
 *   track(name: string, data?: Object): void
 * }}
 */
const analytics = {
  /** @returns {boolean} */
  get consent() {
    return localStorage.getItem(ANALYTICS_CONSENT_KEY) === "true";
  },

  /** @param {boolean} val */
  set consent(val) {
    localStorage.setItem(ANALYTICS_CONSENT_KEY, val ? "true" : "false");
    if (val) this.track("consent_given");
  },

  /**
   * Track an event if consent has been given.
   * @param {string} name  Event name
   * @param {Object} [data]  Optional event data
   */
  track(name, data) {
    if (!this.consent) return;
    try {
      if (window.umami?.track) {
        window.umami.track(name, data ?? {});
      }
    } catch {}
  },
};

/**
 * Show the one-time consent banner at the bottom of the page.
 * Does nothing if the user has already accepted or declined.
 */
function initAnalyticsBanner() {
  if (localStorage.getItem(ANALYTICS_CONSENT_KEY) !== null) return;
  const banner = document.getElementById("analytics-banner");
  if (!banner) return;
  banner.style.display = "flex";

  document.getElementById("analytics-accept")?.addEventListener("click", () => {
    analytics.consent = true;
    banner.style.display = "none";
  });
  document.getElementById("analytics-decline")?.addEventListener("click", () => {
    analytics.consent = false;
    banner.style.display = "none";
  });
}
