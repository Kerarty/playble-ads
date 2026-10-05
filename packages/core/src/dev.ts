/**
 * Development guards.
 *
 * Every ad network bans external requests in a playable: no analytics beacons,
 * no CDN fonts, no remote images. A single stray `fetch` can get the unit
 * rejected, and it is invisible until upload review.
 *
 * The guard therefore makes the first stray request a loud, immediate error in
 * the browser instead of a rejection two days later. It is only installed when
 * `debug: true`.
 */

export type GuardViolation = {
  api: string;
  url: string;
  stack?: string | undefined;
};

export type GuardReporter = (violation: GuardViolation) => void;

/** Schemes a playable is allowed to load from its own single-file bundle. */
const ALLOWED_SCHEME = /^(data:|blob:)/i;

function isAllowed(url: string): boolean {
  if (ALLOWED_SCHEME.test(url)) return true;
  // Same-document navigations are not asset requests.
  if (url.startsWith(location.origin)) return true;
  return false;
}

/**
 * Wraps the network APIs a playable could use and reports anything that leaves
 * the bundle. Returns a function that puts the originals back.
 */
export function installExternalRequestGuard(win: Window, report: GuardReporter): () => void {
  const restorers: (() => void)[] = [];

  // `Window` does not declare XMLHttpRequest / Image / WebSocket, so we widen it
  // once here instead of scattering casts through the file.
  const w = win as Window & typeof globalThis;

  const check = (api: string, url: unknown): void => {
    if (typeof url !== 'string') return;
    if (isAllowed(url)) return;
    report({ api, url, stack: new Error().stack });
  };

  const globalScope = w as unknown as Record<string, unknown>;

  const originalFetch = w.fetch;
  if (typeof originalFetch === 'function') {
    w.fetch = function guardedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      check('fetch', url);
      return originalFetch.call(w, input, init);
    };
    restorers.push(() => {
      w.fetch = originalFetch;
    });
  }

  const originalOpen = w.XMLHttpRequest?.prototype.open;
  if (originalOpen) {
    w.XMLHttpRequest.prototype.open = function guardedOpen(
      this: XMLHttpRequest,
      method: string,
      url: string | URL,
      ...rest: unknown[]
    ): void {
      check('XMLHttpRequest', typeof url === 'string' ? url : url.href);
      (originalOpen as unknown as (...a: unknown[]) => void).apply(this, [method, url, ...rest]);
    } as typeof originalOpen;
    restorers.push(() => {
      w.XMLHttpRequest.prototype.open = originalOpen;
    });
  }

  const originalSendBeacon = w.navigator?.sendBeacon;
  if (originalSendBeacon) {
    w.navigator.sendBeacon = function guardedSendBeacon(url: string | URL, data?: BodyInit | null): boolean {
      check('navigator.sendBeacon', typeof url === 'string' ? url : url.href);
      return originalSendBeacon.call(w.navigator, url, data);
    };
    restorers.push(() => {
      w.navigator.sendBeacon = originalSendBeacon;
    });
  }

  const ImageCtor = w.Image;
  if (ImageCtor) {
    const descriptor = Object.getOwnPropertyDescriptor(ImageCtor.prototype, 'src');
    if (descriptor?.set) {
      const originalSet = descriptor.set;
      Object.defineProperty(ImageCtor.prototype, 'src', {
        ...descriptor,
        set(this: HTMLImageElement, value: string) {
          check('Image.src', value);
          originalSet.call(this, value);
        },
      });
      restorers.push(() => {
        Object.defineProperty(ImageCtor.prototype, 'src', descriptor);
      });
    }
  }

  const originalWebSocket = w.WebSocket;
  if (originalWebSocket) {
    class GuardedWebSocket extends originalWebSocket {
      constructor(url: string | URL, protocols?: string | string[]) {
        check('WebSocket', typeof url === 'string' ? url : url.href);
        super(url, protocols);
      }
    }
    globalScope['WebSocket'] = GuardedWebSocket;
    restorers.push(() => {
      globalScope['WebSocket'] = originalWebSocket;
    });
  }

  const originalEventSource = w.EventSource;
  if (originalEventSource) {
    class GuardedEventSource extends originalEventSource {
      constructor(url: string | URL, init?: EventSourceInit) {
        check('EventSource', typeof url === 'string' ? url : url.href);
        super(url, init);
      }
    }
    globalScope['EventSource'] = GuardedEventSource;
    restorers.push(() => {
      globalScope['EventSource'] = originalEventSource;
    });
  }

  return () => {
    for (const restore of restorers.reverse()) restore();
  };
}
