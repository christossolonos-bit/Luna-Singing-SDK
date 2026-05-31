import * as THREE from "three";
import type { CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";

type DockDragOptions = {
  dockObject: CSS2DObject;
  camera: THREE.Camera;
  canvas: HTMLElement;
  onDraggingChange?: (dragging: boolean) => void;
};

export class DockDragController {
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly intersection = new THREE.Vector3();
  private readonly plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private readonly element: HTMLElement;
  private readonly camera: THREE.Camera;
  private readonly canvas: HTMLElement;
  private readonly dockObject: CSS2DObject;
  private readonly onDraggingChange?: (dragging: boolean) => void;
  private dragging = false;

  constructor(options: DockDragOptions) {
    this.dockObject = options.dockObject;
    this.camera = options.camera;
    this.canvas = options.canvas;
    this.onDraggingChange = options.onDraggingChange;
    this.element = options.dockObject.element;

    this.element.addEventListener("pointerdown", this.onPointerDown);
  }

  dispose(): void {
    this.element.removeEventListener("pointerdown", this.onPointerDown);
    this.endDrag();
  }

  private onPointerDown = (event: PointerEvent): void => {
    if ((event.target as HTMLElement).closest(".dock-btn")) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    this.plane.constant = -this.dockObject.position.y;

    this.dragging = true;
    this.element.setPointerCapture(event.pointerId);
    this.element.classList.add("is-dragging");
    this.onDraggingChange?.(true);
    this.moveToCursor(event);

    window.addEventListener("pointermove", this.onPointerMove);
    window.addEventListener("pointerup", this.onPointerUp);
    window.addEventListener("pointercancel", this.onPointerUp);
  };

  private onPointerMove = (event: PointerEvent): void => {
    if (!this.dragging) return;
    this.moveToCursor(event);
  };

  private onPointerUp = (): void => {
    this.endDrag();
  };

  private endDrag(): void {
    if (!this.dragging) return;

    this.dragging = false;
    this.element.classList.remove("is-dragging");
    this.onDraggingChange?.(false);

    window.removeEventListener("pointermove", this.onPointerMove);
    window.removeEventListener("pointerup", this.onPointerUp);
    window.removeEventListener("pointercancel", this.onPointerUp);
  }

  private moveToCursor(event: PointerEvent): void {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.pointer, this.camera);

    if (!this.raycaster.ray.intersectPlane(this.plane, this.intersection)) {
      return;
    }

    this.dockObject.position.copy(this.intersection);
  }
}
