import * as THREE from 'three';
import { WOOL_ID_START } from '../core/registry/blocks.ts';
import { Item } from '../core/registry/items.ts';

export interface MobState {
  group: THREE.Group;
  x: number;
  y: number;
  z: number;
  hp: number;
  dirX: number;
  dirZ: number;
  wander: number;
  attackAt?: number;
  flashUntil?: number;
  materials: Array<{ material: THREE.MeshBasicMaterial; color: number }>;
}

export interface MobDeps {
  scene: THREE.Scene;
  getPlayer(): { x: number; y: number; z: number };
  surfaceY(x: number, z: number): number | null;
  onDamage(amount: number, cause: string): void;
  onDrop(id: number, count: number, x: number, y: number, z: number): void;
  onXp(amount: number): void;
  onHit(): void;
  onUi(): void;
  mobDamage(): number;
}

interface DropRule {
  list: MobState[];
  dropId: number;
  xp: number;
  yOffset: number;
}

/**
 * 猪/羊/僵尸的统一生命周期。
 * 模型、游走、僵尸追击、点击命中、死亡掉落都在这里，组合根只负责注入依赖。
 */
export class MobSystem {
  private readonly pigs: MobState[] = [];
  private readonly sheep: MobState[] = [];
  private readonly zombies: MobState[] = [];
  private lastPlayerAttackAt = 0;

  constructor(private readonly deps: MobDeps) {}

  get counts(): { pigs: number; sheep: number; zombies: number } {
    return { pigs: this.pigs.length, sheep: this.sheep.length, zombies: this.zombies.length };
  }

  hasHostileNear(x: number, y: number, z: number, radius = 8, height = 5): boolean {
    return this.zombies.some(
      (mob) => Math.abs(mob.x - x) <= radius && Math.abs(mob.y - y) <= height && Math.abs(mob.z - z) <= radius,
    );
  }

  clearAll(): void {
    for (const list of [this.pigs, this.sheep, this.zombies]) {
      for (const mob of list) this.disposeMob(mob);
      list.length = 0;
    }
  }

