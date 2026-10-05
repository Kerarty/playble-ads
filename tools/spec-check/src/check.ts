/**
 * Static validation of a built playable.
 *
 * Ad networks reject units at upload review, days after the creative is done,
 * and the reasons are mechanical: too many bytes, an external request, a
 * missing exit call. All of those can be checked in CI in under a second, so
 * this check runs on every build.
 *
 * The rule this file follows: only report what can be proven from the file
 * itself. Anything needing a live container is listed as a warning with a
 * reason, never silently passed.
 */

export type Severity = 'error' | 'warning';

export interface Finding {
  severity: Severity;
  /** Machine readable rule id, e.g. `size/exceeds-meta`. */
  rule: string;
  network: string;
  message: string;
  /** How to fix it. */
  hint?: string;
}

export interface NetworkSpec {
  id: string;
  name: string;
  /** Published cap in bytes, or null when the network publishes none. */
  maxBytes: number | null;
  /** The exit call this network expects, as it appears in the bundle. */
  exitCall: string;
  /** MRAID must not appear at all (Meta rejects the file outright). */
  forbidsMraid: boolean;
}

export interface CheckInput {
  /** The built file's contents. */
  html: string;
  /** Raw byte length. */
  bytes: number;
  specs: readonly NetworkSpec[];
  /**
   * Which network this artefact is built for, when known. Determines which exit
   * call is required. Omit to check size and packaging only.
   */
  forNetwork?: string;
}

export interface CheckResult {
  ok: boolean;
  findings: Finding[];
  /** Bytes, and the biggest network that would accept it. */
  size: { bytes: number; largestAccepting: string | null };
}

const KB = 1024;
const MB = 1024 * 1024;

function human(bytes: number): string {
  if (bytes >= MB) return `${(bytes / MB).toFixed(2)} MB`;
  if (bytes >= KB) return `${(bytes / KB).toFixed(1)} KB`;
  return `${bytes} B`;
}

/**
 * Finds URLs the bundle would fetch at runtime.
 *
 * Looks for the patterns that survive minification: `http(s)://` literals,
 * protocol-relative URLs, and `src`/`href` attributes pointing off-file. Data
 * and blob URLs are fine - a playable inlines its own assets that way.
 */
