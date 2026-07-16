from app.progress.eta import EtaEstimator


def test_eta_waits_for_samples_and_smooths():
    eta = EtaEstimator(minimum_samples=3, alpha=.25)
    assert eta.update(1, 10, 1) is None
    assert eta.update(2, 10, 2) is None
    assert eta.update(3, 10, 3) == 7
    value = eta.update(5, 10, 4)
    assert value is not None and 0 < value < 5
