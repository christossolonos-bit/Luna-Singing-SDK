import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import type { GLTFParser } from "three/addons/loaders/GLTFLoader.js";
import { VRMLoaderPlugin } from "@pixiv/three-vrm";
import { VRMAnimationLoaderPlugin } from "@pixiv/three-vrm-animation";
import { ALL_DANCE_URLS } from "./animation/danceAnimations";
import { VRMAnimationDirector } from "./animation/VRMAnimationDirector";
import { analyzeMusicGenre, type GenreAnalysis } from "./audio/genreAnalysis";
import {
  DEFAULT_AVATAR_NAME,
  VRMAvatarController,
} from "./avatar/VRMAvatarController";
import { BackgroundController } from "./scene/BackgroundController";
import { Dock, type DockAction } from "./ui/Dock";
import { dockPositionFromViewerCenter } from "./ui/dockDefaults";
import { DockDragController } from "./ui/DockDragController";
import { LUNA_DEFAULT_VOICE, LUNA_LANGUAGE_OPTIONS } from "./voice/lunaVoiceConfig";

const statusEl = document.getElementById("status")!;
const container = document.getElementById("app")!;
const bgInput = document.getElementById("bg-input") as HTMLInputElement;
const vrmInput = document.getElementById("vrm-input") as HTMLInputElement;
const musicStemInput = document.getElementById("music-stem-input") as HTMLInputElement;
const vocalsStemInput = document.getElementById("vocals-stem-input") as HTMLInputElement;
const emotionMapInput = document.getElementById("emotion-map-input") as HTMLInputElement;
const speakPanel = document.getElementById("speak-panel")!;
const speakText = document.getElementById("speak-text") as HTMLTextAreaElement;
const speakLang = document.getElementById("speak-lang") as HTMLSelectElement;
const speakSubmit = document.getElementById("speak-submit") as HTMLButtonElement;
const speakStop = document.getElementById("speak-stop") as HTMLButtonElement;
const speakClose = document.getElementById("speak-close") as HTMLButtonElement;

function setStatus(text: string) {
  statusEl.textContent = text;
}

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1a1a2e);

const camera = new THREE.PerspectiveCamera(
  30,
  window.innerWidth / window.innerHeight,
  0.1,
  100,
);
camera.position.set(0, 1.35, 2.8);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);
renderer.outputColorSpace = THREE.SRGBColorSpace;
container.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 1.1, 0);
controls.enableDamping = true;
controls.update();

scene.add(new THREE.AmbientLight(0xffffff, 0.6));
const keyLight = new THREE.DirectionalLight(0xffffff, 1.2);
keyLight.position.set(1, 2, 2);
scene.add(keyLight);
const fillLight = new THREE.DirectionalLight(0x8899ff, 0.4);
fillLight.position.set(-2, 1, -1);
scene.add(fillLight);

const grid = new THREE.GridHelper(10, 10, 0x444466, 0x2a2a44);
scene.add(grid);

const backgroundController = new BackgroundController(scene);

const loader = new GLTFLoader();
loader.register((parser: GLTFParser) => new VRMLoaderPlugin(parser));
loader.register((parser: GLTFParser) => new VRMAnimationLoaderPlugin(parser));

let avatarController: VRMAvatarController | null = null;
let lastGenreAnalysis: GenreAnalysis | null = null;
let pendingMusicStem: File | null = null;
const clock = new THREE.Clock();

for (const option of LUNA_LANGUAGE_OPTIONS) {
  const el = document.createElement("option");
  el.value = option.code;
  el.textContent = option.label;
  speakLang.appendChild(el);
}

function toggleSpeakPanel(open?: boolean) {
  const shouldOpen = open ?? !speakPanel.classList.contains("is-open");
  speakPanel.classList.toggle("is-open", shouldOpen);
  if (shouldOpen) {
    speakText.focus();
  }
}