  spawnPig(x: number, y: number, z: number): void {
    const group = new THREE.Group();
    const pink = new THREE.MeshBasicMaterial({ color: 0xf0a8a0 });
    const snoutMat = new THREE.MeshBasicMaterial({ color: 0xd98f88 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.55, 1.0), pink);
    body.position.y = 0.62;
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.45, 0.5), pink);
    head.position.set(0, 0.78, -0.65);
    const snout = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.16, 0.12), snoutMat);
    snout.position.set(0, 0.72, -0.92);
    group.add(body, head, snout);
    for (const [lx, lz] of [[-0.22, -0.32], [0.22, -0.32], [-0.22, 0.32], [0.22, 0.32]] as const) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.45, 0.18), pink);
      leg.position.set(lx, 0.22, lz);
      group.add(leg);
    }
    this.spawn(this.pigs, group, x, y, z, 10, 1);
  }

  spawnSheep(x: number, y: number, z: number): void {
    const group = new THREE.Group();
    const wool = new THREE.MeshBasicMaterial({ color: 0xf2f2ee });
    const skin = new THREE.MeshBasicMaterial({ color: 0xd8c7b8 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.6, 1.0), wool);
    body.position.y = 0.72;
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.45, 0.45), wool);
    head.position.set(0, 0.95, -0.62);
    const face = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.22, 0.1), skin);
    face.position.set(0, 0.9, -0.86);
    group.add(body, head, face);
    for (const [lx, lz] of [[-0.24, -0.3], [0.24, -0.3], [-0.24, 0.3], [0.24, 0.3]] as const) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.5, 0.18), skin);
      leg.position.set(lx, 0.25, lz);
      group.add(leg);
    }
    this.spawn(this.sheep, group, x, y, z, 8, -1);
  }

  spawnZombie(x: number, y: number, z: number): void {
    const group = new THREE.Group();
    const skin = new THREE.MeshBasicMaterial({ color: 0x4f7f45 });
    const shirt = new THREE.MeshBasicMaterial({ color: 0x3b5f8a });
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.8, 0.3), shirt);
    body.position.y = 1.0;
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), skin);
    head.position.y = 1.55;
    const leftArm = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.7, 0.2), skin);
    leftArm.position.set(-0.4, 1.05, -0.15);
    leftArm.rotation.x = -1.2;
    const rightArm = leftArm.clone();
    rightArm.position.x = 0.4;
    for (const [lx, lz] of [[-0.16, 0], [0.16, 0]] as const) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.8, 0.24), new THREE.MeshBasicMaterial({ color: 0x2f4560 }));
      leg.position.set(lx, 0.4, lz);
      group.add(leg);
    }
    group.add(body, head, leftArm, rightArm);
    this.spawn(this.zombies, group, x, y, z, 12, 1);
  }

  tick(dt: number): void {
    this.tickWanderers(this.pigs, dt, 1.15);
    this.tickWanderers(this.sheep, dt, 0.85);
    this.tickZombies(dt);
  }

  tryAttack(
    clientX: number,
    clientY: number,
    camera: THREE.Camera,
    screenWidth: number,
    screenHeight: number,
    designHeight: number,
  ): boolean {
    if (Date.now() - this.lastPlayerAttackAt < 300) return false;
    const rules: DropRule[] = [
      { list: this.pigs, dropId: Item.PORKCHOP, xp: 3, yOffset: 0.65 },
      { list: this.sheep, dropId: WOOL_ID_START, xp: 1, yOffset: 0.8 },
      { list: this.zombies, dropId: Item.ROTTEN_FLESH, xp: 5, yOffset: 0.9 },
    ];
    camera.updateMatrixWorld();
    for (const rule of rules) {
      for (let i = rule.list.length - 1; i >= 0; i--) {
        const mob = rule.list[i]!;
        if (Math.hypot(mob.x - this.player.x, mob.z - this.player.z) > 5) continue;
        const projected = new THREE.Vector3(mob.x, mob.y + rule.yOffset, mob.z).project(camera);
        if (projected.z > 1) continue;
        const designX = ((projected.x + 1) / 2) * 1024;
        const designY = ((1 - projected.y) / 2) * designHeight;
        const touchX = (clientX / Math.max(1, screenWidth)) * 1024;
        const touchY = (clientY / Math.max(1, screenHeight)) * designHeight;
        if (Math.hypot(designX - touchX, designY - touchY) > 88) continue;
        this.lastPlayerAttackAt = Date.now();
        mob.flashUntil = Date.now() + 120;
        for (const entry of mob.materials) entry.material.color.set(0xff5555);
        mob.hp -= 4;
        this.deps.onHit();
        if (mob.hp <= 0) {
          this.deps.onDrop(rule.dropId, 1, mob.x, mob.y + 0.5, mob.z);
          this.deps.onXp(rule.xp);
          this.remove(rule.list, i);
        }
        this.deps.onUi();
        return true;
      }
    }
    return false;
  }

  killPig(): boolean {
    return this.kill(this.pigs, Item.PORKCHOP, 3);
  }

  killSheep(): boolean {
    return this.kill(this.sheep, WOOL_ID_START, 1);
  }

  killZombie(): boolean {
    return this.kill(this.zombies, Item.ROTTEN_FLESH, 5);
  }

  private get player(): { x: number; y: number; z: number } {
    return this.deps.getPlayer();
  }

  private spawn(list: MobState[], group: THREE.Group, x: number, y: number, z: number, hp: number, dir: number): void {
    group.position.set(x, y, z);
    this.deps.scene.add(group);
    const materials: Array<{ material: THREE.MeshBasicMaterial; color: number }> = [];
    group.traverse((child) => {
      if (child instanceof THREE.Mesh && child.material instanceof THREE.MeshBasicMaterial) {
        if (!materials.some((entry) => entry.material === child.material)) {
          materials.push({ material: child.material, color: child.material.color.getHex() });
        }
      }
    });
    list.push({ group, x, y, z, hp, dirX: dir, dirZ: 0, wander: 2, materials });
  }

  private tickWanderers(list: MobState[], dt: number, speed: number): void {
    const now = Date.now();
    for (const mob of list) {
      this.restoreFlash(mob, now);
      mob.wander -= dt;
      if (mob.wander <= 0) {
        const angle = Math.random() * Math.PI * 2;
        mob.dirX = Math.cos(angle);
        mob.dirZ = Math.sin(angle);
        mob.wander = 2 + Math.random() * 3;
      }
      const nx = mob.x + mob.dirX * speed * dt;
      const nz = mob.z + mob.dirZ * speed * dt;
      const surface = this.deps.surfaceY(Math.floor(nx), Math.floor(nz));
      if (surface !== null && Math.abs(surface + 1 - mob.y) <= 1.2) {
        mob.x = nx;
        mob.z = nz;
        mob.y = surface + 1;
      } else {
        mob.dirX *= -1;
        mob.dirZ *= -1;
      }
      mob.group.position.set(mob.x, mob.y, mob.z);
      mob.group.rotation.y = Math.atan2(mob.dirX, mob.dirZ);
    }
  }

  private tickZombies(dt: number): void {
    const player = this.player;
    const now = Date.now();
    for (const mob of this.zombies) {
      this.restoreFlash(mob, now);
      const dx = player.x - mob.x;
      const dz = player.z - mob.z;
      const dist = Math.hypot(dx, dz);
      let dirX = mob.dirX;
      let dirZ = mob.dirZ;
      if (dist < 16) {
        dirX = dx / Math.max(0.001, dist);
        dirZ = dz / Math.max(0.001, dist);
      } else {
        mob.wander -= dt;
        if (mob.wander <= 0) {
          const angle = Math.random() * Math.PI * 2;
          dirX = Math.cos(angle);
          dirZ = Math.sin(angle);
          mob.wander = 2 + Math.random() * 3;
        }
      }
      const nx = mob.x + dirX * 1.05 * dt;
      const nz = mob.z + dirZ * 1.05 * dt;
      const surface = this.deps.surfaceY(Math.floor(nx), Math.floor(nz));
      if (surface !== null && Math.abs(surface + 1 - mob.y) <= 1.2) {
        mob.x = nx;
        mob.z = nz;
        mob.y = surface + 1;
        mob.dirX = dirX;
        mob.dirZ = dirZ;
      }
      mob.group.position.set(mob.x, mob.y, mob.z);
      mob.group.rotation.y = Math.atan2(dirX, dirZ);
      if (dist < 1.35 && Date.now() > (mob.attackAt ?? 0)) {
        mob.attackAt = Date.now() + 1200;
        this.deps.onDamage(this.deps.mobDamage(), '僵尸');
      }
    }
  }

  private restoreFlash(mob: MobState, now: number): void {
    if (!mob.flashUntil || now < mob.flashUntil) return;
    mob.flashUntil = 0;
    for (const entry of mob.materials) entry.material.color.set(entry.color);
  }

  private kill(list: MobState[], dropId: number, xp: number): boolean {
    const mob = list[0];
    if (!mob) return false;
    this.deps.onDrop(dropId, 1, mob.x, mob.y + 0.5, mob.z);
    this.deps.onXp(xp);
    this.remove(list, 0);
    this.deps.onUi();
    return true;
  }

  private remove(list: MobState[], index: number): void {
    const mob = list[index];
    if (!mob) return;
    this.disposeMob(mob);
    list.splice(index, 1);
  }

  private disposeMob(mob: MobState): void {
    this.deps.scene.remove(mob.group);
    mob.group.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        (child.material as THREE.Material).dispose();
      }
    });
  }
}
