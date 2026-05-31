import * as THREE from "three";
import { CSS2DObject, CSS2DRenderer } from "three/addons/renderers/CSS2DRenderer.js";
import { DEFAULT_DOCK_POSITION, dockPositionFromViewerCenter } from "./dockDefaults";

export type DockAction =
  | "vrm-upload"
  | "vrm-reset"
  | "background-upload"
  | "background-reset"
  | "stems-load"
  | "stems-play-pause"
  | "luna-speak";

type DockOptions = {
  container: HTMLElement;
  onAction: (action: DockAction) => void;
};

const ICONS: Record<DockAction, string> = {
  "vrm-upload": `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="12" cy="8" r="4"/>
      <path d="M4 20c0-3.3 3.6-6 8-6s8 2.7 8 6"/>
      <path d="M18 3v6"/>
      <path d="M15 6h6"/>
    </svg>`,
  "vrm-reset": `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="12" cy="8" r="4"/>
      <path d="M4 20c0-3.3 3.6-6 8-6s8 2.7 8 6"/>
      <path d="M12 11v6"/>
      <path d="M9 14l3-3 3 3"/>
    </svg>`,
  "background-upload": `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2"/>
      <circle cx="8.5" cy="8.5" r="1.5"/>
      <path d="M21 15l-5-5L5 21"/>
    </svg>`,
  "background-reset": `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
      <path d="M3 7v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2H5a2 2 0 0 0-2-2z"/>
      <path d="M8 21V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v16"/>
    </svg>`,
  "stems-load": `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
      <path d="M9 18V5l12-2v13"/>
      <circle cx="6" cy="18" r="3"/>
      <circle cx="18" cy="16" r="3"/>
    </svg>`,
  "stems-play-pause": `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
      <polygon points="5 3 19 12 5 21 5 3"/>
    </svg>`,
  "luna-speak": `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
      <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
      <line x1="12" y1="19" x2="12" y2="23"/>
      <line x1="8" y1="23" x2="16" y2="23"/>
    </svg>`,
};

const TOOLTIPS: Record<DockAction, string> = {
  "vrm-upload": "Upload VRM avatar",
  "vrm-reset": "Reset to Luna avatar",
  "background-upload": "Upload background",
  "background-reset": "Reset background",
  "stems-load": "Load music & vocals stems",
  "stems-play-pause": "Play / pause track",
  "luna-speak": "Luna speak (Edge TTS)",
};

export class Dock {
  readonly object: CSS2DObject;
  private readonly labelRenderer: CSS2DRenderer;

  constructor(options: DockOptions) {
    const element = document.createElement("div");
    element.className = "dock dock-scene";
    element.setAttribute("role", "toolbar");
    element.setAttribute("aria-label", "Avatar controls");

    const actions: DockAction[] = [
      "vrm-upload",
      "vrm-reset",
      "luna-speak",
      "stems-load",
      "stems-play-pause",
      "background-upload",
      "background-reset",
    ];

    for (const action of actions) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "dock-btn";
      btn.dataset.action = action;
      btn.title = TOOLTIPS[action];
      btn.setAttribute("aria-label", TOOLTIPS[action]);
      btn.innerHTML = ICONS[action];
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        options.onAction(action);
      });
      element.appendChild(btn);
    }

    this.object = new CSS2DObject(element);
    this.object.position.copy(DEFAULT_DOCK_POSITION);

    this.labelRenderer = new CSS2DRenderer();
    this.labelRenderer.setSize(window.innerWidth, window.innerHeight);
    this.labelRenderer.domElement.className = "dock-layer";
    options.container.appendChild(this.labelRenderer.domElement);
  }

  addToScene(scene: THREE.Scene): void {
    scene.add(this.object);
  }

  setPosition(x: number, y: number, z: number): void {
    this.object.position.set(x, y, z);
  }

  setPositionFromVector(position: THREE.Vector3): void {
    this.object.position.copy(position);
  }

  resetToDefault(camera?: THREE.Camera): void {
    if (camera) {
      this.object.position.copy(dockPositionFromViewerCenter(camera));
      return;
    }
    this.object.position.copy(DEFAULT_DOCK_POSITION);
  }

  setSize(width: number, height: number): void {
    this.labelRenderer.setSize(width, height);
  }

  render(scene: THREE.Scene, camera: THREE.Camera): void {
    this.labelRenderer.render(scene, camera);
  }

  dispose(): void {
    this.object.removeFromParent();
    this.labelRenderer.domElement.remove();
  }
}
