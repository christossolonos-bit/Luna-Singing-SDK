import * as THREE from "three";

export const DEFAULT_DOCK_POSITION = new THREE.Vector3(0, 0.85, 0.55);

/** Raycast the viewport center to place the dock in front of the avatar. */
export function dockPositionFromViewerCenter(
  camera: THREE.Camera,
  y = DEFAULT_DOCK_POSITION.y,
): THREE.Vector3 {
  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(new THREE.Vector2(0, -0.12), camera);

  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -y);
  const hit = new THREE.Vector3();
  if (raycaster.ray.intersectPlane(plane, hit)) {
    return hit;
  }

  return DEFAULT_DOCK_POSITION.clone();
}
