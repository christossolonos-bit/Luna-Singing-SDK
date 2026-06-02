import * as THREE from "three";
import { VRMHumanBoneName, type VRM } from "@pixiv/three-vrm";
import { VISEMES } from "wawa-lipsync";
import type { VRMVisemeDriver } from "./VRMVisemeDriver";
import {
  HEAD_PITCH_BY_CATEGORY,
  phoneticCategory,
} from "./phonetics";
import { jawOpennessFromVowels } from "./vowelBlend";

const MAX_JAW_OPEN = 0.15;
const VOCALS_GATE = 0.045;

export class VRMPhoneticBoneDriver {
  private readonly jawAxis = new THREE.Vector3(1, 0, 0);
  private readonly headAxis = new THREE.Vector3(1, 0, 0);
  private readonly tmpQuat = new THREE.Quaternion();

  private jaw: THREE.Object3D | null = null;
  private head: THREE.Object3D | null = null;
  private jawRest: THREE.Quaternion | null = null;
  private headRest: THREE.Quaternion | null = null;
  private currentJawOpen = 0;
  private currentHeadPitch = 0;
  private restCaptured = false;
  /** Performance driver owns head motion while procedural singing is active. */
  headMotionEnabled = true;

  constructor(
    private readonly vrm: VRM,
    private readonly visemeDriver: VRMVisemeDriver,
  ) {
    this.jaw = vrm.humanoid?.getNormalizedBoneNode(VRMHumanBoneName.Jaw) ?? null;
    this.head = vrm.humanoid?.getNormalizedBoneNode(VRMHumanBoneName.Head) ?? null;
  }

  update(smoothing = 0.32): void {
    this.captureRestIfNeeded();

    if (!this.visemeDriver.isActive) {
      this.fadeToRest(smoothing);
      return;
    }

    const level = this.visemeDriver.vocalLevel;
    if (level < VOCALS_GATE) {
      this.fadeToRest(smoothing);
      return;
    }

    const viseme = this.visemeDriver.currentViseme;
    const vw = this.visemeDriver.vowelWeights;
    const vowelOpen = jawOpennessFromVowels(vw);
    const jawTarget = vowelOpen * MAX_JAW_OPEN * Math.min(1, level * 3.2);
    const headTarget =
      HEAD_PITCH_BY_CATEGORY[phoneticCategory(viseme)] * Math.min(1, level * 3);

    this.currentJawOpen += (jawTarget - this.currentJawOpen) * smoothing;
    if (this.headMotionEnabled) {
      this.currentHeadPitch += (headTarget - this.currentHeadPitch) * smoothing;
    } else {
      this.currentHeadPitch += (0 - this.currentHeadPitch) * smoothing;
    }

    this.applyJaw(this.currentJawOpen);
    if (this.headMotionEnabled) {
      this.applyHeadPitch(this.currentHeadPitch);
    }
  }

  reset(): void {
    this.currentJawOpen = 0;
    this.currentHeadPitch = 0;
    this.applyJaw(0);
    if (this.headMotionEnabled) {
      this.applyHeadPitch(0);
    }
  }

  private captureRestIfNeeded(): void {
    if (this.restCaptured) return;

    if (this.jaw) {
      this.jawRest = this.jaw.quaternion.clone();
    }
    if (this.head) {
      this.headRest = this.head.quaternion.clone();
    }
    this.restCaptured = Boolean(this.jawRest || this.headRest);
  }

  private fadeToRest(smoothing: number): void {
    this.currentJawOpen += (0 - this.currentJawOpen) * smoothing;
    this.currentHeadPitch += (0 - this.currentHeadPitch) * smoothing;
    this.applyJaw(this.currentJawOpen);
    this.applyHeadPitch(this.currentHeadPitch);
  }

  private applyJaw(openRadians: number): void {
    if (!this.jaw || !this.jawRest) return;

    this.tmpQuat.setFromAxisAngle(this.jawAxis, openRadians);
    this.jaw.quaternion.copy(this.jawRest).multiply(this.tmpQuat);
  }

  private applyHeadPitch(pitch: number): void {
    if (!this.head || !this.headRest) return;

    this.tmpQuat.setFromAxisAngle(this.headAxis, pitch);
    this.head.quaternion.copy(this.headRest).multiply(this.tmpQuat);
  }
}
