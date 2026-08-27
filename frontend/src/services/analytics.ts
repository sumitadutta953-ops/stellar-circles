/**
 * analytics.ts
 * ──────────────────────────────────────────────────────────────────────────
 * PostHog product analytics + Sentry error monitoring for Stellar Circles.
 *
 * Events tracked:
 *   Connect Wallet Clicked  { method }
 *   Wallet Connected        { method, address }
 *   Circle Creation Initiated
 *   Circle Created          { circleId, txHash }
 *   Join Circle Initiated   { inviteCode }
 *   Circle Joined           { circleId, txHash }
 *   Contribution Initiated  { circleId }
 *   Contribution Successful { circleId, txHash }
 *   Payout Auto-Triggered   { circleId, cycle, txHash }
 *   Circle Left             { circleId }
 *   Circle Deleted (Last Member Left) { circleId }
 * ──────────────────────────────────────────────────────────────────────────
 */

declare global {
  interface Window {
    posthog?: any;
  }
}

let posthogLoaded = false;

export function initAnalytics() {
  if (typeof window === 'undefined') return;

  const POSTHOG_KEY  = import.meta.env.VITE_POSTHOG_KEY  || '';
  const POSTHOG_HOST = import.meta.env.VITE_POSTHOG_HOST || 'https://app.posthog.com';
  const SENTRY_DSN   = import.meta.env.VITE_SENTRY_DSN   || '';

  // ── PostHog ────────────────────────────────────────────────────────────
  if (POSTHOG_KEY) {
    // Load PostHog snippet inline (no extra npm package needed)
    (function (t, e) {
      // @ts-ignore
      if (!t.posthog) {
        // @ts-ignore
        const n = t.posthog = function (...args: any[]) { n.q = n.q || []; n.q.push(args); };
        // @ts-ignore
        const o = e.createElement('script');
        o.type = 'text/javascript';
        o.async = true;
        o.src = `${POSTHOG_HOST}/static/array.js`;
        // @ts-ignore
        const a = e.getElementsByTagName('script')[0];
        a.parentNode?.insertBefore(o, a);
        // @ts-ignore
        n._i = []; n.init = function (k: string, cfg: any, name?: string) {
          // @ts-ignore
          function m(t: any, e: string) { const n = e.split('.'); if (n.length === 2) { t = t[n[0]]; e = n[1]; } t[e] = function () { t.push([e].concat(Array.prototype.slice.call(arguments, 0))); }; }
          // @ts-ignore
          const l = n;
          ['capture','identify','alias','people.set','people.set_once','set','register','register_once','feature_flags.override','onFeatureFlags'].forEach((e) => m(l, e));
          // @ts-ignore
          n._i.push([k, cfg, name]);
        };
        // @ts-ignore
        n.__SV = 1;
      }
    })(window, document);

    window.posthog.init(POSTHOG_KEY, {
      api_host: POSTHOG_HOST,
      capture_pageview: true,
      capture_pageleave: true,
      autocapture: false, // manual events only — we don't want PII captured
      persistence: 'localStorage',
    });

    posthogLoaded = true;
    console.info('[Analytics] PostHog initialized.');
  } else {
    console.warn('[Analytics] VITE_POSTHOG_KEY not set — analytics in console-only mode.');
  }

  // ── Sentry ─────────────────────────────────────────────────────────────
  if (SENTRY_DSN) {
    // Lazy-load Sentry to avoid adding it to the main bundle
    import('https://browser.sentry-cdn.com/7.99.0/bundle.min.js' as any)
      .catch(() => {
        // Sentry CDN load failed — not critical
        console.warn('[Analytics] Sentry CDN load failed, error tracking disabled.');
      });
    console.info('[Analytics] Sentry DSN configured.');
  } else {
    console.warn('[Analytics] VITE_SENTRY_DSN not set — error tracking in console-only mode.');
  }
}

export function trackEvent(eventName: string, properties?: Record<string, any>) {
  if (posthogLoaded && window.posthog) {
    window.posthog.capture(eventName, properties);
  }
  console.log(`[Analytics] ${eventName}`, properties);
}

export function identifyUser(userId: string, properties?: Record<string, any>) {
  if (posthogLoaded && window.posthog) {
    window.posthog.identify(userId, properties);
  }
  console.log(`[Analytics] Identify User ${userId}`, properties);
}

export function captureError(error: Error | string | any, context?: Record<string, any>) {
  console.error('[Error]', error, context);
  // Sentry global error capture (when loaded)
  if (typeof window !== 'undefined' && (window as any).Sentry) {
    (window as any).Sentry.captureException(error, { extra: context });
  }
}
