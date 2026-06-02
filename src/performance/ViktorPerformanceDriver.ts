import * as THREE from "three";
import { VRMHumanBoneName, type VRM } from "@pixiv/three-vrm";
import type { SongGenre } from "../animation/danceAnimations";
import type { StemMixer } from "../audio/StemMixer";
import type { VRMPhoneticBoneDriver } from "../lipsync/VRMPhoneticBoneDriver";
import {
  sectionAtTime,
  type PerformanceMap,
  type PerformanceSectionKind,
} from "./ViktorPerformanceAnalysis";

type GenreStyle = {
  sway: number;
  bounce: number;
  smooth: number;
  figureEight: number;
  armPulse: number;
};

const GENRE_STYLES: Record<SongGenre, GenreStyle> = {
  "hip-hop": { sway: 1.25, bounce: 1.35, smooth: 0.38, figureEight: 0.25, armPulse: 1.3 },
  jazz: { sway: 0.82, bounce: 0.55, smooth: 0.78, figureEight: 0.65, armPulse: 0.7 },
  belly: { sway: 1.05, bounce: 0.85, smooth: 0.58, figureEight: 1.2, armPulse: 0.95 },
  pop: { sway: 1, bounce: 1, smooth: 0.5, figureEight: 0.45, armPulse: 1 },
};

const KIND_WEIGHT: Record<PerformanceSectionKind, number> = {
  verse: 0.55,
  bridge: 0.72,
  chorus: 1,
  finale: 1.25,
};

/** Sustained loud vocals before treating as a long shout (seconds). */
const SHOUT_MIN_HOLD_SEC = 0.38;
/** How long a shout takes to reach full head raise (seconds). */
const SHOUT_RAMP_SEC = 0.9;
/** Raw vocal RMS above this counts toward a shout. */
const SHOUT_VOCAL_THRESHOLD = 0.34;

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Procedural sway / finale poses layered on a singing VRMA base.
 */
export class SingingPerformanceDriver {
  private map: PerformanceMap | null = null;
  private mixer: StemMixer | null = null;
  private active = false;

  private readonly hips: THREE.Object3D | null;
  private readonly spine: THREE.Object3D | null;
  private readonly chest: THREE.Object3D | null;
  private readonly head: THREE.Object3D | null;
  private readonly neck: THREE.Object3D | null;
  private readonly leftShoulder: THREE.Object3D | null;
  private readonly rightShoulder: THREE.Object3D | null;
  private readonly leftUpperArm: THREE.Object3D | null;
  private readonly rightUpperArm: THREE.Object3D | null;
  private readonly leftLowerArm: THREE.Object3D | null;
  private readonly rightLowerArm: THREE.Object3D | null;

  private readonly offsetQuat = new THREE.Quaternion();
  private readonly tmpEuler = new THREE.Euler(0, 0, 0, "YXZ");

  private currentKind: PerformanceSectionKind = "verse";
  private kindBlend = 0;
  private currentArmLift = 0;
  private shoutHoldSec = 0;
  private currentShoutLift = 0;

  constructor(
    private readonly vrm: VRM,
    phonetics: VRMPhoneticBoneDriver,
  ) {
    this.hips = vrm.humanoid?.getNormalizedBoneNode(VRMHumanBoneName.Hips) ?? null;
    this.spine = vrm.humanoid?.getNormalizedBoneNode(VRMHumanBoneName.Spine) ?? null;
    this.chest = vrm.humanoid?.getNormalizedBoneNode(VRMHumanBoneName.Chest) ?? null;
    this.head = vrm.humanoid?.getNormalizedBoneNode(VRMHumanBoneName.Head) ?? null;
    this.neck = vrm.humanoid?.getNormalizedBoneNode(VRMHumanBoneName.Neck) ?? null;
    this.leftShoulder =
      vrm.humanoid?.getNormalizedBoneNode(VRMHumanBoneName.LeftShoulder) ?? null;
    this.rightShoulder =
      vrm.humanoid?.getNormalizedBoneNode(VRMHumanBoneName.RightShoulder) ?? null;
    this.leftUpperArm =
      vrm.humanoid?.getNormalizedBoneNode(VRMHumanBoneName.LeftUpperArm) ?? null;
    this.rightUpperArm =
      vrm.humanoid?.getNormalizedBoneNode(VRMHumanBoneName.RightUpperArm) ?? null;
    this.leftLowerArm =
      vrm.humanoid?.getNormalizedBoneNode(VRMHumanBoneName.LeftLowerArm) ?? null;
    this.rightLowerArm =
      vrm.humanoid?.getNormalizedBoneNode(VRMHumanBoneName.RightLowerArm) ?? null;
    phonetics.headMotionEnabled = false;
  }

