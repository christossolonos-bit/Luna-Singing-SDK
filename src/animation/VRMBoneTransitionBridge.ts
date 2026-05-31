import * as THREE from "three";
import { VRMHumanBoneName, type VRM } from "@pixiv/three-vrm";

/** Bones used for motion-stop detection and pose bridging. */
export const TRANSITION_BONES: VRMHumanBoneName[] = [
  VRMHumanBoneName.Hips,
  VRMHumanBoneName.Spine,
  VRMHumanBoneName.Chest,
  VRMHumanBoneName.UpperChest,
  VRMHumanBoneName.Neck,
  VRMHumanBoneName.Head,
  VRMHumanBoneName.LeftShoulder,
  VRMHumanBoneName.RightShoulder,
  VRMHumanBoneName.LeftUpperArm,
  VRMHumanBoneName.RightUpperArm,
  VRMHumanBoneName.LeftLowerArm,
  VRMHumanBoneName.RightLowerArm,
  VRMHumanBoneName.LeftHand,
  VRMHumanBoneName.RightHand,
  VRMHumanBoneName.LeftUpperLeg,
  VRMHumanBoneName.RightUpperLeg,
  VRMHumanBoneName.LeftLowerLeg,
  VRMHumanBoneName.RightLowerLeg,
  VRMHumanBoneName.LeftFoot,
  VRMHumanBoneName.RightFoot,
];

type BonePose = {
  boneName: VRMHumanBoneName;
  node: THREE.Object3D;
  from: THREE.Quaternion;
  to: THREE.Quaternion;
};

type HipsShift = {
  node: THREE.Object3D;
  from: THREE.Vector3;
  to: THREE.Vector3;
};

/** Detect when the avatar's bones stop moving between frames. */
export class MotionStopDetector {
  private readonly prev = new Map<string, THREE.Quaternion>();
  private stillFor = 0;

  reset(): void {
    this.prev.clear();
    this.stillFor = 0;
  }

  /**
   * @param threshold Max bone rotation change (radians) per frame to count as still.
   * @param holdSec How long stillness must last before returning true.
   */
  update(vrm: VRM, delta: number, threshold = 0.007, holdSec = 0.14): boolean {
    let maxDelta = 0;

    for (const boneName of TRANSITION_BONES) {
      const node = vrm.humanoid?.getNormalizedBoneNode(boneName);
      if (!node) continue;

      const key = node.name;
      const prevQ = this.prev.get(key);
      if (prevQ) {
        maxDelta = Math.max(maxDelta, prevQ.angleTo(node.quaternion));
      }
      this.prev.set(key, node.quaternion.clone());
    }

    if (maxDelta < threshold) {
      this.stillFor += delta;
    } else {
      this.stillFor = 0;
    }

    return this.stillFor >= holdSec;
  }
}

/** Sample rotation tracks from a clip at a given time. */
export function sampleClipRotations(
  clip: THREE.AnimationClip,
  vrm: VRM,
  time = 0,
): Map<VRMHumanBoneName, THREE.Quaternion> {
  const out = new Map<VRMHumanBoneName, THREE.Quaternion>();
  const humanoid = vrm.humanoid;
  if (!humanoid) return out;

  const trackByNode = new Map<string, THREE.QuaternionKeyframeTrack>();
  for (const track of clip.tracks) {
    if (track instanceof THREE.QuaternionKeyframeTrack) {
      trackByNode.set(track.name.replace(/\.quaternion$/i, ""), track);
    }
  }

  for (const boneName of TRANSITION_BONES) {
    const node = humanoid.getNormalizedBoneNode(boneName);
    if (!node) continue;

    const track = trackByNode.get(node.name);
    if (!track) continue;

    out.set(boneName, sampleQuaternionAt(track, time));
  }

  return out;
}

