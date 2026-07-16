from __future__ import annotations
import os
import threading


class ModelManager:
    def __init__(self) -> None:
        self.state = "not_loaded"
        self.error: str | None = None
        self.model = None
        self._lock = threading.Lock()
        self.model_name = os.getenv("WHISPER_MODEL", "turbo")
        self.device = os.getenv("WHISPER_DEVICE", "auto")

    def selected_device(self) -> str:
        if self.device != "auto":
            return self.device
        try:
            import torch
            if torch.cuda.is_available():
                return "cuda"
            if getattr(torch.backends, "mps", None) and torch.backends.mps.is_available():
                return "mps"
        except ImportError:
            pass
        return "cpu"

    def validate_device(self) -> None:
        selected = self.selected_device()
        if selected == "cpu":
            return
        try:
            import torch
        except ImportError as exc:
            raise RuntimeError("PyTorch is required for the selected Whisper device.") from exc
        if selected == "cuda" and not torch.cuda.is_available():
            raise RuntimeError("WHISPER_DEVICE=cuda was selected, but CUDA is unavailable.")
        if selected == "mps" and not (getattr(torch.backends, "mps", None) and torch.backends.mps.is_available()):
            raise RuntimeError("WHISPER_DEVICE=mps was selected, but Apple MPS is unavailable.")

    def load(self, model_override: str | None = None):
        if self.model is not None:
            return self.model
        with self._lock:
            if self.model is not None:
                return self.model
            self.state = "loading"
            try:
                self.validate_device()
                import whisper
                self.model_name = model_override or self.model_name
                self.model = whisper.load_model(self.model_name, device=self.selected_device())
                self.state, self.error = "ready", None
                return self.model
            except Exception as exc:
                self.state, self.error = "error", str(exc)
                raise
