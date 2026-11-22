import { describe, expect, it } from 'vitest';
import type { DesktopCapturerSource } from 'electron';
import { findMatchingSource } from './web-backend';

function mockSource(id: string, name = 'Display 1', display_id = ''): DesktopCapturerSource {
  return {
    id,
    name,
    display_id,
    thumbnail: {} as unknown as Electron.NativeImage,
    appIcon: null,
  };
}

describe('findMatchingSource', () => {
  it('matches exactly by id when available', () => {
    const s1 = mockSource('screen:0:0', 'Screen 0', '1');
    const s2 = mockSource('screen:1:0', 'Screen 1', '2');
    const found = findMatchingSource([s1, s2], { kind: 'display', sourceId: 'screen:1:0' });
    expect(found?.id).toBe('screen:1:0');
  });

  it('matches Linux PipeWire portal IDs where session counter incremented', () => {
    const s1 = mockSource('screen:2:0:s', 'Ecrã inteiro', '');
    const found = findMatchingSource([s1], { kind: 'display', sourceId: 'screen:1:0:s', label: 'Ecrã inteiro' });
    expect(found?.id).toBe('screen:2:0:s');
  });

  it('matches Linux PipeWire portal window IDs where session counter incremented', () => {
    const s1 = mockSource('window:4:1234:w', 'Terminal', '');
    const found = findMatchingSource([s1], { kind: 'window', sourceId: 'window:1:1234:w', label: 'Terminal' });
    expect(found?.id).toBe('window:4:1234:w');
  });

  it('matches by label when normalized id does not match', () => {
    const s1 = mockSource('screen:99:9:s', 'Primary Monitor', '');
    const found = findMatchingSource([s1], { kind: 'display', sourceId: 'screen:1:0:s', label: 'Primary Monitor' });
    expect(found?.id).toBe('screen:99:9:s');
  });

  it('matches by displayId when present', () => {
    const s1 = mockSource('screen:custom:0', 'Screen', '6789');
    const found = findMatchingSource([s1], { kind: 'display', sourceId: 'screen:other:0', displayId: '6789' });
    expect(found?.id).toBe('screen:custom:0');
  });

  it('falls back to matching kind if id/label/displayId differ', () => {
    const s1 = mockSource('screen:5:0:s', 'Desktop', '');
    const found = findMatchingSource([s1], { kind: 'display', sourceId: 'non-matching-id' });
    expect(found?.id).toBe('screen:5:0:s');
  });

  it('returns undefined if sources array is empty', () => {
    const found = findMatchingSource([], { kind: 'display', sourceId: 'screen:1:0' });
    expect(found).toBeUndefined();
  });
});