function sampleQuaternionAt(
  track: THREE.QuaternionKeyframeTrack,
  time: number,
): THREE.Quaternion {
  const q = new THREE.Quaternion();
  const { times, values } = track;

  if (times.length === 0) return q;
  if (time <= times[0]!) {
    return q.fromArray(values, 0);
  }

  const last = times.length - 1;
  if (time >= times[last]!) {
    return q.fromArray(values, last * 4);
  }

  for (let i = 0; i < last; i++) {
    const t0 = times[i]!;
    const t1 = times[i + 1]!;
    if (time >= t0 && time < t1) {
      const blend = (time - t0) / (t1 - t0);
      const q0 = new THREE.Quaternion().fromArray(values, i * 4);
      const q1 = new THREE.Quaternion().fromArray(values, (i + 1) * 4);
      return q0.slerp(q1, blend);
    }
  }

  return q.fromArray(values, 0);
}

/** Sample hips translation at a given time (if present). */
export function sampleHipsPositionAt(
  clip: THREE.AnimationClip,
  vrm: VRM,
  time = 0,
): THREE.Vector3 | null {
  const hips = vrm.humanoid?.getNormalizedBoneNode(VRMHumanBoneName.Hips);
  if (!hips) return null;

  const trackName = `${hips.name}.position`;
  const track = clip.tracks.find(
    (t): t is THREE.VectorKeyframeTrack =>
      t instanceof THREE.VectorKeyframeTrack && t.name === trackName,
  );
  if (!track) return null;

  const v = new THREE.Vector3();
  const { times, values } = track;
  if (times.length === 0) return v;

  if (time <= times[0]!) {
    return v.fromArray(values, 0);
  }

  const last = times.length - 1;
  if (time >= times[last]!) {
    return v.fromArray(values, last * 3);
  }

  for (let i = 0; i < last; i++) {
    const t0 = times[i]!;
    const t1 = times[i + 1]!;
    if (time >= t0 && time < t1) {
      const blend = (time - t0) / (t1 - t0);
      const v0 = new THREE.Vector3().fromArray(values, i * 3);
      const v1 = new THREE.Vector3().fromArray(values, (i + 1) * 3);
      return v0.lerp(v1, blend);
    }
  }

  return v.fromArray(values, 0);
}

/** Slerp humanoid bones from the current pose toward a target clip's start pose. */
export class VRMBoneTransitionBridge {
  private readonly poses: BonePose[] = [];
  private hipsShift: HipsShift | null = null;
  private elapsed = 0;
  private duration = 0.35;
  private active = false;

  get isActive(): boolean {
    return this.active;
  }

  begin(
    vrm: VRM,
    targetClip: THREE.AnimationClip,
    durationSec: number,
  ): boolean {
    const humanoid = vrm.humanoid;
    if (!humanoid) return false;

    const targetPose = sampleClipRotations(targetClip, vrm, 0);
    if (targetPose.size === 0) return false;

    this.poses.length = 0;

    for (const boneName of TRANSITION_BONES) {
      const node = humanoid.getNormalizedBoneNode(boneName);
      const to = targetPose.get(boneName);
      if (!node || !to) continue;

      this.poses.push({
        boneName,
        node,
        from: node.quaternion.clone(),
        to: to.clone(),
      });
    }

    if (this.poses.length === 0) return false;

    const hipsNode = humanoid.getNormalizedBoneNode(VRMHumanBoneName.Hips);
    const targetHips = sampleHipsPositionAt(targetClip, vrm, 0);
    if (hipsNode && targetHips) {
      this.hipsShift = {
        node: hipsNode,
        from: hipsNode.position.clone(),
        to: targetHips.clone(),
      };
    } else {
      this.hipsShift = null;
    }

    this.elapsed = 0;
    this.duration = Math.max(0.12, durationSec);
    this.active = true;
    return true;
  }

  /** @returns true when the bridge finished. */
  update(delta: number): boolean {
    if (!this.active) return false;

    this.elapsed += delta;
    const t = Math.min(1, this.elapsed / this.duration);
    const ease = t * t * (3 - 2 * t);

    for (const pose of this.poses) {
      pose.node.quaternion.copy(pose.from).slerp(pose.to, ease);
    }

    if (this.hipsShift) {
      this.hipsShift.node.position.copy(this.hipsShift.from).lerp(this.hipsShift.to, ease);
    }

    if (t >= 1) {
      this.active = false;
      this.hipsShift = null;
      return true;
    }

    return false;
  }

  cancel(): void {
    this.active = false;
    this.poses.length = 0;
    this.hipsShift = null;
    this.elapsed = 0;
  }
}
