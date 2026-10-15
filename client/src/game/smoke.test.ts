import { describe, expect, it } from 'vitest';
import { smokeFog } from './smoke';

const cloud = { id: 1, x: 0, y: 0, r: 5, endsIn: 5 };

describe('smoke visibility', () => {
  it('leaves faint visibility in every direction at the center', () => {
    const fog = smokeFog(cloud, 0, 0, 0, 0)!;
    expect(fog.near).toBeCloseTo(fog.far);
    expect(fog.near).toBeGreaterThan(0.8);
    expect(fog.far).toBeLessThan(1);
  });

  it('clears the nearest side while the far side stays dense', () => {
    const fog = smokeFog(cloud, 4.5, 0, 1, 0)!;
    expect(fog.near).toBeLessThan(0.2);
    expect(fog.far).toBeGreaterThan(0.95);
    expect(fog.angle).toBe(90);
    expect(smokeFog(cloud, -4.5, 0, -1, 0)!.angle).toBe(-90);
    expect(smokeFog(cloud, 0, -4.5, 0, -1)!.angle).toBe(0);
  });

  it('fades smoothly at the boundary and as the cloud expires', () => {
    expect(smokeFog(cloud, 4.99, 0, 1, 0)!.opacity).toBeLessThan(0.01);
    expect(smokeFog({ ...cloud, endsIn: 0.6 }, 0, 0, 0, 0)!.opacity).toBeCloseTo(0.5);
    expect(smokeFog(cloud, 5, 0, 1, 0)).toBeNull();
    expect(smokeFog({ ...cloud, endsIn: 0 }, 0, 0, 0, 0)).toBeNull();
    expect(smokeFog({ ...cloud, r: 0 }, 0, 0, 0, 0)).toBeNull();
  });
});
