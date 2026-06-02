import * as THREE from "three";
import type { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { VRMUtils, type VRM } from "@pixiv/three-vrm";
import { ALL_DANCE_URLS, IDLE_ANIMATION_URL, type SongGenre } from "../animation/danceAnimations";
import type { MotionCatalog } from "./avatarMotionCatalog";
import { VRMAnimationDirector } from "../animation/VRMAnimationDirector";
import { StemMixer } from "../audio/StemMixer";
import { StemPerformance } from "../audio/StemPerformance";
import { VRMEmotionDriver } from "../expressions/VRMEmotionDriver";
import { VRMPhoneticBoneDriver } from "../lipsync/VRMPhoneticBoneDriver";
import { VRMVisemeDriver } from "../lipsync/VRMVisemeDriver";
import { SingingPerformanceDriver } from "../performance/ViktorPerformanceDriver";
import { analyzeSongPerformance } from "../performance/ViktorPerformanceAnalysis";
import { LunaTTS } from "../voice/LunaTTS";

export const DEFAULT_VRM_URL = "/Luna.vrm";
export const DEFAULT_AVATAR_NAME = "Luna";

export type AvatarSource =
  | { kind: "url"; url: string; name: string }
  | { kind: "file"; file: File };

export class VRMAvatarController {
  vrm: VRM | null = null;
  lipsync: VRMVisemeDriver | null = null;
  phonetics: VRMPhoneticBoneDriver | null = null;
  emotion: VRMEmotionDriver | null = null;
  stemPerformance: StemPerformance | null = null;
  lunaTTS: LunaTTS | null = null;
  animationDirector: VRMAnimationDirector | null = null;
  singingPerformance: SingingPerformanceDriver | null = null;

  displayName = DEFAULT_AVATAR_NAME;
  motionIdleUrl = IDLE_ANIMATION_URL;
  motionPlaylistUrls: readonly string[] = ALL_DANCE_URLS;
  motionPerformance = false;

  /** Called when loaded stems finish playing. */
  onSongEnded: (() => void) | null = null;

  private objectUrl: string | null = null;
  private readonly preservedMixer: StemMixer;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly loader: GLTFLoader,
    existingMixer?: StemMixer,
  ) {
    this.preservedMixer = existingMixer ?? new StemMixer();
    this.preservedMixer.onEnded = () => this.handleSongEnded();
  }

  get mixer(): StemMixer {
    return this.preservedMixer;
  }

  /** @deprecated Use singingPerformance */
  get viktorPerformance(): SingingPerformanceDriver | null {
    return this.singingPerformance;
  }

  async loadDefault(): Promise<void> {
    await this.load({ kind: "url", url: DEFAULT_VRM_URL, name: DEFAULT_AVATAR_NAME });
  }

  async load(source: AvatarSource): Promise<void> {
    this.unloadAvatar();

    let url: string;
    if (source.kind === "file") {
      this.objectUrl = URL.createObjectURL(source.file);
      url = this.objectUrl;
      this.displayName = source.file.name.replace(/\.vrm$/i, "");
    } else {
      url = source.url;
      this.displayName = source.name;
    }

    const gltf = await this.loader.loadAsync(url);
    const vrm = gltf.userData.vrm as VRM | undefined;
    if (!vrm) {
      throw new Error("File is not a valid VRM model.");
    }

    VRMUtils.removeUnnecessaryVertices(vrm.scene);
    VRMUtils.removeUnnecessaryJoints(vrm.scene);

    vrm.scene.rotation.y = Math.PI;
    this.scene.add(vrm.scene);
    this.vrm = vrm;

    await this.wireAvatarSystems();
  }

  unloadAvatar(): void {
    this.animationDirector?.startIdle();

    if (this.vrm) {
      this.scene.remove(this.vrm.scene);
      VRMUtils.deepDispose(this.vrm.scene);
      this.vrm = null;
    }

    this.lipsync = null;
    this.phonetics = null;
    this.emotion = null;
    this.stemPerformance = null;
    this.lunaTTS = null;
    this.animationDirector = null;
    this.singingPerformance = null;

    if (this.objectUrl) {
      URL.revokeObjectURL(this.objectUrl);
      this.objectUrl = null;
    }
  }

  update(delta: number): void {
    this.animationDirector?.update(delta);
    this.singingPerformance?.update(delta);
    this.vrm?.update(delta);
    this.stemPerformance?.update();
    this.lunaTTS?.update();
  }

  private handleSongEnded(): void {
    this.animationDirector?.startIdle();
    this.lipsync?.reset();
    this.emotion?.reset();
    this.phonetics?.reset();
    this.singingPerformance?.reset();
    this.onSongEnded?.();
  }

  private async wireAvatarSystems(): Promise<void> {
    if (!this.vrm) return;

    const vrm = this.vrm;
    const lipsync = new VRMVisemeDriver(vrm);
    const phonetics = new VRMPhoneticBoneDriver(vrm, lipsync);
    const emotion = new VRMEmotionDriver(vrm);
    const stemPerformance = new StemPerformance(lipsync, emotion, phonetics, this.preservedMixer);
    const lunaTTS = new LunaTTS(lipsync, emotion, phonetics);
    const animationDirector = new VRMAnimationDirector(vrm);

    await animationDirector.loadIdle(this.loader, IDLE_ANIMATION_URL, vrm);
    await animationDirector.loadAllDanceClips(this.loader, ALL_DANCE_URLS, vrm);
    animationDirector.setPlaylist(ALL_DANCE_URLS);

    if (this.preservedMixer.mixerState !== "idle") {
      lipsync.connectVocalsStem(this.preservedMixer);
      emotion.connectVocalsStem(this.preservedMixer);
    }

    this.lipsync = lipsync;
    this.phonetics = phonetics;
    this.emotion = emotion;
    this.stemPerformance = stemPerformance;
    this.lunaTTS = lunaTTS;
    this.animationDirector = animationDirector;
  }

  async applyMotionCatalog(catalog: MotionCatalog): Promise<number> {
    if (!this.vrm || !this.animationDirector) {
      return 0;
    }

    const usePerformance = Boolean(catalog.proceduralPerformance);

    this.motionIdleUrl = catalog.idleUrl;
    this.motionPlaylistUrls = catalog.playlistUrls;
    this.motionPerformance = usePerformance;
    if (this.stemPerformance) {
      this.stemPerformance.proceduralPerformanceMode = usePerformance;
      this.emotion?.setLyricPriority(usePerformance);
    }

    this.animationDirector.setPlayFullClips(catalog.playFullClips ?? false);
    this.animationDirector.setPerformanceMode(usePerformance);
    this.animationDirector.startIdle();
    await this.animationDirector.loadIdle(this.loader, catalog.idleUrl, this.vrm);
    await this.animationDirector.loadAllDanceClips(
      this.loader,
      catalog.playlistUrls,
      this.vrm,
    );

    if (usePerformance) {
      if (!this.phonetics) {
        throw new Error("Avatar phonetics not ready.");
      }
      this.singingPerformance?.reset();
      this.singingPerformance = new SingingPerformanceDriver(this.vrm, this.phonetics);
      this.singingPerformance.connectStem(this.preservedMixer);
    } else {
      this.singingPerformance?.reset();
      this.singingPerformance = null;
      if (this.phonetics) {
        this.phonetics.headMotionEnabled = true;
      }
    }

    return this.animationDirector.setPlaylist(catalog.playlistUrls);
  }

  async loadSingingPerformanceMap(
    music: File | Blob,
    genre: SongGenre,
    bpm?: number,
  ): Promise<void> {
    if (!this.singingPerformance) return;
    const map = await analyzeSongPerformance(music, genre, bpm);
    this.singingPerformance.loadMap(map);
  }

  /** @deprecated Use loadSingingPerformanceMap */
  async loadViktorPerformanceMap(
    music: File | Blob,
    genre: SongGenre,
    bpm?: number,
  ): Promise<void> {
    return this.loadSingingPerformanceMap(music, genre, bpm);
  }

  setSingingPerformanceActive(active: boolean): void {
    if (!this.singingPerformance) return;
    this.singingPerformance.connectStem(this.preservedMixer);
    this.singingPerformance.setActive(active);
  }

  /** @deprecated Use setSingingPerformanceActive */
  setViktorPerformanceActive(active: boolean): void {
    this.setSingingPerformanceActive(active);
  }
}
