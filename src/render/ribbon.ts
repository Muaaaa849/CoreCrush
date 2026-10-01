// コート脇の LED の帯看板（アリーナのリボンボード）。筐体は CSG、表示は流れる帯と山形の模様（文字は出さない）。
// 色はチーム色を避ける（選手とコアだけの色にする）。床の水たまりに映って床に光の情報を足す。
import * as THREE from 'three/webgpu';
import { color, float, floor, fract, hash, mix, positionWorld, select, smoothstep, time, uv, abs } from 'three/tsl';
import { buildRibbonHousing } from './csgParts';

export interface RibbonLook {
  xM: number;
  lengthM: number;
  heightM: number;
  depthM: number;
  colorA: string;
  colorB: string;
  hdr: number;
  speed: number;
  housingColor: string;
}

export function buildRibbons(L: RibbonLook): THREE.Group {
  const g = new THREE.Group();
  const { housing, screen } = buildRibbonHousing(L.lengthM, L.heightM, L.depthM);
  const hmat = new THREE.MeshStandardMaterial({ color: new THREE.Color(L.housingColor), roughness: 0.5, metalness: 0.7 });
  const smat = new THREE.MeshBasicNodeMaterial();
  const u = uv();
  const s = u.x.mul(L.lengthM).add(time.mul(L.speed));
  const seg = floor(s.div(6));
  const pick = hash(seg.add(positionWorld.x.sign().mul(17)));
  // 模様: 山形（シェブロン）・帯・点滅ブロック
  const chev = smoothstep(0.35, 0.3, abs(fract(s.mul(0.8).add(abs(u.y.sub(0.5)).mul(0.8))).sub(0.5)));
  const band = smoothstep(0.1, 0.0, abs(fract(u.y.mul(3).add(s.mul(0.05))).sub(0.5)).sub(0.3));
  const blocks = select(hash(floor(s.mul(2)).add(floor(u.y.mul(4)).mul(31))).greaterThan(0.55), float(1), float(0.15));
  const pat = select(pick.lessThan(0.4), chev, select(pick.lessThan(0.7), band, blocks));
  // LED の粒（細かい格子で少し暗く）
  const dots = smoothstep(0.5, 0.35, abs(fract(u.x.mul(L.lengthM * 18)).sub(0.5))).mul(smoothstep(0.5, 0.35, abs(fract(u.y.mul(L.heightM * 18)).sub(0.5))));
  const col = mix(color(L.colorA), color(L.colorB), hash(seg.mul(3.1)));
  smat.colorNode = col.mul(pat.mul(0.85).add(0.08)).mul(dots.mul(0.4).add(0.6)).mul(L.hdr);
  for (const sx of [-1, 1]) {
    const h = new THREE.Mesh(housing, hmat);
    const sc = new THREE.Mesh(screen, smat);
    for (const m of [h, sc]) {
      m.position.x = sx * L.xM;
      m.rotation.y = sx > 0 ? 0 : Math.PI;
      g.add(m);
    }
    h.castShadow = true;
  }
  return g;
}
