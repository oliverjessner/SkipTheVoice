export function clampPercent(value: number): number { return Math.max(0, Math.min(100, value)); }
export function mapOverallProgress(phase: string, phasePercent?: number): number {
  const ratio = clampPercent(phasePercent ?? 0) / 100;
  if (phase === "queued") return 0;
  if (phase === "preparing_audio") return 5 + ratio * 10;
  if (phase === "loading_model") return 15 + ratio * 5;
  if (phase === "transcribing") return 20 + ratio * 75;
  if (phase === "finalizing") return 95 + ratio * 4;
  if (phase === "completed") return 100;
  return clampPercent(phasePercent ?? 0);
}

export class EtaEstimator {
  private samples = 0; private lastProcessed = 0; private lastElapsed = 0; private speed?: number;
  constructor(private readonly minimumSamples = 4, private readonly alpha = 0.25) {}
  update(processedSeconds: number, totalSeconds: number, elapsedSeconds: number): number | undefined {
    if (processedSeconds < this.lastProcessed || elapsedSeconds <= this.lastElapsed || totalSeconds <= 0) return undefined;
    const latest = (processedSeconds - this.lastProcessed) / (elapsedSeconds - this.lastElapsed);
    this.lastProcessed = processedSeconds; this.lastElapsed = elapsedSeconds;
    if (!Number.isFinite(latest) || latest <= 0) return undefined;
    this.speed = this.speed === undefined ? latest : this.alpha * latest + (1 - this.alpha) * this.speed; this.samples++;
    if (this.samples < this.minimumSamples || !this.speed) return undefined;
    return Math.max(0, (totalSeconds - processedSeconds) / this.speed);
  }
}

export function isStale(progressUpdatedAt: string, nowMs = Date.now(), staleAfterSeconds = 120): boolean { return nowMs - Date.parse(progressUpdatedAt) > staleAfterSeconds * 1000; }
