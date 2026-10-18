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

  private waves: { mesh: THREE.Mesh; age: number; maxR: number; speed: number; width: number }[] = [];

  /**
   * A thin ring that travels outward at a steady speed and keeps its width, so it stays readable
   * across a whole map (a scaled ring would get fat and faint). Used by Sonar Ping.
   */
  spawnWave(x: number, y: number, radius: number, color: THREE.ColorRepresentation, speed = 45, width = 0.7): void {
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, side: THREE.DoubleSide, depthWrite: false, opacity: 0.9 });
    (mat.userData as Record<string, unknown>).outlineParameters = { visible: false };
    const m = new THREE.Mesh(new THREE.RingGeometry(0.01, width, 96), mat);
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, 0.08, y);
    m.renderOrder = 2;
    this.scene.add(m);
    this.waves.push({ mesh: m, age: 0, maxR: radius, speed, width });
  }

  update(dt: number): void {
    this.waves = this.waves.filter((w) => {
      w.age += dt;
      const r = w.speed * w.age;
      const done = r >= w.maxR + w.width;
      if (done) {
        this.scene.remove(w.mesh);
        w.mesh.geometry.dispose();
        (w.mesh.material as THREE.Material).dispose();
        return false;
      }
      w.mesh.geometry.dispose();
      w.mesh.geometry = new THREE.RingGeometry(Math.max(0.01, r - w.width), Math.max(w.width, r), 96);
      // Full strength most of the way, fading over the last fifth.
      (w.mesh.material as THREE.MeshBasicMaterial).opacity = 0.9 * Math.min(1, (w.maxR - r) / (w.maxR * 0.2) + 0.15);
      return true;
    });
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

interface Shard {
  obj: THREE.Object3D;
  vel: THREE.Vector3;
  spin: THREE.Vector3;
  life: number;
  scale: number;
}

/**
 * Kill animation: clones the victim's model, detaches every mesh into world space and throws
 * the pieces outward like a toy popping apart. Pieces bounce on the floor, then shrink away.
 */
export class Shatter {
  private shards: Shard[] = [];

  constructor(private scene: THREE.Scene) {}

  burst(source: THREE.Object3D, from: THREE.Vector3, power = 1): void {
    const copy = source.clone(true);
    copy.position.copy(source.getWorldPosition(new THREE.Vector3()));
    copy.quaternion.copy(source.getWorldQuaternion(new THREE.Quaternion()));
    copy.scale.copy(source.getWorldScale(new THREE.Vector3()));
    this.scene.add(copy);
    copy.updateMatrixWorld(true);
    const meshes: THREE.Mesh[] = [];
    copy.traverse((o) => {
      if (o instanceof THREE.Mesh && o.visible) meshes.push(o);
    });
    const center = new THREE.Box3().setFromObject(copy).getCenter(new THREE.Vector3());
    for (const m of meshes) {
      this.scene.attach(m); // keep its world transform
      const p = m.getWorldPosition(new THREE.Vector3());
      const out = p.clone().sub(center);
      out.y = Math.max(0.2, out.y);
      out.normalize();
      // Away from the body centre, plus a push away from the hit direction.
      const push = center.clone().sub(from).setY(0).normalize().multiplyScalar(2.5 * power);
      const vel = out.multiplyScalar(3 + Math.random() * 4).add(push);
      vel.y += 4 + Math.random() * 3;
      this.shards.push({
        obj: m,
        vel,
        spin: new THREE.Vector3((Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14),
        life: 1.3 + Math.random() * 0.4,
        scale: m.scale.x,
      });
    }
    this.scene.remove(copy);
  }

  update(dt: number): void {
    this.shards = this.shards.filter((s) => {
      s.life -= dt;
      s.vel.y -= 22 * dt;
      s.obj.position.addScaledVector(s.vel, dt);
      if (s.obj.position.y < 0.08) {
        s.obj.position.y = 0.08;
        s.vel.y *= -0.35;
        s.vel.x *= 0.7;
        s.vel.z *= 0.7;
        s.spin.multiplyScalar(0.7);
      }
      s.obj.rotation.x += s.spin.x * dt;
      s.obj.rotation.y += s.spin.y * dt;
      s.obj.rotation.z += s.spin.z * dt;
      const k = Math.min(1, s.life / 0.35);
      s.obj.scale.setScalar(Math.max(0.001, s.scale * k));
      if (s.life <= 0) {
        s.obj.removeFromParent();
        return false;
      }
      return true;
    });
  }
}
