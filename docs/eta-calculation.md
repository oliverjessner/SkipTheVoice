# ETA calculation

ETA divides remaining audio duration by observed processing throughput. An exponential moving average with configurable `alpha` (default `0.25`) smooths speed. The estimate remains hidden until four valid samples, ignores non-positive or regressing samples, clamps negatives to zero, and becomes zero on completion. It is an estimate, not a deadline; model load, device contention, and unusually complex audio can change throughput.