  loadMap(map: PerformanceMap): void {
    this.map = map;
  }

  connectStem(mixer: StemMixer): void {
    this.mixer = mixer;
  }

  setActive(active: boolean): void {
    this.active = active;
  }

  update(delta: number): void {
    if (!this.active || !this.map || !this.mixer || this.mixer.mixerState !== "playing") {
      return;
    }

    const time = this.mixer.currentTime;
    const section = sectionAtTime(this.map, time);
    const style = GENRE_STYLES[this.map.genre];
    const vocalBoost = clamp01(this.mixer.getVocalsLevel() * 2.4);
    const shoutLift = this.updateLongShoutLift(vocalBoost, section.energy, delta);

    if (section.kind !== this.currentKind) {
      this.currentKind = section.kind;
      this.kindBlend = 0;
    }
    this.kindBlend = clamp01(this.kindBlend + delta / (0.65 * style.smooth + 0.2));

    const kindWeight = lerp(
      KIND_WEIGHT[this.currentKind],
      KIND_WEIGHT[section.kind],
      this.kindBlend,
    );
    const energy = clamp01(section.energy * 0.65 + vocalBoost * 0.35);
    const intensity = energy * kindWeight;

    const beatPhase = ((time * this.map.bpm) / 60) % 1;
    const beatRad = beatPhase * Math.PI * 2;
    const halfBeatRad = beatPhase * Math.PI;

    const swayAmp =
      (section.kind === "verse" ? 0.028 : section.kind === "chorus" ? 0.052 : 0.065) *
      style.sway *
      intensity;
    const bounceAmp =
      Math.max(0, Math.sin(beatRad)) * 0.018 * style.bounce * intensity;
    const figureEight = style.figureEight;

    const swayY = Math.sin(beatRad) * swayAmp;
    const swayX =
      Math.sin(halfBeatRad) * swayAmp * 0.35 +
      Math.cos(beatRad * 0.5) * swayAmp * figureEight * 0.4;
    const swayZ = Math.cos(beatRad) * swayAmp * (0.25 + figureEight * 0.35);

    this.applyOffset(this.hips, swayX, swayY * 0.45 + bounceAmp, swayZ, 1);
    this.applyOffset(this.spine, swayX * 0.55, swayY * 0.35, swayZ * 0.4, 0.85);
    this.applyOffset(this.chest, swayX * 0.35, swayY * 0.25, swayZ * 0.25, 0.7);

    const headLift =
      (section.kind === "finale"
        ? lerp(0.08, 0.2, intensity + vocalBoost * 0.35)
        : section.kind === "chorus"
          ? lerp(0.02, 0.09, intensity)
          : Math.sin(beatRad * 0.5) * 0.015 * intensity) +
      shoutLift * lerp(0.14, 0.42, shoutLift);
    const headSway = Math.sin(beatRad * 0.5) * 0.025 * intensity * style.sway;

    this.applyOffset(this.neck, -shoutLift * 0.12, 0, 0, 0.75);
    this.applyOffset(this.head, -headLift, headSway, 0, 0.55);

    this.applyArms(
      section.kind,
      intensity,
      vocalBoost,
      shoutLift,
      beatRad,
      halfBeatRad,
      style,
      delta,
    );
  }

