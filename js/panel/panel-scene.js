import * as THREE from "../../lib/three/three.module.js";
import { OrbitControls } from "../../lib/three/controls/OrbitControls.js";
import { BREAKERS, PANEL_INFO } from "./panel-data.js?v=8";

const MCB_W = 0.175;
const MCB_H = 0.92;
const MCB_D = 0.58;
const RELAY_W = 0.36;
const RCD_W = 0.36;
const GAP = 0.012;
const EMPTY_RIGHT = 0.42;
// Базові дистанції; після збірки підганяються під весь щиток
let CAM_Z_CLOSED = 9.2;
let CAM_Z_OPEN = 8.0;

function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

export class PanelScene {
  constructor(canvas, ui) {
    this.canvas = canvas;
    this.ui = ui;
    this.doorOpen = false;
    this.doorAnimating = false;
    this.selectedId = null;
    this.pickables = [];
    this.doorPickables = [];
    this.pointer = new THREE.Vector2();
    this.raycaster = new THREE.Raycaster();
    this._pointerDown = null;
    this.deviceMeshes = new Map();

    this._initRenderer();
    this._initScene();
    this._initLights();
    this._buildPanel();
    this._fitCameraToPanel();
    this._initControls();
    this._bindEvents();
    this._updateHint();

    this._onResize();
    this._raf = requestAnimationFrame(() => this._loop());
  }

  _fitCameraToPanel() {
    const box = new THREE.Box3().setFromObject(this.root);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    this._viewCenter = center.clone();
    const maxDim = Math.max(size.x * 1.08, size.y * 1.25);
    const fov = (this.camera.fov * Math.PI) / 180;
    let dist = maxDim / 2 / Math.tan(fov / 2);
    dist *= 1.55;
    CAM_Z_CLOSED = dist;
    CAM_Z_OPEN = dist * 0.9;
    this.camera.position.set(center.x, center.y * 0.15, center.z + dist);
    if (this.controls) this.controls.target.copy(center);
  }

