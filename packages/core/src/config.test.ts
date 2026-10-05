import { describe, expect, it } from 'vitest';
import { ConfigError, defineConfig } from './config.js';

describe('defineConfig', () => {
  it('returns defaults when called with nothing', () => {
    const cfg = defineConfig();
    expect(cfg.audio).toBe('gesture');
    expect(cfg.targetFps).toBe(60);
    expect(cfg.volume).toBe(1);
    expect(cfg.debug).toBe(false);
  });

  it('keeps provided values', () => {
    const cfg = defineConfig({ volume: 0.5, targetFps: 30, debug: true, audio: 'on' });
    expect(cfg.volume).toBe(0.5);
    expect(cfg.targetFps).toBe(30);
    expect(cfg.debug).toBe(true);
    expect(cfg.audio).toBe('on');
  });

  it('treats an explicit undefined as "use the default"', () => {
    const cfg = defineConfig({ volume: undefined });
    expect(cfg.volume).toBe(1);
  });

  it('rejects a non-object config', () => {
    expect(() => defineConfig(null as never)).toThrow(ConfigError);
    expect(() => defineConfig([] as never)).toThrow(ConfigError);
  });

  it('rejects unknown keys instead of silently ignoring them', () => {
    expect(() => defineConfig({ nope: 1 } as never)).toThrow(/unknown config key/);
  });

  it('rejects out-of-range numbers', () => {
    expect(() => defineConfig({ volume: 2 })).toThrow(/between 0 and 1/);
    expect(() => defineConfig({ targetFps: 5 })).toThrow(/between 30 and 120/);
  });

  it('rejects a NaN number', () => {
    expect(() => defineConfig({ volume: Number.NaN })).toThrow(/must be a number/);
  });

  it('rejects a bad audio mode', () => {
    expect(() => defineConfig({ audio: 'loud' as never })).toThrow(/"on" or "gesture"/);
  });

  it('rejects an unknown network id', () => {
    expect(() => defineConfig({ network: 'facebook' as never })).toThrow(/not a known network/);
  });

  it('clamps a threshold above the target fps instead of throwing', () => {
    expect(defineConfig({ targetFps: 30, lowFpsThreshold: 60 }).lowFpsThreshold).toBe(30);
  });

  it('allows the threshold to match the target', () => {
    expect(() => defineConfig({ targetFps: 30, lowFpsThreshold: 30 })).not.toThrow();
  });
});
