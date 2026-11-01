export interface VideoClipHudMeta {
  stageLabel: string;
  tag: string;
  timeText: string;
  hostLabel?: string;
}

export interface FinalizedVideoClip {
  url: string;
  ext: 'mp4' | 'webm';
  mimeType: string;
  sizeBytes: number;
}

const PREFERRED_VIDEO_MIME_TYPES = [
  'video/mp4;codecs=avc1.42E01E',
  'video/mp4;codecs=avc1',
  'video/mp4',
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm',
];

function pickSupportedVideoMimeType(): string | null {
  if (typeof window === 'undefined' || typeof MediaRecorder === 'undefined') {
    return null;
  }
  for (const candidate of PREFERRED_VIDEO_MIME_TYPES) {
    try {
      if (MediaRecorder.isTypeSupported(candidate)) {
        return candidate;
      }
    } catch {
      // ignore unsupported codec probe
    }
  }
  return '';
}

export class VideoClipRecorder {
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private recorder: MediaRecorder | null = null;
  private stream: MediaStream | null = null;
  private chunks: BlobPart[] = [];
  private activeMimeType = 'video/webm';
  private startedAtMs = 0;
  private lastDrawAtMs = 0;
  private lastUrl: string | null = null;

  public isRecording(): boolean {
    return this.recorder !== null && this.recorder.state === 'recording';
  }

  public startRecording(): boolean {
    this.stopInternal(false);

    if (typeof document === 'undefined' || typeof MediaRecorder === 'undefined') {
      return false;
    }

    const mimeType = pickSupportedVideoMimeType();
    if (mimeType === null) return false;

    if (!this.canvas) {
      const c = document.createElement('canvas');
      c.width = 512;
      c.height = 448;
      this.canvas = c;
      this.ctx = c.getContext('2d', { alpha: false });
    }

    if (!this.canvas || !this.ctx || typeof this.canvas.captureStream !== 'function') {
      return false;
    }

    try {
      this.chunks = [];
      const stream = this.canvas.captureStream(30);
      const options: MediaRecorderOptions = {
        videoBitsPerSecond: 3_200_000,
      };
      if (mimeType) {
        options.mimeType = mimeType;
      }

      const recorder = new MediaRecorder(stream, options);
      this.activeMimeType = recorder.mimeType || mimeType || 'video/webm';
      recorder.ondataavailable = (ev: BlobEvent) => {
        if (ev.data && ev.data.size > 0) {
          this.chunks.push(ev.data);
        }
      };
      recorder.start(250);
      this.stream = stream;
      this.recorder = recorder;
      this.startedAtMs = performance.now();
      this.lastDrawAtMs = 0;
      return true;
    } catch {
      this.stopInternal(false);
      return false;
    }
  }

  public captureFrame(
    emulatorCanvas: HTMLCanvasElement | null,
    ghostOverlayCanvas: HTMLCanvasElement | null,
    meta: VideoClipHudMeta,
    forceDraw = false
  ): void {
    if (!this.isRecording() || !this.canvas || !this.ctx || !emulatorCanvas) {
      return;
    }

    const now = performance.now();
    // Cap recording buffer at 35 seconds so abandoned runs never accumulate unbounded chunks
    if (now - this.startedAtMs > 35_000) {
      this.stopInternal(false);
      return;
    }
    if (!forceDraw && now - this.lastDrawAtMs < 31) {
      return;
    }
    this.lastDrawAtMs = now;

    const ctx = this.ctx;
    const W = this.canvas.width; // 512
    const HEADER_H = 36;
    const GAME_H = 384; // Exact 4:3 CRT aspect (512x384)
    const FOOTER_Y = HEADER_H + GAME_H; // 420
    const FOOTER_H = 28;

    // 1. Top Arcade Bezel Header
    ctx.fillStyle = '#09090D';
    ctx.fillRect(0, 0, W, HEADER_H);
    ctx.fillStyle = '#F5C342';
    ctx.fillRect(0, HEADER_H - 2, W, 2);

    ctx.font = '900 13px monospace';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#FFE74C';
    ctx.fillText('BITGEIST', 12, 18);

    ctx.font = '900 11px monospace';
    ctx.fillStyle = '#FFFDF7';
    const stageStr = `• ${meta.stageLabel.slice(0, 26)}`;
    ctx.fillText(stageStr, 86, 18);

    const rightHud = `@${meta.tag} • ${meta.timeText}`;
    const rw = ctx.measureText(rightHud).width;
    ctx.fillStyle = '#7FD1AE';
    ctx.fillText(rightHud, Math.max(260, W - rw - 12), 18);

    // 2. Crisp Pixel-Art 4:3 CRT Frame + Live 1v1 Ghost Overlay
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, HEADER_H, W, GAME_H);
    ctx.imageSmoothingEnabled = false;
    try {
      ctx.drawImage(emulatorCanvas, 0, HEADER_H, W, GAME_H);
      if (ghostOverlayCanvas) {
        ctx.drawImage(ghostOverlayCanvas, 0, HEADER_H, W, GAME_H);
      }
    } catch {
      // ignore transient canvas draw errors
    }

