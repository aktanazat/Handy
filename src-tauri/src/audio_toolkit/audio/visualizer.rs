use rustfft::{num_complex::Complex32, num_traits::ToPrimitive, Fft, FftPlanner};
use std::sync::Arc;

// `db` below is not true dBFS: it's a per-bin average divided by the FFT
// window size, which lands ~20 dB low for speech. So this window is calibrated
// against measured mic audio (dictation ~-32 dBFS, room tone ~-48 dBFS) rather
// than absolute dBFS. The old -55/-8 left speech ~1 px above the overlay's
// floor, which reads as a frozen waveform (#1694). Not lowered past -68: at
// -70 a noisy room starts making the idle waveform twitch.
const DB_MIN: f32 = -68.0;
const DB_MAX: f32 = -30.0;
const GAIN: f32 = 1.3;
const CURVE_POWER: f32 = 0.7;

#[inline]
fn usize_to_f32(value: usize) -> f32 {
    let Some(value) = value.to_f32() else {
        unreachable!("all supported usize values fit within the finite f32 range");
    };
    value
}

#[inline]
fn u32_to_f32(value: u32) -> f32 {
    let Some(value) = value.to_f32() else {
        unreachable!("all u32 values fit within the finite f32 range");
    };
    value
}

#[inline]
fn f32_to_usize_saturating(value: f32) -> usize {
    match value.to_usize() {
        Some(value) => value,
        None if value.is_nan() || value.is_sign_negative() => 0,
        None => usize::MAX,
    }
}

pub struct AudioVisualiser {
    fft: Arc<dyn Fft<f32>>,
    window: Vec<f32>,
    bucket_ranges: Vec<(usize, usize)>,
    fft_input: Vec<Complex32>,
    noise_floor: Vec<f32>,
    buffer: Vec<f32>,
    window_size: usize,
    buckets: usize,
}

impl AudioVisualiser {
    pub fn new(
        sample_rate: u32,
        window_size: usize,
        buckets: usize,
        freq_min: f32,
        freq_max: f32,
    ) -> Self {
        let mut planner = FftPlanner::<f32>::new();
        let fft = planner.plan_fft_forward(window_size);

        let window_size_f32 = usize_to_f32(window_size);
        let sample_rate_f32 = u32_to_f32(sample_rate);
        let bucket_count = usize_to_f32(buckets);

        // Pre-compute Hann window
        let window: Vec<f32> = (0..window_size)
            .map(|i| {
                let i = usize_to_f32(i);
                0.5 * (1.0 - (2.0 * std::f32::consts::PI * i / window_size_f32).cos())
            })
            .collect();

        // Pre-compute bucket frequency ranges
        let nyquist = sample_rate_f32 / 2.0;
        let freq_min = freq_min.min(nyquist);
        let freq_max = freq_max.min(nyquist);

        let mut bucket_ranges = Vec::with_capacity(buckets);

        for b in 0..buckets {
            // Use logarithmic spacing for better perceptual representation
            let log_start = (usize_to_f32(b) / bucket_count).powi(2);
            let log_end = (usize_to_f32(b + 1) / bucket_count).powi(2);

            let start_hz = freq_min + (freq_max - freq_min) * log_start;
            let end_hz = freq_min + (freq_max - freq_min) * log_end;

            let start_bin = f32_to_usize_saturating(start_hz * window_size_f32 / sample_rate_f32);
            let mut end_bin = f32_to_usize_saturating(end_hz * window_size_f32 / sample_rate_f32);

            // Ensure each bucket has at least one bin
            if end_bin <= start_bin {
                end_bin = start_bin + 1;
            }

            // Clamp to valid range
            let start_bin = start_bin.min(window_size / 2);
            let end_bin = end_bin.min(window_size / 2);

            bucket_ranges.push((start_bin, end_bin));
        }

        Self {
            fft,
            window,
            bucket_ranges,
            fft_input: vec![Complex32::new(0.0, 0.0); window_size],
            noise_floor: vec![-40.0; buckets], // Initialize to reasonable noise floor
            buffer: Vec::with_capacity(window_size * 2),
            window_size,
            buckets,
        }
    }

