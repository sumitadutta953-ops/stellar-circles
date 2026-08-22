// analytics.ts - PostHog & Sentry Init

export function initAnalytics() {
  // In a real application, replace with actual environment variables
  const POSTHOG_KEY = import.meta.env.VITE_POSTHOG_KEY || 'phc_mock_key';
  const POSTHOG_HOST = import.meta.env.VITE_POSTHOG_HOST || 'https://app.posthog.com';
  const SENTRY_DSN = import.meta.env.VITE_SENTRY_DSN || '';

  if (typeof window !== 'undefined') {
    // Sentry initialization mock
    if (SENTRY_DSN) {
      console.log('Sentry initialized with DSN:', SENTRY_DSN);
    } else {
      console.warn('Sentry DSN missing, error tracking disabled.');
    }

    // PostHog initialization mock
    console.log(`PostHog initialized at ${POSTHOG_HOST} with key ${POSTHOG_KEY}`);
  }
}

export function trackEvent(eventName: string, properties?: Record<string, any>) {
  console.log(`[Analytics] ${eventName}`, properties);
  // posthog.capture(eventName, properties);
}

export function identifyUser(userId: string, properties?: Record<string, any>) {
  console.log(`[Analytics] Identify User ${userId}`, properties);
  // posthog.identify(userId, properties);
}

export function captureError(error: Error | string, context?: Record<string, any>) {
  console.error(`[Sentry Error]`, error, context);
  // Sentry.captureException(error, { extra: context });
}