async function speakWithLuna() {
  const text = speakText.value.trim();
  if (!text) {
    setStatus("Enter text for Luna to speak");
    return;
  }
  if (!avatarController?.lunaTTS) return;

  avatarController.stemPerformance?.pause();
  avatarController.animationDirector?.startIdle();

  speakSubmit.disabled = true;
  setStatus("Synthesizing Luna voice…");

  try {
    await avatarController.lunaTTS.speak(text, { lang: speakLang.value });
    setStatus(`${avatarController.displayName} · ${LUNA_DEFAULT_VOICE}`);
  } catch (err) {
    console.error(err);
    setStatus(`TTS error: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    speakSubmit.disabled = false;
  }
}

speakSubmit.addEventListener("click", () => {
  void speakWithLuna();
});

speakStop.addEventListener("click", () => {
  avatarController?.lunaTTS?.stop();
  setStatus("Speech stopped");
});

speakClose.addEventListener("click", () => {
  toggleSpeakPanel(false);
});

speakText.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    void speakWithLuna();
  }
});

const dock = new Dock({
  container,
  onAction: (action: DockAction) => {
    if (action === "vrm-upload") {
      vrmInput.click();
    } else if (action === "vrm-reset") {
      void loadDefaultAvatar();
    } else if (action === "background-upload") {
      bgInput.click();
    } else if (action === "background-reset") {
      void backgroundController.reset().then(() => {
        grid.visible = false;
        setStatus("Default background restored");
      });
    } else if (action === "stems-load") {
      pendingMusicStem = null;
      musicStemInput.click();
    } else if (action === "stems-play-pause") {
      void toggleStemPlayback();
    } else if (action === "luna-speak") {
      toggleSpeakPanel(true);
    }
  },
});

dock.addToScene(scene);
dock.setPositionFromVector(dockPositionFromViewerCenter(camera));

new DockDragController({
  dockObject: dock.object,
  camera,
  canvas: renderer.domElement,
  onDraggingChange: (dragging) => {
    controls.enabled = !dragging;
  },
});

async function loadAvatarFromFile(file: File): Promise<void> {
  if (!avatarController) return;

  avatarController.stemPerformance?.pause();
  avatarController.lunaTTS?.stop();
  avatarController.animationDirector?.startIdle();

  setStatus(`Loading ${file.name}…`);
  try {
    await avatarController.load({ kind: "file", file });
    wireSongEndedHandler(avatarController);
    if (avatarController.animationDirector) {
      exposeDanceDebug(avatarController.animationDirector);
    }
    setStatus(`Avatar: ${avatarController.displayName} · ${ALL_DANCE_URLS.length} dances ready`);
  } catch (err) {
    console.error(err);
    setStatus(`VRM error: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function loadDefaultAvatar(): Promise<void> {
  if (!avatarController) return;

  avatarController.stemPerformance?.pause();
  avatarController.lunaTTS?.stop();
  avatarController.animationDirector?.startIdle();

  setStatus(`Loading ${DEFAULT_AVATAR_NAME}.vrm…`);
  try {
    await avatarController.loadDefault();
    wireSongEndedHandler(avatarController);
    if (avatarController.animationDirector) {
      exposeDanceDebug(avatarController.animationDirector);
    }
    setStatus(`Avatar: ${DEFAULT_AVATAR_NAME} · ${ALL_DANCE_URLS.length} dances ready`);
  } catch (err) {
    console.error(err);
    setStatus(`VRM error: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function toggleStemPlayback() {
  const stemPerformance = avatarController?.stemPerformance;
  if (!stemPerformance) {
    setStatus("Load music and vocals stems first");
    return;
  }

  avatarController?.lunaTTS?.stop();

  try {
    await stemPerformance.togglePlayPause();
    const playing = stemPerformance.mixer.mixerState === "playing";
    const name = avatarController?.displayName ?? DEFAULT_AVATAR_NAME;
    if (playing) {
      avatarController?.animationDirector?.startDance();
      const genre = lastGenreAnalysis?.label ?? "Mixed";
      setStatus(`Playing · ${name} · ${genre} · dance · lip sync`);
    } else {
      avatarController?.animationDirector?.startIdle();
      setStatus("Paused");
    }
  } catch (err) {
    console.error(err);
    setStatus(`Playback error: ${err instanceof Error ? err.message : String(err)}`);
  }
}

musicStemInput.addEventListener("change", () => {
  const file = musicStemInput.files?.[0];
  musicStemInput.value = "";
  if (!file) return;

  pendingMusicStem = file;
  setStatus(`Music: ${file.name} — now pick vocals stem`);
  vocalsStemInput.click();
});

vocalsStemInput.addEventListener("change", () => {
  const file = vocalsStemInput.files?.[0];
  vocalsStemInput.value = "";
  const stemPerformance = avatarController?.stemPerformance;
  if (!file || !pendingMusicStem || !stemPerformance) {
    pendingMusicStem = null;
    return;
  }

  const music = pendingMusicStem;
  pendingMusicStem = null;

  setStatus("Loading stems…");
  stemPerformance
    .loadStemsFromFiles(music, file)
    .then(async (duration) => {
      setStatus("Analyzing song genre…");
      try {
        lastGenreAnalysis = await analyzeMusicGenre(music);
        const danceCount = avatarController?.animationDirector?.setPlaylist(ALL_DANCE_URLS) ?? 0;
        setStatus(
          `Stems ready (${formatDuration(duration)}) · ${lastGenreAnalysis.label} · ${lastGenreAnalysis.bpm} BPM · ${danceCount} dances`,
        );
      } catch (err) {
        console.warn("Genre analysis failed:", err);
        lastGenreAnalysis = null;
        avatarController?.animationDirector?.setPlaylist(ALL_DANCE_URLS);
        setStatus(`Stems ready (${formatDuration(duration)}) · tap play`);
      }
      emotionMapInput.click();
    })
    .catch((err) => {
      console.error(err);
      setStatus(`Stem error: ${err instanceof Error ? err.message : String(err)}`);
    });
});

emotionMapInput.addEventListener("change", () => {
  const file = emotionMapInput.files?.[0];
  emotionMapInput.value = "";
  const stemPerformance = avatarController?.stemPerformance;
  if (!file || !stemPerformance) return;

  stemPerformance
    .loadEmotionMap(file)
    .then(() => {
      setStatus(`Emotion map loaded: ${file.name} · tap play`);
    })
    .catch((err) => {
      console.error(err);
      setStatus(`Emotion map skipped · tap play`);
    });
});

bgInput.addEventListener("change", () => {
  const file = bgInput.files?.[0];
  bgInput.value = "";
  if (!file) return;

  setStatus("Loading background…");
  backgroundController
    .setFromFile(file)
    .then(() => {
      grid.visible = false;
      setStatus(`Background: ${file.name}`);
    })
    .catch((err) => {
      console.error(err);
      setStatus(`Background error: ${err instanceof Error ? err.message : String(err)}`);
    });
});

vrmInput.addEventListener("change", () => {
  const file = vrmInput.files?.[0];
  vrmInput.value = "";
  if (!file) return;

  void loadAvatarFromFile(file);
});

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function exposeDanceDebug(director: VRMAnimationDirector): void {
  (window as unknown as { lunaDances?: object }).lunaDances = {
    durations: () => director.getDanceDurations(),
    current: () => director.getCurrentDanceInfo(),
    log: () => director.logDanceDurations(),
  };
}

function wireSongEndedHandler(controller: VRMAvatarController): void {
  controller.onSongEnded = () => {
    setStatus(`Song finished · ${controller.displayName} · idle`);
  };
}

async function init() {
  setStatus("Loading background…");
  try {
    await backgroundController.loadDefault();
    grid.visible = false;
  } catch (err) {
    console.warn("Default background failed to load:", err);
  }

  avatarController = new VRMAvatarController(scene, loader);
  wireSongEndedHandler(avatarController);
  await avatarController.loadDefault();

  if (avatarController.animationDirector) {
    avatarController.animationDirector.logDanceDurations();
    exposeDanceDebug(avatarController.animationDirector);
  }

  setStatus(
    `Ready · ${avatarController.displayName} · ${ALL_DANCE_URLS.length} dances · ${LUNA_DEFAULT_VOICE}`,
  );
}

init().catch((err) => {
  console.error(err);
  setStatus(`Error: ${err instanceof Error ? err.message : String(err)}`);
});

function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  dock.setSize(window.innerWidth, window.innerHeight);
}

window.addEventListener("resize", onResize);

function animate() {
  requestAnimationFrame(animate);

  const delta = clock.getDelta();
  avatarController?.update(delta);
  controls.update();
  renderer.render(scene, camera);
  dock.render(scene, camera);
}

animate();