    // 3. Bottom Brag Strip
    ctx.fillStyle = '#111111';
    ctx.fillRect(0, FOOTER_Y, W, FOOTER_H);
    ctx.fillStyle = '#FFE74C';
    ctx.fillRect(0, FOOTER_Y, W, 2);

    ctx.font = '900 10px monospace';
    ctx.fillStyle = '#EFE6CE';
    ctx.fillText('15-SECOND RETRO SPEEDRUNS • BEAT THIS GHOST', 12, FOOTER_Y + 15);

    const host = meta.hostLabel || 'BITGEIST.GG';
    const hw = ctx.measureText(host).width;
    ctx.fillStyle = '#FFE74C';
    ctx.fillText(host.toUpperCase(), W - hw - 12, FOOTER_Y + 15);
  }

  public async stopAndFinalize(): Promise<FinalizedVideoClip | null> {
    const rec = this.recorder;
    if (!rec || rec.state === 'inactive') {
      this.stopInternal(false);
      return null;
    }

    const mimeType = this.activeMimeType || rec.mimeType || 'video/webm';
    return new Promise<FinalizedVideoClip | null>((resolve) => {
      const finalizeBlob = () => {
        const chunks = this.chunks.slice();
        this.stopInternal(false);
        if (chunks.length === 0) {
          resolve(null);
          return;
        }
        const blob = new Blob(chunks, { type: mimeType });
        if (blob.size < 256) {
          resolve(null);
          return;
        }
        if (this.lastUrl) {
          try {
            URL.revokeObjectURL(this.lastUrl);
          } catch {
            // ignore
          }
        }
        const url = URL.createObjectURL(blob);
        this.lastUrl = url;
        const ext: 'mp4' | 'webm' = mimeType.toLowerCase().includes('mp4') ? 'mp4' : 'webm';
        resolve({
          url,
          ext,
          mimeType,
          sizeBytes: blob.size,
        });
      };

      rec.onstop = finalizeBlob;
      rec.onerror = () => {
        this.stopInternal(false);
        resolve(null);
      };

      try {
        rec.stop();
      } catch {
        finalizeBlob();
      }
    });
  }

  public discard(): void {
    this.stopInternal(false);
  }

  public dispose(): void {
    this.stopInternal(true);
  }

  private stopInternal(revokeLastUrl: boolean): void {
    if (this.recorder) {
      this.recorder.ondataavailable = null;
      this.recorder.onstop = null;
      this.recorder.onerror = null;
      if (this.recorder.state !== 'inactive') {
        try {
          this.recorder.stop();
        } catch {
          // ignore
        }
      }
      this.recorder = null;
    }
    if (this.stream) {
      for (const track of this.stream.getTracks()) {
        try {
          track.stop();
        } catch {
          // ignore
        }
      }
      this.stream = null;
    }
    this.chunks = [];
    if (revokeLastUrl && this.lastUrl) {
      try {
        URL.revokeObjectURL(this.lastUrl);
      } catch {
        // ignore
      }
      this.lastUrl = null;
    }
  }
}