  _initRenderer() {
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      alpha: false,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setClearColor(0xe8f0f4, 1);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;

    this.camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100);
    this.camera.position.set(0.05, 0.05, CAM_Z_CLOSED);
  }

  _initScene() {
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0xe8f0f4, 14, 26);
    this.scene.background = new THREE.Color(0xe8f0f4);

    const wall = new THREE.Mesh(
      new THREE.PlaneGeometry(16, 10),
      new THREE.MeshStandardMaterial({
        color: 0xfff6ec,
        roughness: 0.9,
        metalness: 0.02,
      })
    );
    wall.position.z = -0.62;
    wall.receiveShadow = true;
    this.scene.add(wall);

    // Soft colored floor wash
    const wash = new THREE.Mesh(
      new THREE.PlaneGeometry(10, 4),
      new THREE.MeshStandardMaterial({
        color: 0xd4e8f0,
        roughness: 1,
        metalness: 0,
        transparent: true,
        opacity: 0.35,
      })
    );
    wash.rotation.x = -Math.PI / 2;
    wash.position.set(0, -1.6, 1.2);
    this.scene.add(wash);
  }

  _initLights() {
    this.scene.add(new THREE.HemisphereLight(0xfff4e8, 0x6a8aaa, 1.05));

    const key = new THREE.DirectionalLight(0xfff0dd, 1.55);
    key.position.set(1.8, 4.2, 5);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.near = 1;
    key.shadow.camera.far = 16;
    key.shadow.camera.left = -4;
    key.shadow.camera.right = 4;
    key.shadow.camera.top = 4;
    key.shadow.camera.bottom = -4;
    this.scene.add(key);

    const fill = new THREE.DirectionalLight(0x8ec8ff, 0.65);
    fill.position.set(-3.5, 1.2, 2.5);
    this.scene.add(fill);

    const accent = new THREE.PointLight(0xffaa55, 0.55, 8);
    accent.position.set(0.8, 0.4, 2.2);
    this.scene.add(accent);
  }

  _initControls() {
    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 2.2;
    this.controls.maxDistance = 9;
    this.controls.target.copy(this._viewCenter || new THREE.Vector3(0, 0, 0));
    this.controls.maxPolarAngle = Math.PI * 0.72;
    this.controls.minPolarAngle = Math.PI * 0.28;
    this.controls.minDistance = Math.max(3, CAM_Z_OPEN * 0.45);
    this.controls.maxDistance = CAM_Z_CLOSED * 1.35;
    this.controls.enablePan = false;
    this.controls.enableRotate = false;
  }

  _totalRailWidth() {
    let w = 0;
    for (const b of BREAKERS) {
      w += b.type === "mcb" ? MCB_W : b.type === "relay" ? RELAY_W : RCD_W;
      w += GAP;
    }
    return w - GAP;
  }

  _buildPanel() {
    this.root = new THREE.Group();
    this.scene.add(this.root);

    const railW = this._totalRailWidth();
    const boxW = railW + 0.7 + EMPTY_RIGHT;
    const boxH = 1.85;
    const boxD = 0.78;

    const plastic = new THREE.MeshStandardMaterial({
      color: 0xfffaf4,
      roughness: 0.38,
      metalness: 0.06,
    });
    const plasticInner = new THREE.MeshStandardMaterial({
      color: 0xe8eef5,
      roughness: 0.55,
      metalness: 0.04,
    });

    // Outer housing
    const outer = new THREE.Mesh(
      new THREE.BoxGeometry(boxW + 0.12, boxH + 0.12, boxD * 0.28),
      plastic
    );
    outer.position.z = -0.22;
    outer.castShadow = true;
    outer.receiveShadow = true;
    this.root.add(outer);

    // Front frame
    const frame = new THREE.Mesh(
      new THREE.BoxGeometry(boxW, boxH, 0.1),
      plastic
    );
    frame.position.z = -0.02;
    frame.castShadow = true;
    frame.receiveShadow = true;
    this.root.add(frame);

    // Deep recess (like photo)
    const recess = new THREE.Mesh(
      new THREE.BoxGeometry(boxW - 0.22, boxH - 0.28, 0.42),
      plasticInner
    );
    recess.position.z = 0.08;
    recess.receiveShadow = true;
    this.root.add(recess);

    // Inner lip around recess
    const lipMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.32,
      metalness: 0.08,
    });
    const lip = new THREE.Mesh(
      new THREE.BoxGeometry(boxW - 0.14, boxH - 0.18, 0.06),
      lipMat
    );
    lip.position.z = 0.28;
    this.root.add(lip);

    // Cutout illusion — cooler tint behind devices
    const cut = new THREE.Mesh(
      new THREE.PlaneGeometry(boxW - 0.32, boxH - 0.4),
      new THREE.MeshStandardMaterial({ color: 0xd5e0ea, roughness: 0.8 })
    );
    cut.position.z = 0.12;
    this.root.add(cut);

    // DIN rail
    const din = new THREE.Mesh(
      new THREE.BoxGeometry(railW + 0.2, 0.09, 0.07),
      new THREE.MeshStandardMaterial({
        color: 0xc0c8d4,
        metalness: 0.85,
        roughness: 0.22,
      })
    );
    din.position.set(-EMPTY_RIGHT / 2, -0.18, 0.2);
    this.root.add(din);

    // Corner screw wells + screws
    const wellMat = new THREE.MeshStandardMaterial({
      color: 0xe0ddd8,
      roughness: 0.55,
    });
    const screwMat = new THREE.MeshStandardMaterial({
      color: 0x8c8c8c,
      metalness: 0.85,
      roughness: 0.28,
    });
    const wellGeo = new THREE.CylinderGeometry(0.055, 0.055, 0.03, 20);
    const screwGeo = new THREE.CylinderGeometry(0.028, 0.028, 0.025, 16);
    for (const [x, y] of [
      [-boxW / 2 + 0.18, boxH / 2 - 0.18],
      [boxW / 2 - 0.18, boxH / 2 - 0.18],
      [-boxW / 2 + 0.18, -boxH / 2 + 0.18],
      [boxW / 2 - 0.18, -boxH / 2 + 0.18],
    ]) {
      const well = new THREE.Mesh(wellGeo, wellMat);
      well.rotation.x = Math.PI / 2;
      well.position.set(x, y, 0.3);
      this.root.add(well);
      const screw = new THREE.Mesh(screwGeo, screwMat);
      screw.rotation.x = Math.PI / 2;
      screw.position.set(x, y, 0.32);
      this.root.add(screw);
    }

    this.devicesGroup = new THREE.Group();
    // Передня грань автоматів ≈ z + MCB_D/2 — дверцята мають бути ДАЛІ вперед
    this.devicesGroup.position.set(-EMPTY_RIGHT / 2, 0.02, 0.2);
    this.devicesGroup.renderOrder = 1;
    this.root.add(this.devicesGroup);

    let x = -railW / 2;
    let index = 0;
    for (const data of BREAKERS) {
      const width =
        data.type === "mcb" ? MCB_W : data.type === "relay" ? RELAY_W : RCD_W;
      const mesh =
        data.type === "mcb"
          ? this._makeMcb(data, width, index)
          : data.type === "relay"
            ? this._makeRelay(data, width)
            : this._makeRcd(data, width);

      mesh.position.x = x + width / 2;
      mesh.userData.breakerId = data.id;
      mesh.userData.width = width;
      this.devicesGroup.add(mesh);
      this.deviceMeshes.set(data.id, mesh);
      mesh.traverse((c) => {
        if (c.isMesh) {
          c.userData.breakerId = data.id;
          this.pickables.push(c);
        }
      });
      x += width + GAP;
      index += 1;
    }

    // Door hinged on left — z попереду автоматів (0.2 + 0.29 ≈ 0.49)
    this.doorPivot = new THREE.Group();
    // z має бути більшим за передню грань автоматів (≈0.2+0.29), інакше скло «під» ними
    this.doorPivot.position.set(-boxW / 2 + 0.04, 0, 0.88);
    this.doorPivot.renderOrder = 20;
    this.root.add(this.doorPivot);

    const doorW = boxW - 0.08;
    const doorH = boxH - 0.1;
    const doorGeo = new THREE.BoxGeometry(doorW, doorH, 0.028);
    doorGeo.translate(doorW / 2, 0, 0);

    // Прозоре димчасте скло ПЕРЕД автоматами (Standard — стабільно на iOS)
    const doorMat = new THREE.MeshStandardMaterial({
      color: 0x254060,
      roughness: 0.08,
      metalness: 0.12,
      transparent: true,
      opacity: 0.48,
      depthWrite: true,
    });

    this.door = new THREE.Mesh(doorGeo, doorMat);
    this.door.castShadow = true;
    this.door.renderOrder = 21;
    this.door.userData.isDoor = true;
    this.doorPivot.add(this.door);
    this.doorPickables.push(this.door);

    const rimMat = new THREE.MeshStandardMaterial({
      color: 0xf3f1ed,
      roughness: 0.38,
      metalness: 0.05,
    });
    const rimT = 0.07;
    const topRim = new THREE.Mesh(
      new THREE.BoxGeometry(doorW, rimT, 0.045),
      rimMat
    );
    topRim.geometry.translate(doorW / 2, 0, 0);
    topRim.position.set(0, doorH / 2 - rimT / 2, 0.02);
    topRim.renderOrder = 22;
    topRim.userData.isDoor = true;
    this.doorPivot.add(topRim);
    this.doorPickables.push(topRim);

    const botRim = topRim.clone();
    botRim.position.y = -doorH / 2 + rimT / 2;
    botRim.renderOrder = 22;
    botRim.userData.isDoor = true;
    this.doorPivot.add(botRim);
    this.doorPickables.push(botRim);

    const sideRim = new THREE.Mesh(
      new THREE.BoxGeometry(rimT, doorH - rimT * 2, 0.045),
      rimMat
    );
    sideRim.geometry.translate(rimT / 2, 0, 0);
    sideRim.position.set(doorW - rimT, 0, 0.01);
    sideRim.userData.isDoor = true;
    this.doorPivot.add(sideRim);
    this.doorPickables.push(sideRim);

    const latch = new THREE.Mesh(
      new THREE.BoxGeometry(0.11, 0.3, 0.08),
      new THREE.MeshStandardMaterial({
        color: 0x151515,
        roughness: 0.4,
        metalness: 0.35,
      })
    );
    latch.position.set(doorW - 0.09, 0, 0.05);
    latch.userData.isDoor = true;
    this.doorPivot.add(latch);
    this.doorPickables.push(latch);

    const latchKnob = new THREE.Mesh(
      new THREE.CylinderGeometry(0.042, 0.042, 0.07, 16),
      new THREE.MeshStandardMaterial({
        color: 0x0d0d0d,
        roughness: 0.32,
        metalness: 0.45,
      })
    );
    latchKnob.rotation.z = Math.PI / 2;
    latchKnob.position.set(doorW - 0.02, 0, 0.08);
    latchKnob.userData.isDoor = true;
    this.doorPivot.add(latchKnob);
    this.doorPickables.push(latchKnob);

    this.doorClosedRotation = 0;
    this.doorOpenRotation = -Math.PI * 0.92;
    this.doorPivot.rotation.y = this.doorClosedRotation;
    this.boxW = boxW;
  }

  _makeBody(width, height, depth, color = 0xfffdf8) {
    const group = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(width * 0.97, height, depth),
      new THREE.MeshStandardMaterial({
        color,
        roughness: 0.32,
        metalness: 0.06,
      })
    );
    body.castShadow = true;
    body.receiveShadow = true;
    group.add(body);

    // Top / bottom terminal notches
    const notchMat = new THREE.MeshStandardMaterial({
      color: 0xc8d0da,
      roughness: 0.5,
    });
    for (const y of [height * 0.42, -height * 0.42]) {
      const notch = new THREE.Mesh(
        new THREE.BoxGeometry(width * 0.7, 0.06, 0.08),
        notchMat
      );
      notch.position.set(0, y, depth / 2 - 0.02);
      group.add(notch);
    }
    return group;
  }

  _makeToggle(color, isOn) {
    const group = new THREE.Group();
    const housing = new THREE.Mesh(
      new THREE.BoxGeometry(0.085, 0.2, 0.07),
      new THREE.MeshStandardMaterial({ color: 0xfff8f0, roughness: 0.35 })
    );
    group.add(housing);

    const lever = new THREE.Mesh(
      new THREE.BoxGeometry(0.058, 0.18, 0.045),
      new THREE.MeshStandardMaterial({
        color,
        roughness: 0.28,
        metalness: 0.18,
        emissive: color,
        emissiveIntensity: 0.12,
      })
    );
    lever.position.y = isOn ? 0.09 : -0.09;
    lever.position.z = 0.025;
    lever.rotation.x = isOn ? -0.4 : 0.4;
    group.add(lever);

    // Cap tip
    const tip = new THREE.Mesh(
      new THREE.BoxGeometry(0.058, 0.035, 0.05),
      new THREE.MeshStandardMaterial({
        color,
        roughness: 0.22,
        metalness: 0.2,
        emissive: color,
        emissiveIntensity: 0.18,
      })
    );
    tip.position.y = isOn ? 0.17 : -0.17;
    tip.position.z = 0.03;
    group.add(tip);
    return group;
  }

  _makeLabelSprite(text, scale = 0.22, color = "#222222", fontSize = 28) {
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 64;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, 256, 64);
    ctx.fillStyle = color;
    ctx.font = `bold ${fontSize}px system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, 128, 32);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.SpriteMaterial({
      map: tex,
      transparent: true,
      depthTest: true,
      depthWrite: false,
    });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(scale, scale * 0.25, 1);
    sprite.renderOrder = 2;
    return sprite;
  }

  _makeHighlight(w, h, d) {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(w * 1.06, h * 1.06, d * 1.1),
      new THREE.MeshBasicMaterial({
        color: 0x2f80ed,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      })
    );
    mesh.position.z = 0.01;
    return mesh;
  }

  _makeMcb(data, width, index) {
    const group = this._makeBody(width, MCB_H, MCB_D);

    // Green Schneider brand strip
    const strip = new THREE.Mesh(
      new THREE.BoxGeometry(width * 0.9, 0.08, 0.012),
      new THREE.MeshStandardMaterial({
        color: 0x19d64a,
        roughness: 0.32,
        metalness: 0.1,
        emissive: 0x0d8028,
        emissiveIntensity: 0.35,
      })
    );
    strip.position.set(0, 0.38, MCB_D / 2 + 0.01);
    group.add(strip);

    const toggle = this._makeToggle(0xff6200, data.isOn);
    toggle.position.set(0, 0.08, MCB_D / 2 + 0.01);
    group.add(toggle);

    const brand = this._makeLabelSprite("Schneider", 0.15, "#0b5c2a", 24);
    brand.position.set(0, 0.3, MCB_D / 2 + 0.025);
    group.add(brand);

    const model = this._makeLabelSprite("BA63", 0.12, "#2a4a6a", 22);
    model.position.set(0, -0.22, MCB_D / 2 + 0.025);
    group.add(model);

    const rating = this._makeLabelSprite("C25", 0.13, "#c43a00", 26);
    rating.position.set(0, -0.36, MCB_D / 2 + 0.025);
    group.add(rating);

    // Handwritten label above 8th breaker (index 7)
    if (index === 7) {
      const note = this._makeLabelSprite("СВ-WIFI", 0.17, "#0a3d8f", 26);
      note.position.set(0, 0.48, MCB_D / 2 + 0.03);
      group.add(note);
    }

    group.userData.highlight = this._makeHighlight(width, MCB_H, MCB_D);
    group.add(group.userData.highlight);
    return group;
  }

  _makeRelay(data, width) {
    const group = this._makeBody(width, MCB_H, MCB_D, 0xfff5ee);

    // Accent side stripe
    const accent = new THREE.Mesh(
      new THREE.BoxGeometry(0.03, MCB_H * 0.9, 0.01),
      new THREE.MeshStandardMaterial({
        color: 0xe53935,
        emissive: 0x881818,
        emissiveIntensity: 0.25,
      })
    );
    accent.position.set(-width * 0.42, 0, MCB_D / 2 + 0.01);
    group.add(accent);

    // Black display bezel
    const bezel = new THREE.Mesh(
      new THREE.BoxGeometry(width * 0.58, 0.28, 0.04),
      new THREE.MeshStandardMaterial({ color: 0x1a0a0a, roughness: 0.3 })
    );
    bezel.position.set(-0.05, 0.14, MCB_D / 2 + 0.01);
    group.add(bezel);

    const screen = new THREE.Mesh(
      new THREE.PlaneGeometry(width * 0.5, 0.2),
      new THREE.MeshStandardMaterial({
        color: 0x3a0808,
        emissive: 0xff2a2a,
        emissiveIntensity: 1.25,
        roughness: 0.2,
      })
    );
    screen.position.set(-0.05, 0.14, MCB_D / 2 + 0.032);
    group.add(screen);

    const voltage = this._makeLabelSprite(
      String(data.voltage ?? 239),
      0.3,
      "#ff6666",
      36
    );
    voltage.position.set(-0.05, 0.14, MCB_D / 2 + 0.05);
    group.add(voltage);

    const btnMat = new THREE.MeshStandardMaterial({
      color: 0xf2f2f2,
      roughness: 0.38,
    });
    const labels = ["+", "i", "−"];
    for (let i = 0; i < 3; i++) {
      const btn = new THREE.Mesh(
        new THREE.CylinderGeometry(0.028, 0.028, 0.022, 14),
        btnMat
      );
      btn.rotation.x = Math.PI / 2;
      btn.position.set(width * 0.3, 0.26 - i * 0.11, MCB_D / 2 + 0.015);
      group.add(btn);
      const lbl = this._makeLabelSprite(labels[i], 0.08, "#333333", 30);
      lbl.position.set(width * 0.3, 0.26 - i * 0.11, MCB_D / 2 + 0.04);
      group.add(lbl);
    }

    // Status LEDs
    const ledG = new THREE.Mesh(
      new THREE.CircleGeometry(0.014, 12),
      new THREE.MeshStandardMaterial({
        color: 0x2dff6a,
        emissive: 0x00cc44,
        emissiveIntensity: 1.2,
      })
    );
    ledG.position.set(width * 0.12, 0.32, MCB_D / 2 + 0.02);
    group.add(ledG);

    const ledR = new THREE.Mesh(
      new THREE.CircleGeometry(0.012, 12),
      new THREE.MeshStandardMaterial({
        color: 0xffaa33,
        emissive: 0xff8800,
        emissiveIntensity: 0.7,
      })
    );
    ledR.position.set(width * 0.12, 0.26, MCB_D / 2 + 0.02);
    group.add(ledR);

    const brand = this._makeLabelSprite("ZUBR D40", 0.24, "#b71c1c", 26);
    brand.position.set(0, -0.28, MCB_D / 2 + 0.025);
    group.add(brand);

    const sub = this._makeLabelSprite("40A · 8800VA", 0.18, "#5a3a20", 20);
    sub.position.set(0, -0.38, MCB_D / 2 + 0.025);
    group.add(sub);

    group.userData.highlight = this._makeHighlight(width, MCB_H, MCB_D);
    group.add(group.userData.highlight);
    return group;
  }

  _makeRcd(data, width) {
    const group = this._makeBody(width, MCB_H, MCB_D, 0xf8fbff);

    // Blue IEK accent bar
    const bar = new THREE.Mesh(
      new THREE.BoxGeometry(width * 0.9, 0.06, 0.012),
      new THREE.MeshStandardMaterial({
        color: 0x1565c0,
        emissive: 0x0d47a1,
        emissiveIntensity: 0.3,
      })
    );
    bar.position.set(0, 0.4, MCB_D / 2 + 0.01);
    group.add(bar);

    const brandTop = this._makeLabelSprite("IEK", 0.16, "#0d47a1", 26);
    brandTop.position.set(0, 0.32, MCB_D / 2 + 0.025);
    group.add(brandTop);

    const toggle = this._makeToggle(0xffe000, data.isOn);
    toggle.position.set(0, 0.12, MCB_D / 2 + 0.01);
    group.add(toggle);

    const testBtn = new THREE.Mesh(
      new THREE.BoxGeometry(0.09, 0.09, 0.035),
      new THREE.MeshStandardMaterial({ color: 0x6a6a6a, roughness: 0.42 })
    );
    testBtn.position.set(0, -0.06, MCB_D / 2 + 0.025);
    group.add(testBtn);

    const tLabel = this._makeLabelSprite("T", 0.1, "#ffffff", 32);
    tLabel.position.set(0, -0.06, MCB_D / 2 + 0.05);
    group.add(tLabel);

    const brand = this._makeLabelSprite("ВД1-63", 0.18, "#222222", 22);
    brand.position.set(0, -0.26, MCB_D / 2 + 0.025);
    group.add(brand);

    const specs = this._makeLabelSprite("32A · 30mA", 0.18, "#333333", 20);
    specs.position.set(0, -0.38, MCB_D / 2 + 0.025);
    group.add(specs);

    group.userData.highlight = this._makeHighlight(width, MCB_H, MCB_D);
    group.add(group.userData.highlight);
    return group;
  }

  _bindEvents() {
    window.addEventListener("resize", () => this._onResize());

    this.canvas.addEventListener("pointerdown", (e) => {
      this._pointerDown = { x: e.clientX, y: e.clientY, t: performance.now() };
    });

    this.canvas.addEventListener("pointerup", (e) => {
      if (!this._pointerDown) return;
      const dx = e.clientX - this._pointerDown.x;
      const dy = e.clientY - this._pointerDown.y;
      const dt = performance.now() - this._pointerDown.t;
      this._pointerDown = null;
      if (Math.hypot(dx, dy) > 10 || dt > 500) return;
      this._onTap(e.clientX, e.clientY);
    });

    if (this.ui.openBtn) {
      this.ui.openBtn.addEventListener("click", () => this.toggleDoor());
    }
    if (this.ui.closeInfoBtn) {
      this.ui.closeInfoBtn.addEventListener("click", () => this.clearSelection());
    }
    if (this.ui.resetBtn) {
      this.ui.resetBtn.addEventListener("click", () => this.resetView());
    }
  }

  _onResize() {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (!w || !h) return;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
  }

  _setPointerFromClient(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
  }

  _onTap(clientX, clientY) {
    this._setPointerFromClient(clientX, clientY);
    this.raycaster.setFromCamera(this.pointer, this.camera);

    if (!this.doorOpen || this.doorAnimating) {
      const doorHits = this.raycaster.intersectObjects(this.doorPickables, true);
      if (doorHits.length || !this.doorOpen) {
        if (!this.doorOpen) {
          this.toggleDoor(true);
          return;
        }
        if (doorHits.length) {
          this.toggleDoor(false);
          return;
        }
      }
    }

    if (!this.doorOpen || this.doorAnimating) return;

    const hits = this.raycaster.intersectObjects(this.pickables, true);
    if (!hits.length) {
      this.clearSelection();
      return;
    }

    let id = null;
    for (const hit of hits) {
      if (hit.object.userData.breakerId) {
        id = hit.object.userData.breakerId;
        break;
      }
    }
    if (id) this.selectBreaker(id);
  }

  toggleDoor(forceOpen) {
    if (this.doorAnimating) return;
    const next =
      typeof forceOpen === "boolean" ? forceOpen : !this.doorOpen;
    if (next === this.doorOpen) return;

    this.doorAnimating = true;
    const from = this.doorPivot.rotation.y;
    const to = next ? this.doorOpenRotation : this.doorClosedRotation;
    const duration = 900;
    const start = performance.now();
    const c = this._viewCenter || new THREE.Vector3(0, 0, 0);
    const fromPos = this.camera.position.clone();
    const toPos = new THREE.Vector3(
      c.x,
      c.y * 0.15,
      c.z + (next ? CAM_Z_OPEN : CAM_Z_CLOSED)
    );

    if (!next) this.clearSelection();

    const step = (now) => {
      const t = Math.min(1, (now - start) / duration);
      const e = easeInOutCubic(t);
      this.doorPivot.rotation.y = from + (to - from) * e;
      this.camera.position.lerpVectors(fromPos, toPos, e);

      if (t < 1) {
        requestAnimationFrame(step);
      } else {
        this.doorOpen = next;
        this.doorAnimating = false;
        this.controls.enableRotate = next;
        this._updateHint();
        if (this.ui.openBtn) {
          this.ui.openBtn.textContent = next
            ? "Закрити дверцята"
            : "Відкрити дверцята";
        }
      }
    };
    requestAnimationFrame(step);
  }

  selectBreaker(id) {
    const data = BREAKERS.find((b) => b.id === id);
    if (!data) return;

    this.selectedId = id;
    for (const [bid, mesh] of this.deviceMeshes) {
      const hl = mesh.userData.highlight;
      if (hl) hl.material.opacity = bid === id ? 0.22 : 0;
    }

    if (this.ui.infoCard) {
      this.ui.infoCard.hidden = false;
      if (this.ui.infoTitle) this.ui.infoTitle.textContent = data.title;
      if (this.ui.infoLabel) this.ui.infoLabel.textContent = data.label;
      if (this.ui.infoDesc) this.ui.infoDesc.textContent = data.description;
    }

    const mesh = this.deviceMeshes.get(id);
    if (!mesh) return;

    const world = new THREE.Vector3();
    mesh.getWorldPosition(world);

    const fromPos = this.camera.position.clone();
    const fromTarget = this.controls.target.clone();
    const toTarget = world.clone();
    const toPos = world.clone().add(new THREE.Vector3(0.12, 0.08, 2.2));

    const duration = 650;
    const start = performance.now();
    const animate = (now) => {
      const t = Math.min(1, (now - start) / duration);
      const e = easeInOutCubic(t);
      this.camera.position.lerpVectors(fromPos, toPos, e);
      this.controls.target.lerpVectors(fromTarget, toTarget, e);
      if (t < 1) requestAnimationFrame(animate);
    };
    requestAnimationFrame(animate);
  }

  clearSelection() {
    this.selectedId = null;
    for (const mesh of this.deviceMeshes.values()) {
      const hl = mesh.userData.highlight;
      if (hl) hl.material.opacity = 0;
    }
    if (this.ui.infoCard) this.ui.infoCard.hidden = true;
  }

  resetView() {
    this.clearSelection();
    const fromPos = this.camera.position.clone();
    const fromTarget = this.controls.target.clone();
    const c = this._viewCenter || new THREE.Vector3(0, 0, 0);
    const toPos = new THREE.Vector3(
      c.x,
      c.y * 0.15,
      c.z + (this.doorOpen ? CAM_Z_OPEN : CAM_Z_CLOSED)
    );
    const toTarget = c.clone();
    const start = performance.now();
    const animate = (now) => {
      const t = Math.min(1, (now - start) / 600);
      const e = easeInOutCubic(t);
      this.camera.position.lerpVectors(fromPos, toPos, e);
      this.controls.target.lerpVectors(fromTarget, toTarget, e);
      if (t < 1) requestAnimationFrame(animate);
    };
    requestAnimationFrame(animate);
  }

  _updateHint() {
    if (!this.ui.hint) return;
    if (!this.doorOpen) {
      this.ui.hint.textContent =
        PANEL_INFO.subtitle || "Натисни на щиток, щоб відкрити дверцята";
    } else {
      this.ui.hint.textContent =
        "Обери автомат · щипком можна наблизити · пальцем обертати";
    }
  }

  _loop() {
    this._raf = requestAnimationFrame(() => this._loop());
    this.controls.update();

    const zubr = this.deviceMeshes.get("zubr");
    if (zubr) {
      zubr.traverse((c) => {
        if (c.isMesh && c.material && c.material.emissive) {
          c.material.emissiveIntensity =
            0.8 + Math.sin(performance.now() * 0.003) * 0.15;
        }
      });
    }

    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    cancelAnimationFrame(this._raf);
    this.controls.dispose();
    this.renderer.dispose();
  }
}
