from __future__ import annotations


class EtaEstimator:
    """Smooth processing throughput with an EMA; ETA remains hidden until enough samples exist."""

    def __init__(self, minimum_samples: int = 4, alpha: float = 0.25) -> None:
        self.minimum_samples = minimum_samples
        self.alpha = alpha
        self.samples = 0
        self.last_processed = 0.0
        self.last_elapsed = 0.0
        self.speed: float | None = None

    def update(self, processed: float, total: float, elapsed: float) -> float | None:
        if processed < self.last_processed or elapsed <= self.last_elapsed or total <= 0:
            return None
        latest = (processed - self.last_processed) / (elapsed - self.last_elapsed)
        self.last_processed, self.last_elapsed = processed, elapsed
        if latest <= 0:
            return None
        self.speed = latest if self.speed is None else self.alpha * latest + (1 - self.alpha) * self.speed
        self.samples += 1
        if self.samples < self.minimum_samples or not self.speed:
            return None
        return max(0.0, (total - processed) / self.speed)
