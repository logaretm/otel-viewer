import * as Sentry from '@sentry/browser';
// Room credentials travel in URLs (the receive token as `?token=`, the room ID
// as a path segment), and Sentry collects URLs from breadcrumbs, spans and the
// page itself. The redaction is shared with the worker and the CLI so one fix
// covers every surface: anyone reading those values out of an event could join
// or write to a stranger's room.
import { METRIC, redactUrl } from '../../../shared/observability';

export default defineNuxtPlugin((nuxtApp) => {
  const config = useRuntimeConfig();
  const dsn = config.public.sentryDsn;

  if (!dsn) return;

  Sentry.init({
    dsn,
    environment: config.public.sentryEnvironment,
    release: config.public.cliVersion,
    tracesSampleRate: 0.1,
    // Telemetry in a room belongs to whoever is being debugged. v11 removed
    // sendDefaultPii and its dataCollection defaults are permissive, so every
    // category is named here rather than inherited.
    dataCollection: {
      userInfo: false,
      cookies: false,
      urlQueryParams: false,
      httpHeaders: { request: false, response: false },
      httpBodies: [],
      genAI: { inputs: false, outputs: false },
      databaseQueryData: false,
      graphQL: { document: false, variables: false },
    },
    integrations: [Sentry.browserTracingIntegration()],

    beforeBreadcrumb(breadcrumb) {
      if (typeof breadcrumb.data?.url === 'string') {
        breadcrumb.data.url = redactUrl(breadcrumb.data.url);
      }
      // Navigation breadcrumbs carry the room ID in from/to.
      for (const key of ['from', 'to'] as const) {
        if (typeof breadcrumb.data?.[key] === 'string') {
          breadcrumb.data[key] = redactUrl(breadcrumb.data[key]);
        }
      }
      // Console breadcrumbs are free-form and this app logs URLs into them.
      if (breadcrumb.category === 'console' && breadcrumb.message) {
        breadcrumb.message = redactUrl(breadcrumb.message);
      }

      return breadcrumb;
    },

    beforeSend(event) {
      if (event.request?.url) {
        event.request.url = redactUrl(event.request.url);
      }

      return event;
    },
  });

  Sentry.metrics.count(METRIC.SESSION_STARTED, 1, {
    attributes: { surface: 'web', mode: 'dashboard', transport: 'relay' },
  });

  // @sentry/browser has no Vue integration, so component errors have to be
  // forwarded by hand or they never reach Sentry at all.
  nuxtApp.vueApp.config.errorHandler = (error, _instance, info) => {
    Sentry.captureException(error, { extra: { lifecycleHook: info } });
    console.error('[Vue]', error);
  };

  nuxtApp.hook('app:error', (error) => {
    Sentry.captureException(error);
  });
});
