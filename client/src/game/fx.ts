import * as THREE from 'three';

interface Particle {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  life: number; maxLife: number;
  size: number;
  gravity: number;
  color: THREE.Color;
}

const CAPACITY = 900;

/** Pooled, instanced particles for sparks, puffs and confetti. */
export class Particles {
  readonly mesh: THREE.InstancedMesh;
  private parts: Particle[] = [];
  private dummy = new THREE.Object3D();

  constructor(scene: THREE.Scene) {
    const geo = new THREE.IcosahedronGeometry(0.5, 0);
    const mat = new THREE.MeshBasicMaterial({ color: '#ffffff' });
    this.mesh = new THREE.InstancedMesh(geo, mat, CAPACITY);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.setColorAt(0, new THREE.Color());
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    (mat.userData as Record<string, unknown>).outlineParameters = { visible: false };
    scene.add(this.mesh);
  }

  burst(opts: {
    x: number; y: number; z?: number;
    count: number;
    color: THREE.ColorRepresentation | THREE.ColorRepresentation[];
    speed?: number;
    up?: number;
    size?: number;
    life?: number;
    gravity?: number;
    dir?: number;
    cone?: number;
  }): void {
    const colors = Array.isArray(opts.color) ? opts.color : [opts.color];
    for (let i = 0; i < opts.count; i++) {
      if (this.parts.length >= CAPACITY) this.parts.shift();
      const a = opts.dir !== undefined ? opts.dir + (Math.random() - 0.5) * (opts.cone ?? 0.6) : Math.random() * Math.PI * 2;
      const sp = (opts.speed ?? 4) * (0.4 + Math.random() * 0.8);
      const life = (opts.life ?? 0.5) * (0.6 + Math.random() * 0.6);
      this.parts.push({
        x: opts.x, y: opts.z ?? 0.7, z: opts.y,
        vx: Math.cos(a) * sp, vz: Math.sin(a) * sp, vy: (opts.up ?? 2) * (0.5 + Math.random()),
        life, maxLife: life,
        size: (opts.size ?? 0.16) * (0.6 + Math.random() * 0.8),
        gravity: opts.gravity ?? 9,
        color: new THREE.Color(colors[i % colors.length]),
      });
    }
  }

  update(dt: number): void {
    let n = 0;
    const alive: Particle[] = [];
    for (const p of this.parts) {
      p.life -= dt;
      if (p.life <= 0) continue;
      p.vy -= p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      if (p.y < 0.05) {
        p.y = 0.05;
        p.vy *= -0.35;
        p.vx *= 0.6;
        p.vz *= 0.6;
      }
      const k = p.life / p.maxLife;
      this.dummy.position.set(p.x, p.y, p.z);
      this.dummy.scale.setScalar(p.size * (0.3 + 0.7 * k));
      this.dummy.rotation.set(p.life * 7, p.life * 5, 0);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(n, this.dummy.matrix);
      this.mesh.setColorAt(n, p.color);
      n++;
      alive.push(p);
    }
    this.parts = alive;
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}

/** Expanding ground rings for explosions, blinks and ability casts. */
export class Rings {
  private items: { mesh: THREE.Mesh; life: number; maxLife: number; maxR: number }[] = [];
  private geo = new THREE.RingGeometry(0.85, 1, 40);

  constructor(private scene: THREE.Scene) {}

  spawn(x: number, y: number, radius: number, color: THREE.ColorRepresentation, life = 0.35): void {
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, side: THREE.DoubleSide, depthWrite: false });
    (mat.userData as Record<string, unknown>).outlineParameters = { visible: false };
    const m = new THREE.Mesh(this.geo, mat);
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, 0.06, y);
    this.scene.add(m);
    this.items.push({ mesh: m, life, maxLife: life, maxR: radius });
  }

  update(dt: number): void {
    this.items = this.items.filter((it) => {
      it.life -= dt;
      const k = 1 - Math.max(0, it.life) / it.maxLife;
      const ease = 1 - (1 - k) ** 3;
      it.mesh.scale.setScalar(Math.max(0.01, it.maxR * ease));
      (it.mesh.material as THREE.MeshBasicMaterial).opacity = 1 - k;
      if (it.life <= 0) {
        this.scene.remove(it.mesh);
        (it.mesh.material as THREE.Material).dispose();
        return false;
      }
      return true;
    });
  }
}

/** Screen shake as decaying trauma (shake = trauma^2). */
export class Shake {
  trauma = 0;
  private t = 0;

  add(amount: number): void {
    this.trauma = Math.min(1, this.trauma + amount);
  }

  offset(dt: number, reduced: boolean): THREE.Vector3 {
    this.t += dt;
    this.trauma = Math.max(0, this.trauma - dt * 1.8);
    const s = (reduced ? 0.2 : 1) * this.trauma * this.trauma;
    return new THREE.Vector3(
      Math.sin(this.t * 61) * 0.55 * s,
      Math.sin(this.t * 47 + 1) * 0.35 * s,
      Math.sin(this.t * 53 + 2) * 0.55 * s,
    );
  }
}
