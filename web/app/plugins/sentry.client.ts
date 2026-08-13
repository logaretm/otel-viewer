import * as Sentry from '@sentry/browser';

/**
 * Room credentials travel in URLs: the receive token as `?token=`, the room ID
 * as a path segment on `/r/:id` and `/live/:id`. Sentry collects URLs from
 * breadcrumbs, spans and the page itself, so every URL leaving this app gets
 * redacted first. Anyone reading these two values out of an event could join or
 * write to a stranger's room.
 */
function redactUrl(value: string): string {
  let out = value.replace(
    /([?&](?:token|receiveToken)=)[^&#]*/gi,
    '$1[redacted]',
  );
  out = out.replace(/(\/(?:r|live|shared)\/)([^/?#]+)/gi, (_, prefix, id) => {
    return `${prefix}${String(id).slice(0, 4)}...`;
  });

  return out;
}

export default defineNuxtPlugin((nuxtApp) => {
  const config = useRuntimeConfig();
  const dsn = config.public.sentryDsn;

  if (!dsn) return;

  Sentry.init({
    dsn,
    environment: config.public.sentryEnvironment,
    release: config.public.cliVersion,
    enableLogs: true,
    tracesSampleRate: 1.0,
    // Telemetry in a room belongs to whoever is being debugged. Never let it,
    // or anything identifying its owner, ride along into our own project.
    sendDefaultPii: false,
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