  reset(): void {
    this.active = false;
    this.kindBlend = 0;
    this.currentArmLift = 0;
    this.shoutHoldSec = 0;
    this.currentShoutLift = 0;
    this.currentKind = "verse";
  }

  /** Sustained loud vocals or a big energy jump → extra head raise for long shouts. */
  private updateLongShoutLift(
    vocalBoost: number,
    sectionEnergy: number,
    delta: number,
  ): number {
    const rawVocal = this.mixer?.getVocalsLevel() ?? 0;
    const loud =
      rawVocal >= SHOUT_VOCAL_THRESHOLD ||
      vocalBoost >= 0.52 ||
      (sectionEnergy >= 0.82 && vocalBoost >= 0.35);

    if (loud) {
      this.shoutHoldSec += delta;
    } else {
      this.shoutHoldSec = Math.max(0, this.shoutHoldSec - delta * 2.8);
    }

    const holdReady = this.shoutHoldSec >= SHOUT_MIN_HOLD_SEC;
    const holdFactor = holdReady ? clamp01(this.shoutHoldSec / SHOUT_RAMP_SEC) : 0;
    const peak = clamp01(Math.max(vocalBoost, rawVocal * 2.2) - 0.28);
    const target = holdFactor * peak;

    this.currentShoutLift += (target - this.currentShoutLift) * clamp01(delta * 4.5);
    return this.currentShoutLift;
  }

  private applyArms(
    kind: PerformanceSectionKind,
    intensity: number,
    vocalBoost: number,
    shoutLift: number,
    beatRad: number,
    halfBeatRad: number,
    style: GenreStyle,
    delta: number,
  ): void {
    const baseByKind: Record<PerformanceSectionKind, number> = {
      verse: lerp(0.04, 0.14, intensity),
      bridge: lerp(0.1, 0.22, intensity),
      chorus: lerp(0.2, 0.38, intensity),
      finale: lerp(0.34, 0.58, intensity + vocalBoost * 0.25),
    };

    const pulseRate = style.smooth > 0.65 ? 0.55 : 1;
    const beatPulse =
      Math.max(0, Math.sin(beatRad * pulseRate)) * 0.14 * intensity * style.armPulse;
    const swayPulse = Math.sin(halfBeatRad * pulseRate) * 0.05 * intensity * style.sway;

    const targetLift =
      (baseByKind[kind] + beatPulse + shoutLift * lerp(0.08, 0.22, shoutLift)) *
      (0.85 + vocalBoost * 0.2);
    const smoothRate = 2.4 + style.smooth * 2.8;
    this.currentArmLift += (targetLift - this.currentArmLift) * clamp01(delta * smoothRate);

    const lift = this.currentArmLift;
    const elbow = lift * lerp(0.28, 0.48, intensity);
    const shoulderShrug = lift * 0.22;
    const outward = lift * 0.18 + swayPulse;
    const forward = lift * 0.12 + (kind === "finale" ? vocalBoost * 0.08 : 0);

    this.applyOffset(this.leftShoulder, -shoulderShrug, 0, outward * 0.35, 0.65);
    this.applyOffset(this.rightShoulder, -shoulderShrug, 0, -outward * 0.35, 0.65);

    this.applyOffset(this.leftUpperArm, forward, 0, -outward - lift * 0.55, 1);
    this.applyOffset(this.rightUpperArm, forward, 0, outward + lift * 0.55, 1);

    this.applyOffset(this.leftLowerArm, elbow, 0, lift * 0.08, 0.8);
    this.applyOffset(this.rightLowerArm, elbow, 0, -lift * 0.08, 0.8);
  }

  private applyOffset(
    bone: THREE.Object3D | null,
    x: number,
    y: number,
    z: number,
    weight: number,
  ): void {
    if (!bone) return;
    this.tmpEuler.set(x * weight, y * weight, z * weight);
    this.offsetQuat.setFromEuler(this.tmpEuler);
    bone.quaternion.multiply(this.offsetQuat);
  }
}

/** @deprecated Use SingingPerformanceDriver */
export const ViktorPerformanceDriver = SingingPerformanceDriver;
