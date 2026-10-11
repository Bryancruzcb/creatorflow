import { describe, expect, it } from 'vitest';
import { contourPaths, routePaths } from './routeGeometry';

const segments = (d: string) => d.split('M').filter(Boolean).length;

describe('contourPaths', () => {
  it('draws the same terrain every time for the same size', () => {
    expect(contourPaths(400, 400, 12)).toEqual(contourPaths(400, 400, 12));
  });

  it('draws both ordinary and index contours, inside the box', () => {
    const { minor, major } = contourPaths(600, 800, 12);
    expect(segments(minor)).toBeGreaterThan(50);
    expect(segments(major)).toBeGreaterThan(5);
    const numbers = `${minor}${major}`.match(/-?\d+(\.\d+)?/g)!.map(Number);
    expect(Math.min(...numbers)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...numbers)).toBeLessThanOrEqual(816);
  });

  it('draws nothing for an empty box', () => {
    expect(contourPaths(0, 500, 12)).toEqual({ minor: '', major: '' });
  });
});

describe('routePaths', () => {
  const points = [{ x: 100, y: 50 }, { x: 80, y: 400 }, { x: 120, y: 900 }, { x: 90, y: 1500 }, { x: 110, y: 1800 }];

  it('is all ahead when only the marker is reached, and all walked at the last point', () => {
    expect(routePaths(points, 0, 10).walked).toBe('');
    expect(routePaths(points, 4, 10).ahead).toBe('');
  });

  it('splits exactly at the reached point: the walked part ends where the ahead part starts', () => {
    const { walked, ahead } = routePaths(points, 2, 10);
    expect(walked).not.toBe('');
    expect(ahead.startsWith('M120 900C')).toBe(true);
    expect(walked.endsWith('120 900')).toBe(true);
  });

  it('adds meander bends on long gaps, so there are more curves than gaps', () => {
    const { walked, ahead } = routePaths(points, 2, 10);
    expect(segments(walked) + segments(ahead)).toBeGreaterThan(points.length - 1);
  });

  it('draws nothing for fewer than two points', () => {
    expect(routePaths([{ x: 0, y: 0 }], 0, 10)).toEqual({ walked: '', ahead: '' });
  });
});
