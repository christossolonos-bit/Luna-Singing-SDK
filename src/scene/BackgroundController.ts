import * as THREE from "three";

export const DEFAULT_BACKGROUND_URL = "/default-background.mp4";

type BackgroundMode = "color" | "image" | "video";

export class BackgroundController {
  private scene: THREE.Scene;
  private currentTexture: THREE.Texture | null = null;
  private videoEl: HTMLVideoElement | null = null;
  private objectUrl: string | null = null;
  private mode: BackgroundMode = "color";
  private readonly defaultColor = new THREE.Color(0x1a1a2e);

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  setFromFile(file: File): Promise<void> {
    this.clear();

    if (file.type.startsWith("video/")) {
      return this.setVideoUrl(URL.createObjectURL(file), true);
    }
    if (file.type.startsWith("image/")) {
      return this.setImageUrl(URL.createObjectURL(file), true);
    }
    return Promise.reject(new Error("Unsupported file type. Use an image or video."));
  }

  setFromUrl(url: string): Promise<void> {
    this.clear();

    if (/\.(mp4|webm|ogg|mov)(\?|$)/i.test(url)) {
      return this.setVideoUrl(url, false);
    }
    if (/\.(jpg|jpeg|png|webp|gif)(\?|$)/i.test(url)) {
      return this.setImageUrl(url, false);
    }
    return Promise.reject(new Error("Unsupported background URL."));
  }

  loadDefault(): Promise<void> {
    return this.setFromUrl(DEFAULT_BACKGROUND_URL);
  }

  reset(): Promise<void> {
    return this.loadDefault();
  }

  dispose(): void {
    this.clear();
  }

  private setImageUrl(url: string, revoke: boolean): Promise<void> {
    if (revoke) {
      this.objectUrl = url;
    }

    return new Promise((resolve, reject) => {
      const loader = new THREE.TextureLoader();
      loader.load(
        url,
        (texture) => {
          texture.colorSpace = THREE.SRGBColorSpace;
          this.applyTexture(texture);
          this.mode = "image";
          resolve();
        },
        undefined,
        (err) => {
          if (revoke) {
            URL.revokeObjectURL(url);
            this.objectUrl = null;
          }
          reject(err);
        },
      );
    });
  }

  private setVideoUrl(url: string, revoke: boolean): Promise<void> {
    if (revoke) {
      this.objectUrl = url;
    }

    const video = document.createElement("video");
    video.src = url;
    video.loop = true;
    video.muted = true;
    video.playsInline = true;
    video.autoplay = true;

    return new Promise((resolve, reject) => {
      video.addEventListener(
        "loadeddata",
        () => {
          void video.play().catch(() => {
            /* autoplay may be blocked until user gesture */
          });

          const texture = new THREE.VideoTexture(video);
          texture.colorSpace = THREE.SRGBColorSpace;
          this.videoEl = video;
          this.applyTexture(texture);
          this.mode = "video";
          resolve();
        },
        { once: true },
      );

      video.addEventListener(
        "error",
        () => {
          if (revoke) {
            URL.revokeObjectURL(url);
            this.objectUrl = null;
          }
          reject(new Error("Failed to load video background."));
        },
        { once: true },
      );
    });
  }

  private applyTexture(texture: THREE.Texture): void {
    if (this.currentTexture) {
      this.currentTexture.dispose();
    }
    this.currentTexture = texture;
    this.scene.background = texture;
  }

  private clear(): void {
    if (this.currentTexture) {
      this.currentTexture.dispose();
      this.currentTexture = null;
    }

    if (this.videoEl) {
      this.videoEl.pause();
      this.videoEl.removeAttribute("src");
      this.videoEl.load();
      this.videoEl = null;
    }

    if (this.objectUrl) {
      URL.revokeObjectURL(this.objectUrl);
      this.objectUrl = null;
    }
  }
}
