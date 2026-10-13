/**
 * @file src/services/errorReporting.ts
 *
 * Single place where crashes are reported. Today it logs; when Sentry is added
 * (@sentry/react-native + DSN + new EAS build), call Sentry.captureException
 * inside `reportError` and nothing else needs to change.
 */

type ErrorContext = Record<string, unknown>;

export function reportError(error: unknown, context: ErrorContext = {}): void {
  const err = error instanceof Error ? error : new Error(String(error));
  console.error('[ErrorReporting]', err.message, { ...context, stack: err.stack });
}

let installed = false;

/** Reports uncaught JS errors (outside React render) before the default handler runs. */
export function installGlobalErrorHandler(): void {
  if (installed) return;
  const errorUtils = (globalThis as { ErrorUtils?: {
    getGlobalHandler: () => (error: Error, isFatal?: boolean) => void;
    setGlobalHandler: (handler: (error: Error, isFatal?: boolean) => void) => void;
  } }).ErrorUtils;
  if (!errorUtils) return;

  const previous = errorUtils.getGlobalHandler();
  errorUtils.setGlobalHandler((error, isFatal) => {
    reportError(error, { source: 'global', isFatal: Boolean(isFatal) });
    previous(error, isFatal);
  });
  installed = true;
}
