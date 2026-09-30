// M0 ベンチ用の基準シーン（GDD 12.3 の性能予算に近い負荷を作る。本番コードではない）
// three と three/webgpu を混在させないため、名前空間を引数で受け取る。
import type * as ThreeNS from 'three';

type T = typeof ThreeNS;

export interface BenchScene {
  scene: ThreeNS.Scene;
  camera: ThreeNS.PerspectiveCamera;
  core: ThreeNS.Mesh;
  update(timeSec: number): void;
}

export const BENCH_WIDTH = 1920;
export const BENCH_HEIGHT = 1080;

// 予算: ドローコール ≤150、画面内 ≤50万トライアングル
export function buildBenchScene(THREE: T): BenchScene {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x05060a);
  scene.fog = new THREE.Fog(0x0a0c14, 20, 90);

  const camera = new THREE.PerspectiveCamera(70, BENCH_WIDTH / BENCH_HEIGHT, 0.1, 200);

  // 主光源1灯（影あり）＋補色の点光源2灯
  const sun = new THREE.DirectionalLight(0xbfc8ff, 1.2);
  sun.position.set(-10, 20, 8);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -20, right: 20, top: 20, bottom: -20 });
  scene.add(sun);
  scene.add(new THREE.HemisphereLight(0x223355, 0x110811, 0.4));
  const magenta = new THREE.PointLight(0xff2bd6, 60, 40);
  magenta.position.set(-8, 5, 0);
  const cyan = new THREE.PointLight(0x35f2ff, 60, 40);
  cyan.position.set(8, 5, 0);
  scene.add(magenta, cyan);

  // 床（濡れた路面を粗さ低めで代用）: 1 draw
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(40, 60, 64, 64),
    new THREE.MeshStandardMaterial({ color: 0x15161c, roughness: 0.25, metalness: 0.6 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  // キャラ代わり 2体（各約2万トライアングル）: 2 draws
  const charGeo = new THREE.TorusKnotGeometry(0.5, 0.18, 400, 25); // 20,000 tris
  const charMat = new THREE.MeshStandardMaterial({ color: 0x9aa0b0, roughness: 0.4, metalness: 0.7 });
  for (const z of [-7, 7]) {
    const c = new THREE.Mesh(charGeo, charMat);
    c.position.set(0, 1.2, z);
    c.castShadow = true;
    scene.add(c);
  }

  // ステージ小物: 個別メッシュ 100 個（材質を分けて draw call を稼ぐ）
  const propGeo = new THREE.BoxGeometry(1, 1, 1, 8, 8, 8); // 768 tris
  for (let i = 0; i < 100; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    const m = new THREE.Mesh(
      propGeo,
      new THREE.MeshStandardMaterial({ color: new THREE.Color().setHSL((i * 0.07) % 1, 0.15, 0.25), roughness: 0.6 }),
    );
    m.position.set(side * (7 + (i % 5)), 0.5 + (i % 7), -25 + (i * 0.5));
    m.scale.setScalar(0.6 + (i % 3) * 0.4);
    m.castShadow = true;
    scene.add(m);
  }

  // 背景ビル（重いジオメトリで三角形数を予算近くまで）: 10 draws
  const bldGeo = new THREE.SphereGeometry(3, 128, 128); // 約32,500 tris
  const bldMat = new THREE.MeshStandardMaterial({ color: 0x202433, roughness: 0.8 });
  for (let i = 0; i < 10; i++) {
    const b = new THREE.Mesh(bldGeo, bldMat);
    b.position.set((i % 2 === 0 ? -1 : 1) * 20, 6, -30 + i * 6);
    b.scale.set(1, 3, 1);
    scene.add(b);
  }

  // 小物のインスタンス 2,000 個: 1 draw
  const inst = new THREE.InstancedMesh(
    new THREE.IcosahedronGeometry(0.08, 1),
    new THREE.MeshStandardMaterial({ color: 0x556070 }),
    2000,
  );
  const mtx = new THREE.Matrix4();
  for (let i = 0; i < 2000; i++) {
    mtx.makeTranslation(((i * 7919) % 400) / 10 - 20, 0.05, ((i * 104729) % 600) / 10 - 30);
    inst.setMatrixAt(i, mtx);
  }
  scene.add(inst);

  // ネオン管（emissive、ブルーム対象）: 20 draws
  const neonGeo = new THREE.CylinderGeometry(0.05, 0.05, 6, 12);
  for (let i = 0; i < 20; i++) {
    const color = i % 2 === 0 ? 0xff2bd6 : 0x35f2ff;
    const n = new THREE.Mesh(neonGeo, new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 2.5 }));
    n.position.set((i % 2 === 0 ? -1 : 1) * 5.2, 3, -24 + i * 2.5);
    n.rotation.z = Math.PI / 2;
    scene.add(n);
  }

  // プラズマ・フェンス（半透明）: 1 draw
  const fence = new THREE.Mesh(
    new THREE.PlaneGeometry(10, 6),
    new THREE.MeshStandardMaterial({ color: 0x35f2ff, emissive: 0x35f2ff, emissiveIntensity: 0.6, transparent: true, opacity: 0.25, side: THREE.DoubleSide }),
  );
  fence.position.set(0, 3, 0);
  scene.add(fence);

  // コア（常に最も明るい物体）: 1 draw
  const core = new THREE.Mesh(
    new THREE.SphereGeometry(0.25, 48, 48),
    new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xff5533, emissiveIntensity: 6 }),
  );
  scene.add(core);

  return {
    scene,
    camera,
    core,
    update(t: number) {
      // TPS 相当の位置からコートを見る。ゆっくり揺らして毎フレームの描画内容を変える
      camera.position.set(Math.sin(t * 0.3) * 1.5, 2.3, 9.5);
      camera.lookAt(0, 1.2, -4);
      core.position.set(Math.sin(t * 2) * 2, 1.4 + Math.sin(t * 5) * 0.3, Math.cos(t * 1.3) * 6);
    },
  };
}

// シーン本体のドローコール数（GDD 12.3 の予算対象）: 視錐台内の可視 Mesh 数。
// 影パス・ポストの全画面パスは含まない。マルチマテリアルはグループ数で数える。
export function countSceneDrawCalls(THREE: T, scene: ThreeNS.Scene, camera: ThreeNS.Camera): number {
  camera.updateMatrixWorld();
  const frustum = new THREE.Frustum().setFromProjectionMatrix(
    new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse),
  );
  let count = 0;
  scene.traverseVisible((o) => {
    const mesh = o as ThreeNS.Mesh;
    if (!mesh.isMesh) return;
    if (mesh.frustumCulled && !(mesh as ThreeNS.InstancedMesh).isInstancedMesh && !frustum.intersectsObject(mesh)) return;
    count += Array.isArray(mesh.material) ? Math.max(1, mesh.geometry.groups.length) : 1;
  });
  return count;
}