export function findExternalUrls(html: string): string[] {
  const found = new Set<string>();

  const absolute = /["'(]\s*(https?:)?\/\/[A-Za-z0-9._-]+\.[A-Za-z]{2,}[^"'\s)]*/g;
  for (const match of html.matchAll(absolute)) {
    const url = match[0].replace(/^["'(]\s*/, '');
    found.add(url);
  }

  // `src="..."` / `href="..."` that are not data:, blob: or #.
  const attrs = /\b(?:src|href)\s*=\s*["']([^"']+)["']/gi;
  for (const match of html.matchAll(attrs)) {
    const url = match[1];
    if (!url) continue;
    if (/^(data:|blob:|#)/i.test(url)) continue;
    found.add(url);
  }

  return [...found];
}

/**
 * Runs every check.
 *
 * `ok` is false only when there is at least one error. Warnings are for the
 * things a human has to confirm.
 */
export function checkPlayable(input: CheckInput): CheckResult {
  const findings: Finding[] = [];
  const { html, bytes, specs, forNetwork } = input;

  // --- Size -------------------------------------------------------------
  const accepting = specs.filter((s) => s.maxBytes === null || bytes <= s.maxBytes);
  const smallest = specs
    .filter((s) => s.maxBytes !== null)
    .sort((a, b) => (a.maxBytes ?? 0) - (b.maxBytes ?? 0))[0];

  for (const spec of specs) {
    if (spec.maxBytes === null) continue;
    if (bytes > spec.maxBytes) {
      findings.push({
        severity: 'error',
        rule: `size/exceeds-${spec.id}`,
        network: spec.name,
        message: `${human(bytes)} exceeds the ${spec.name} limit of ${human(spec.maxBytes)} by ${human(bytes - spec.maxBytes)}`,
        hint: 'Convert images to WebP, re-encode audio as mono, and subset the font. Video is usually the largest single win.',
      });
    }
  }

  if (accepting.length === 0 && specs.length > 0) {
    findings.push({
      severity: 'error',
      rule: 'size/no-network-accepts',
      network: 'all',
      message: `No supported network would accept a ${human(bytes)} unit`,
    });
  }

  const size = {
    bytes,
    // The network with the most generous cap that would still take this unit.
    // Sorted by cap rather than by list position, because the list order is
    // about detection, not about size.
    largestAccepting: accepting
      .slice()
      .sort((a, b) => (b.maxBytes ?? Number.POSITIVE_INFINITY) - (a.maxBytes ?? Number.POSITIVE_INFINITY))[0]?.name ?? null,
  };

  // A warning when we clear the bar but only just: that usually means the
  // next asset added will break it.
  if (smallest?.maxBytes != null && bytes > smallest.maxBytes * 0.9) {
    findings.push({
      severity: 'warning',
      rule: 'size/headroom-low',
      network: smallest.name,
      message: `Only ${human(smallest.maxBytes - bytes)} of headroom under the ${smallest.name} limit`,
      hint: 'Worth trimming now rather than after the next asset lands.',
    });
  }

  // --- External requests ------------------------------------------------
  const urls = findExternalUrls(html);
  for (const url of urls) {
    findings.push({
      severity: 'error',
      rule: 'network/external-request',
      network: 'all',
      message: `Found an external URL: ${url}`,
      hint: 'Playable ads may not make network requests. Inline the asset or remove the reference.',
    });
  }

  // --- Exit call -------------------------------------------------------
  // Checked against the networks this artefact is actually built for. A Meta
  // build legitimately contains no `mraid.open`, and reporting that would train
  // us to ignore the output.
  if (forNetwork) {
    const spec = specs.find((s) => s.id === forNetwork);
    if (spec && !html.includes(spec.exitCall)) {
      findings.push({
        severity: 'error',
        rule: `exit/missing-${spec.id}`,
        network: spec.name,
        message: `This is a ${spec.name} build but "${spec.exitCall}" is not in the bundle`,
        hint: 'The adapter for the target network did not make it into the build.',
      });
    }
  }

  // --- MRAID ------------------------------------------------------------
  // Meta forbids the MRAID *library* in a playable: a reference to the `mraid`
  // global, or the calls made on it. It does not forbid our own profile field
  // named `requiresMraid`, which appears in every bundle and is a property name,
  // not a MRAID call. So this checks for actual usage:
  //
  //   window.mraid / win.mraid   - reading the global
  //   mraid.open / .close / ...  - calling it
  //
  // Both together catch an adapter that survived tree shaking, which is the case
  // that actually gets a unit rejected.
  const mraidUsage: Array<{ pattern: RegExp; what: string }> = [
    { pattern: /\bmraid\s*\.\s*(open|close|getVersion|isAvailable|setVolume|resize|setPreferredOrientation)\b/i, what: 'a MRAID method call' },
    { pattern: /\b(?:win|window|this|self)\s*\.\s*mraid\b/i, what: 'a read of the MRAID global' },
    { pattern: /["'`]mraidready["'`]/i, what: 'the MRAID ready event' },
  ];

  const mraidHits = mraidUsage.filter(({ pattern }) => pattern.test(html));

  // Only applicable to a Meta artefact. A build that contains MRAID code is
  // correct for AppLovin and Unity and merely unusable on Meta, so flagging it
  // unconditionally would mean failing every build that is meant for them.
  if (mraidHits.length > 0 && forNetwork === 'meta') {
    findings.push({
      severity: 'error',
      rule: 'meta/mraid-present',
      network: 'Meta (Facebook / Instagram)',
      message: `The bundle contains ${mraidHits.map((h) => h.what).join(' and ')}; Meta forbids MRAID entirely`,
      hint: 'The MRAID adapter has to be absent from the module graph, not merely unused. Build a separate Meta artefact.',
    });
  } else if (mraidHits.length > 0 && forNetwork === undefined) {
    findings.push({
      severity: 'warning',
      rule: 'meta/mraid-present',
      network: 'Meta (Facebook / Instagram)',
      message: `The bundle contains ${mraidHits.map((h) => h.what).join(' and ')}, so it cannot be uploaded to Meta`,
      hint: 'Use the Meta artefact (meta.html) for Meta and Moloco.',
    });
  }

  // --- Packaging --------------------------------------------------------
  if (/<script[^>]+src\s*=/i.test(html)) {
    findings.push({
      severity: 'error',
      rule: 'package/external-script',
      network: 'all',
      message: 'The unit loads an external script file',
      hint: 'Every network needs a single self-contained HTML file.',
    });
  }

  const ok = !findings.some((f) => f.severity === 'error');

  return { ok, findings, size };
}
