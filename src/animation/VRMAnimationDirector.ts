import * as THREE from "three";
import type { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import type { VRM } from "@pixiv/three-vrm";
import { createVRMAnimationClip } from "@pixiv/three-vrm-animation";
import {
  ANIMATION_CROSSFADE_SEC,
  BONE_BRIDGE_SEC,
} from "./danceAnimations";
import {
  MotionStopDetector,
  VRMBoneTransitionBridge,
} from "./VRMBoneTransitionBridge";

type MotionMode = "idle" | "dance";

type CachedClip = {
  action: THREE.AnimationAction;
  duration: number;
  url: string;
};

export type DanceClipDuration = {
  name: string;
  url: string;
  durationSec: number;
  transitionAtSec: number;
};

export type CurrentDanceInfo = DanceClipDuration & {
  index: number;
  clipTimeSec: number;
  remainingSec: number;
  bridging: boolean;
};

const MIN_PLAY_BEFORE_STOP_CHECK = 0.45;

async function loadVRMAClip(
  loader: GLTFLoader,
  url: string,
  vrm: VRM,
): Promise<THREE.AnimationClip> {
  const gltf = await loader.loadAsync(url);
  const vrmAnimation = gltf.userData.vrmAnimations?.[0];
  if (!vrmAnimation) {
    throw new Error(`No VRMA animation found in ${url}`);
  }
  return createVRMAnimationClip(vrmAnimation, vrm);
}

/**
 * Plays idle standing loop, then cycles dances in order while singing.
 * When a clip's motion stops, bones blend into the next clip's start pose.
 */
export class VRMAnimationDirector {
  readonly mixer: THREE.AnimationMixer;

  private idleAction: THREE.AnimationAction | null = null;
  private readonly clipCache = new Map<string, CachedClip>();
  private readonly danceActions: THREE.AnimationAction[] = [];
  private readonly danceDurations: number[] = [];
  private danceIndex = 0;
  private pendingNextIndex = 0;
  private mode: MotionMode = "idle";
  private currentAction: THREE.AnimationAction | null = null;
  private endTransitionStarted = false;

  private readonly motionStop = new MotionStopDetector();
  private readonly boneBridge = new VRMBoneTransitionBridge();

  constructor(
    private readonly vrm: VRM,
    private readonly crossfadeSec = ANIMATION_CROSSFADE_SEC,
    private readonly boneBridgeSec = BONE_BRIDGE_SEC,
  ) {
    this.mixer = new THREE.AnimationMixer(vrm.scene);
  }

  async loadIdle(loader: GLTFLoader, url: string, vrm: VRM): Promise<void> {
    const clip = await loadVRMAClip(loader, url, vrm);
    this.idleAction = this.mixer.clipAction(clip);
    this.idleAction.setLoop(THREE.LoopRepeat, Infinity);
    this.idleAction.clampWhenFinished = false;
    this.idleAction.play();
    this.currentAction = this.idleAction;
    this.mode = "idle";
  }

  async loadAllDanceClips(
    loader: GLTFLoader,
    urls: readonly string[],
    vrm: VRM,
  ): Promise<number> {
    for (const url of urls) {
      if (this.clipCache.has(url)) continue;

      try {
        const clip = await loadVRMAClip(loader, url, vrm);
        const action = this.mixer.clipAction(clip);
        action.setLoop(THREE.LoopOnce, 1);
        action.clampWhenFinished = false;
        this.clipCache.set(url, { action, duration: clip.duration, url });
      } catch (err) {
        console.warn(`Skipping dance clip ${url}:`, err);
      }
    }

    if (this.clipCache.size === 0) {
      throw new Error("No dance animations could be loaded.");
    }

    return this.clipCache.size;
  }

  setPlaylist(urls: readonly string[]): number {
    this.rebuildDancePool(urls);
    this.danceIndex = 0;

    if (this.mode === "dance" && this.danceActions.length > 0) {
      this.startDanceAction(0);
    }

    return this.danceActions.length;
  }

  get isDancing(): boolean {
    return this.mode === "dance";
  }

  get danceClipCount(): number {
    return this.danceActions.length;
  }

  getDanceDurations(): DanceClipDuration[] {
    return [...this.clipCache.values()]
      .map((clip) => this.toDurationInfo(clip.url, clip.duration))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  getCurrentDanceInfo(): CurrentDanceInfo | null {
    if (this.mode !== "dance" || this.danceActions.length === 0) return null;

    const action = this.danceActions[this.danceIndex]!;
    const duration = this.danceDurations[this.danceIndex]!;
    const url = this.urlForDanceIndex(this.danceIndex);
    const info = this.toDurationInfo(url, duration);

    return {
      ...info,
      index: this.danceIndex,
      clipTimeSec: action.time,
      remainingSec: Math.max(0, duration - action.time),
      transitionAtSec: info.transitionAtSec,
      bridging: this.boneBridge.isActive,
    };
  }

  logDanceDurations(): void {
    const rows = this.getDanceDurations().map((d) => ({
      name: d.name,
      duration: `${d.durationSec.toFixed(2)}s`,
      fallbackTransition: `${d.transitionAtSec.toFixed(2)}s`,
    }));
    console.table(rows);
    console.info(
      "Luna VRMA · transitions trigger when motion stops, or at fallback time. Live: lunaDances.current()",
    );
  }

  startDance(): void {
    if (this.mode === "dance" || this.danceActions.length === 0) return;

    this.mode = "dance";
    this.startDanceAction(this.danceIndex);
  }

  startIdle(): void {
    if (this.mode === "idle" || !this.idleAction) return;

    this.mode = "idle";
    this.boneBridge.cancel();
    this.motionStop.reset();
    this.endTransitionStarted = false;
    this.stopDanceActions();
    this.idleAction.setLoop(THREE.LoopRepeat, Infinity);
    this.idleAction.clampWhenFinished = false;
    this.crossfadeTo(this.idleAction);
  }

  update(delta: number): void {
    this.mixer.update(delta);

    if (this.boneBridge.isActive) {
      if (this.boneBridge.update(delta)) {
        this.finishBridgeAndPlayNext();
      }
      return;
    }

    if (this.mode !== "dance" || this.danceActions.length === 0) return;
    if (this.endTransitionStarted) return;

    const action = this.danceActions[this.danceIndex]!;
    const duration = this.danceDurations[this.danceIndex]!;
    const motionStopped =
      action.time >= MIN_PLAY_BEFORE_STOP_CHECK &&
      this.motionStop.update(this.vrm, delta);
    const clipEnded = action.time >= duration - 0.03;

    if (!motionStopped && !clipEnded) return;

    this.beginBridgeToNext();
  }

  private beginBridgeToNext(): void {
    this.endTransitionStarted = true;
    this.pendingNextIndex = (this.danceIndex + 1) % this.danceActions.length;

    const outgoing = this.danceActions[this.danceIndex]!;
    const next = this.danceActions[this.pendingNextIndex]!;

    outgoing.setEffectiveWeight(0);
    outgoing.paused = true;

    const started = this.boneBridge.begin(
      this.vrm,
      next.getClip(),
      this.boneBridgeSec,
    );

    if (!started) {
      this.boneBridge.cancel();
      this.danceIndex = this.pendingNextIndex;
      this.startDanceAction(this.danceIndex);
    }
  }

  private finishBridgeAndPlayNext(): void {
    this.danceIndex = this.pendingNextIndex;
    this.startDanceAction(this.danceIndex);
  }

  private startDanceAction(index: number): void {
    const action = this.danceActions[index]!;
    this.beginDanceClip(index);
    this.stopDanceActions(action);

    action.reset();
    action.setEffectiveTimeScale(1);
    action.setEffectiveWeight(1);
    action.paused = false;
    action.play();

    this.currentAction = action;
    this.endTransitionStarted = false;
    this.motionStop.reset();
  }

  private blendDurationForClip(duration: number): number {
    if (this.crossfadeSec <= 0) return 0;
    return Math.min(this.crossfadeSec, Math.max(0.08, duration * 0.35));
  }

  private clipNameFromUrl(url: string): string {
    const file = url.split("/").pop() ?? url;
    return decodeURIComponent(file.replace(/\.vrma$/i, ""));
  }

  private urlForDanceIndex(index: number): string {
    for (const [url, cached] of this.clipCache.entries()) {
      if (cached.action === this.danceActions[index]) return url;
    }
    return "";
  }

  private toDurationInfo(url: string, duration: number): DanceClipDuration {
    const blend = this.blendDurationForClip(duration);
    return {
      name: this.clipNameFromUrl(url),
      url,
      durationSec: duration,
      transitionAtSec: Math.max(0, duration - blend),
    };
  }

  private rebuildDancePool(urls: readonly string[]): void {
    this.danceActions.length = 0;
    this.danceDurations.length = 0;

    for (const url of urls) {
      const cached = this.clipCache.get(url);
      if (!cached) continue;
      this.danceActions.push(cached.action);
      this.danceDurations.push(cached.duration);
    }

    if (this.danceActions.length === 0) {
      for (const cached of this.clipCache.values()) {
        this.danceActions.push(cached.action);
        this.danceDurations.push(cached.duration);
      }
    }
  }

  private beginDanceClip(index: number): void {
    const action = this.danceActions[index]!;
    action.setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = false;
  }

  private stopDanceActions(except?: THREE.AnimationAction): void {
    for (const action of this.danceActions) {
      if (action === except) continue;
      action.stop();
      action.setEffectiveWeight(0);
      action.paused = false;
    }
  }

  private crossfadeTo(
    target: THREE.AnimationAction,
    blend = this.crossfadeSec,
  ): void {
    if (this.currentAction === target) return;

    const previous = this.currentAction;

    target.reset();
    target.setEffectiveTimeScale(1);
    target.setEffectiveWeight(1);
    target.paused = false;
    target.play();

    if (previous && previous !== target) {
      if (blend > 0) {
        previous.crossFadeTo(target, blend, true);
      } else {
        previous.stop();
        previous.setEffectiveWeight(0);
      }
    }

    this.currentAction = target;
  }
}
