import { describe, expect, it } from 'vitest';
import { checkPlayable, findExternalUrls, type NetworkSpec } from './check.js';

const META: NetworkSpec = {
  id: 'meta',
  name: 'Meta',
  maxBytes: 2 * 1024 * 1024,
  exitCall: 'onCTAClick',
  forbidsMraid: true,
};

const UNITY: NetworkSpec = {
  id: 'unity',
  name: 'Unity Ads',
  maxBytes: 5 * 1024 * 1024,
  exitCall: 'mraid.open',
  forbidsMraid: false,
};

const LIFTOFF: NetworkSpec = {
  id: 'liftoff',
  name: 'Liftoff',
  maxBytes: 700 * 1024,
  exitCall: 'download',
  forbidsMraid: false,
};

const SPECS = [META, UNITY, LIFTOFF];

/**
 * A minimal single-file unit that passes every check.
 *
 * Includes MRAID usage, so it models the shared dev bundle rather than a Meta
 * artefact; the MRAID-specific tests below vary this.
 */
function goodHtml(): string {
  return [
    '<!doctype html><html><head><title>x</title></head><body>',
    '<div id="playble-root"></div>',
    '<script>mraid.open();FbPlayableAd.onCTAClick();</script>',
    '</body></html>',
  ].join('');
}

/** A Meta-safe unit: no MRAID usage at all. */
function metaHtml(): string {
  return [
    '<!doctype html><html><head><title>x</title></head><body>',
    '<div id="playble-root"></div>',
    '<script>FbPlayableAd.onCTAClick();</script>',
    '</body></html>',
  ].join('');
}

describe('findExternalUrls', () => {
  it('finds an absolute URL in a string literal', () => {
    expect(findExternalUrls('fetch("https://cdn.example.com/a.js")')).toContain('https://cdn.example.com/a.js');
  });

  it('finds a protocol-relative URL', () => {
    expect(findExternalUrls('src="//cdn.example.com/a.png"')).toContain('//cdn.example.com/a.png');
  });

  it('ignores data URLs', () => {
    expect(findExternalUrls('<img src="data:image/png;base64,AAA">')).toHaveLength(0);
  });

  it('ignores blob URLs', () => {
    expect(findExternalUrls('<img src="blob:https://x/y">')).toHaveLength(0);
  });

  it('ignores fragment links', () => {
    expect(findExternalUrls('<a href="#cta">install</a>')).toHaveLength(0);
  });

  it('deduplicates repeated URLs', () => {
    const html = 'a("https://x.test/1");b("https://x.test/1")';
    expect(findExternalUrls(html)).toHaveLength(1);
  });
});

describe('checkPlayable: size', () => {
  it('passes a small unit', () => {
    // Meta-safe HTML: this test is about size, so it must not trip the MRAID
    // rule that the shared dev bundle would.
    const result = checkPlayable({ html: metaHtml(), bytes: 500_000, specs: SPECS, forNetwork: 'meta' });
    expect(result.ok).toBe(true);
  });

  it('fails over the Meta limit', () => {
    const result = checkPlayable({ html: goodHtml(), bytes: 3 * 1024 * 1024, specs: SPECS, forNetwork: 'meta' });
    expect(result.ok).toBe(false);
    expect(result.findings.some((f) => f.rule === 'size/exceeds-meta')).toBe(true);
  });

  it('reports each network that rejects the unit', () => {
    // 2.5MB: over Meta's 2MB and Liftoff's 700KB, under Unity's 5MB.
    const result = checkPlayable({ html: goodHtml(), bytes: 2.5 * 1024 * 1024, specs: SPECS });
    const rules = result.findings.filter((f) => f.severity === 'error').map((f) => f.rule);
    expect(rules).toContain('size/exceeds-meta');
    expect(rules).toContain('size/exceeds-liftoff');
    expect(rules).not.toContain('size/exceeds-unity');
  });

  it('fails when no network accepts the unit', () => {
    const result = checkPlayable({ html: goodHtml(), bytes: 9 * 1024 * 1024, specs: SPECS });
    expect(result.findings.some((f) => f.rule === 'size/no-network-accepts')).toBe(true);
  });

  it('warns when headroom under the smallest limit is thin', () => {
    // 640KB is over 90% of Liftoff's 700KB but still accepted.
    const result = checkPlayable({ html: goodHtml(), bytes: 640 * 1024, specs: SPECS });
    expect(result.ok).toBe(true);
    expect(result.findings.some((f) => f.rule === 'size/headroom-low')).toBe(true);
  });

  it('ignores networks that publish no cap', () => {
    const noCap: NetworkSpec = { ...UNITY, id: 'chartboost', maxBytes: null };
    const result = checkPlayable({ html: goodHtml(), bytes: 8 * 1024 * 1024, specs: [META, noCap] });
    expect(result.findings.some((f) => f.rule.includes('chartboost'))).toBe(false);
  });
});

describe('checkPlayable: external requests', () => {
  it('fails on a CDN reference', () => {
    const html = metaHtml().replace('</body>', '<img src="https://cdn.example.com/x.png"></body>');
    const result = checkPlayable({ html, bytes: 500_000, specs: SPECS, forNetwork: 'meta' });
    expect(result.ok).toBe(false);
    expect(result.findings.some((f) => f.rule === 'network/external-request')).toBe(true);
  });

  it('passes with only inline data-URL assets', () => {
    const html = metaHtml().replace('</body>', '<img src="data:image/png;base64,AAAA"></body>');
    expect(checkPlayable({ html, bytes: 500_000, specs: SPECS, forNetwork: 'meta' }).ok).toBe(true);
  });

  it('fails when a font is fetched from a CDN', () => {
    const html = metaHtml().replace('</body>', '<link href="https://fonts.test/x.css" rel="stylesheet"></body>');
    expect(checkPlayable({ html, bytes: 500_000, specs: SPECS, forNetwork: 'meta' }).ok).toBe(false);
  });
});

