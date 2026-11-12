"""Umeyama similarity: recover a known transform (core of SfM -> RTK georeferencing)."""
import numpy as np
import pytest

from app.core.align import rms_residual, umeyama


def random_rotation(rng):
    q, r = np.linalg.qr(rng.normal(size=(3, 3)))
    q *= np.sign(np.diag(r))
    if np.linalg.det(q) < 0:
        q[:, 0] *= -1
    return q


def test_recovers_exact_transform_at_tokyo_scale():
    rng = np.random.default_rng(7)
    src = rng.uniform(-50, 50, (12, 3))  # arbitrary SfM frame
    R, s, t = random_rotation(rng), 2.3456, np.array([-5995.1852, -35367.2301, 36.0])
    dst = s * src @ R.T + t
    sim = umeyama(src, dst)
    assert abs(sim.scale - s) < 1e-12
    assert np.allclose(sim.rotation, R, atol=1e-12)
    assert np.max(np.abs(sim.apply(src) - dst)) < 1e-9


def test_noisy_residual_matches_noise_level():
    rng = np.random.default_rng(11)
    src = rng.uniform(-100, 100, (500, 3))
    R, s, t = random_rotation(rng), 0.8, np.array([1000.0, -2000.0, 50.0])
    sigma = 0.02
    dst = s * src @ R.T + t + rng.normal(0, sigma, src.shape)
    sim = umeyama(src, dst)
    rms = rms_residual(sim, src, dst)
    assert abs(rms - sigma * np.sqrt(3)) < 0.003  # 3D RMS of isotropic noise = sigma*sqrt(3)
    assert abs(sim.scale - s) < 1e-4


def test_rejects_degenerate_input():
    with pytest.raises(ValueError):
        umeyama(np.zeros((5, 3)), np.ones((5, 3)))
    with pytest.raises(ValueError):
        umeyama(np.zeros((2, 3)), np.zeros((2, 3)))