    pub fn feed(&mut self, samples: &[f32]) -> Option<Vec<f32>> {
        // Add new samples to buffer
        self.buffer.extend_from_slice(samples);

        // Only process if we have enough samples
        if self.buffer.len() < self.window_size {
            return None;
        }

        // Take the required window of samples
        let window_samples = &self.buffer[..self.window_size];

        // Remove DC component
        let mean = window_samples.iter().sum::<f32>() / usize_to_f32(self.window_size);

        // Apply window function and prepare FFT input
        for (i, &sample) in window_samples.iter().enumerate() {
            let windowed_sample = (sample - mean) * self.window[i];
            self.fft_input[i] = Complex32::new(windowed_sample, 0.0);
        }

        // Perform FFT
        self.fft.process(&mut self.fft_input);

        // Compute power spectrum and bucket levels
        let mut buckets = vec![0.0; self.buckets];

        for (bucket_idx, &(start_bin, end_bin)) in self.bucket_ranges.iter().enumerate() {
            if start_bin >= end_bin || end_bin > self.fft_input.len() / 2 {
                continue;
            }

            // Calculate average power in this frequency range
            let mut power_sum = 0.0;
            for bin_idx in start_bin..end_bin {
                let magnitude = self.fft_input[bin_idx].norm();
                power_sum += magnitude * magnitude;
            }

            let avg_power = power_sum / usize_to_f32(end_bin - start_bin);

            // Convert to dB with proper scaling
            let db = if avg_power > 1e-12 {
                20.0 * (avg_power.sqrt() / usize_to_f32(self.window_size)).log10()
            } else {
                -80.0 // Very low floor for zero power
            };

            // Only update noise floor when signal is quiet (below current floor + 10dB)
            if db < self.noise_floor[bucket_idx] + 10.0 {
                const NOISE_ALPHA: f32 = 0.001; // Very slow adaptation
                self.noise_floor[bucket_idx] =
                    NOISE_ALPHA * db + (1.0 - NOISE_ALPHA) * self.noise_floor[bucket_idx];
            }

            // Map configurable dB range to 0-1 with gain and curve shaping
            let normalized = ((db - DB_MIN) / (DB_MAX - DB_MIN)).clamp(0.0, 1.0);
            buckets[bucket_idx] = (normalized * GAIN).powf(CURVE_POWER).clamp(0.0, 1.0);
        }

        // Apply light smoothing to reduce jitter
        for i in 1..buckets.len() - 1 {
            buckets[i] = buckets[i] * 0.7 + buckets[i - 1] * 0.15 + buckets[i + 1] * 0.15;
        }

        // Clear processed samples from buffer
        self.buffer.clear();

        Some(buckets)
    }

    pub fn reset(&mut self) {
        self.buffer.clear();
        // Reset noise floor to initial values
        self.noise_floor.fill(-40.0);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn feed_produces_finite_buckets_after_a_complete_fft_window() {
        const WINDOW_SIZE: usize = 512;
        const BUCKETS: usize = 16;
        let mut visualizer = AudioVisualiser::new(16_000, WINDOW_SIZE, BUCKETS, 50.0, 8_000.0);
        let samples = (0..WINDOW_SIZE)
            .map(|index| {
                (2.0 * std::f32::consts::PI * 1_000.0 * usize_to_f32(index) / 16_000.0).sin()
            })
            .collect::<Vec<_>>();

        assert!(visualizer.feed(&samples[..WINDOW_SIZE - 1]).is_none());
        let Some(levels) = visualizer.feed(&samples[WINDOW_SIZE - 1..]) else {
            panic!("a complete FFT window must produce bucket levels");
        };

        assert_eq!(levels.len(), BUCKETS);
        assert!(levels
            .iter()
            .all(|level| level.is_finite() && (0.0..=1.0).contains(level)));
        assert!(levels.iter().any(|&level| level > 0.0));
    }
}