describe('checkPlayable: packaging', () => {
  it('fails on an external script tag', () => {
    const html = goodHtml().replace('</body>', '<script src="game.js"></script></body>');
    const result = checkPlayable({ html, bytes: 500_000, specs: SPECS, forNetwork: 'meta' });
    expect(result.findings.some((f) => f.rule === 'package/external-script')).toBe(true);
  });

  it('passes when the script is inline', () => {
    const result = checkPlayable({ html: metaHtml(), bytes: 500_000, specs: SPECS, forNetwork: 'meta' });
    expect(result.findings.some((f) => f.rule === 'package/external-script')).toBe(false);
  });
});

describe('checkPlayable: MRAID', () => {
  it('errors when a MRAID build is checked as Meta', () => {
    const result = checkPlayable({ html: goodHtml(), bytes: 500_000, specs: SPECS, forNetwork: 'meta' });
    expect(result.ok).toBe(false);
    expect(result.findings.some((f) => f.rule === 'meta/mraid-present' && f.severity === 'error')).toBe(true);
  });

  it('does not error when the same bundle is checked as a MRAID network', () => {
    const result = checkPlayable({ html: goodHtml(), bytes: 500_000, specs: SPECS, forNetwork: 'unity' });
    expect(result.findings.some((f) => f.rule === 'meta/mraid-present' && f.severity === 'error')).toBe(false);
  });

  it('warns when no target is stated', () => {
    const result = checkPlayable({ html: goodHtml(), bytes: 500_000, specs: SPECS });
    const finding = result.findings.find((f) => f.rule === 'meta/mraid-present');
    expect(finding?.severity).toBe('warning');
  });

  it('does not flag our own requiresMraid profile field', () => {
    // The field name appears in every bundle and is not a MRAID call.
    const html = goodHtml().replace('mraid.open();', 'x={requiresMraid:!1};');
    const result = checkPlayable({ html, bytes: 500_000, specs: SPECS, forNetwork: 'meta' });
    expect(result.findings.some((f) => f.rule === 'meta/mraid-present')).toBe(false);
  });

  it('passes a real Meta bundle', () => {
    const result = checkPlayable({ html: metaHtml(), bytes: 500_000, specs: SPECS, forNetwork: 'meta' });
    expect(result.ok).toBe(true);
  });

  it('catches a read of the MRAID global, not just method calls', () => {
    const html = metaHtml().replace('FbPlayableAd.onCTAClick();', 'window.mraid;FbPlayableAd.onCTAClick();');
    const result = checkPlayable({ html, bytes: 500_000, specs: SPECS, forNetwork: 'meta' });
    expect(result.findings.some((f) => f.rule === 'meta/mraid-present')).toBe(true);
  });

  it('catches the MRAID ready event', () => {
    const html = metaHtml().replace('FbPlayableAd.onCTAClick();', `addEventListener("mraidready",f);FbPlayableAd.onCTAClick();`);
    const result = checkPlayable({ html, bytes: 500_000, specs: SPECS, forNetwork: 'meta' });
    expect(result.findings.some((f) => f.rule === 'meta/mraid-present')).toBe(true);
  });
});

describe('checkPlayable: exit call', () => {
  it('errors when the target network has no exit call in the bundle', () => {
    const html = '<!doctype html><html><body><script>const a=1;</script></body></html>';
    const result = checkPlayable({ html, bytes: 100_000, specs: SPECS, forNetwork: 'meta' });
    expect(result.ok).toBe(false);
    expect(result.findings.some((f) => f.rule === 'exit/missing-meta')).toBe(true);
  });

  it('passes when the exit call is present', () => {
    const result = checkPlayable({ html: metaHtml(), bytes: 100_000, specs: SPECS, forNetwork: 'meta' });
    expect(result.findings.some((f) => f.rule === 'exit/missing-meta')).toBe(false);
  });

  it('skips the check when no target is stated', () => {
    const html = '<!doctype html><html><body><script>const a=1;</script></body></html>';
    const result = checkPlayable({ html, bytes: 100_000, specs: SPECS });
    expect(result.findings.some((f) => f.rule.startsWith('exit/'))).toBe(false);
  });
});

describe('checkPlayable: result shape', () => {
  it('reports the largest accepting network', () => {
    // 500KB clears every cap in the set, so the answer is the one with the most
    // generous limit - which is not the first entry in the list.
    const result = checkPlayable({ html: goodHtml(), bytes: 500_000, specs: SPECS, forNetwork: 'meta' });
    expect(result.size.bytes).toBe(500_000);
    expect(result.size.largestAccepting).toBe('Unity Ads');
  });

  it('reports no accepting network when the unit is too large for all of them', () => {
    const result = checkPlayable({ html: goodHtml(), bytes: 9 * 1024 * 1024, specs: SPECS });
    expect(result.size.largestAccepting).toBeNull();
  });

  it('is ok when there are warnings but no errors', () => {
    // The shared dev bundle contains MRAID, which is a warning without a stated
    // target, not an error.
    const result = checkPlayable({ html: goodHtml(), bytes: 500_000, specs: SPECS });
    expect(result.findings.some((f) => f.severity === 'warning')).toBe(true);
    expect(result.ok).toBe(true);
  });
});
