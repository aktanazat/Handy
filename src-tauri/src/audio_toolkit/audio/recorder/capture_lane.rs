//! The realtime lane carrying mono samples from the device callback to the
//! recorder's worker thread.
//!
//! Every field of the shared state has exactly one writer, and that is what
//! makes the whole thing lock-free. Depends on nothing but `std`, so it can be
//! compiled and exercised on its own.

use std::{
    cell::UnsafeCell,
    fmt,
    sync::{
        atomic::{AtomicBool, AtomicU32, AtomicU64, AtomicUsize, Ordering},
        Arc,
    },
    time::Duration,
};

/// The format of samples stored in a [`CaptureDescriptor`].
///
/// The recorder normalizes every cpal input format to native-rate, mono `f32`
/// before it reaches this lane. This is metadata, not a conversion request.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
#[repr(u8)]
pub enum CaptureSampleFormat {
    #[default]
    F32,
}

/// A timestamp flag carried with one callback-sized audio range.
pub const TIMESTAMP_DISCONTINUITY: u8 = 0b0000_0001;
/// A timestamp could not be represented by cpal's native clock.
pub const TIMESTAMP_MISSING: u8 = 0b0000_0010;
/// The first packet after an explicit source-epoch resume.
pub const SOURCE_RESTARTED: u8 = 0b0000_0100;

/// Metadata paired with one contiguous range in the sample lane.
///
/// The descriptor ring contains no audio. A timed producer publishes samples
/// before it publishes this value, so consuming a descriptor also acquires the
/// matching sample range.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct CaptureDescriptor {
    /// Monotonic callback sequence within a capture source.
    pub sequence: u64,
    /// Source epoch selected by the capture owner.
    pub source_epoch: u64,
    /// Native cpal capture timestamp in the source's declared timescale.
    pub native_timestamp_value: i64,
    /// Units per second for `native_timestamp_value`.
    pub native_timestamp_timescale: u32,
    /// The matching platform host-clock sample when the source exposes one.
    pub host_monotonic_anchor_ns: Option<u64>,
    /// Format epoch. It changes with a source format renegotiation.
    pub format_epoch: u64,
    /// Absolute mono-frame position in this lane's lifetime.
    pub frame_start: u64,
    /// Number of mono frames paired with this descriptor.
    pub frame_count: u32,
    /// Native input rate retained by this mono lane.
    pub sample_rate: u32,
    /// The lane's channel count after the recorder's existing downmix policy.
    pub channels: u16,
    /// The lane's normalized sample representation.
    pub sample_format: CaptureSampleFormat,
    /// Discontinuity flags observed by the source callback.
    pub flags: u8,
}

impl CaptureDescriptor {
    fn with_frame_range(mut self, frame_start: usize, frame_count: usize) -> Option<Self> {
        self.frame_start = u64::try_from(frame_start).ok()?;
        self.frame_count = u32::try_from(frame_count).ok()?;
        Some(self)
    }
}

/// The realtime capture lane could not take everything the input device
/// produced, so the recording it was carrying is missing audio.
///
/// Reported instead of the samples that did make it: a recording with a hole
/// in it transcribes into a plausible-looking sentence that silently omits
/// part of what the user said, which is worse than no transcript.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct CaptureOverrun {
    /// Samples the lane refused, at the device's native mono rate.
    pub lost_samples: usize,
    /// Device buffers the lane refused.
    pub refused_buffers: u32,
    /// Lane capacity, in samples at that same rate.
    pub capacity_samples: usize,
    /// The native mono rate the lane was sized for.
    pub sample_rate: u32,
}

impl CaptureOverrun {
    /// How much audio never reached the recording.
    pub fn lost(&self) -> Duration {
        Self::seconds(self.lost_samples, self.sample_rate)
    }

    /// How much audio the lane can hold.
    pub fn capacity(&self) -> Duration {
        Self::seconds(self.capacity_samples, self.sample_rate)
    }

    /// Sample count to wall time, for the message the user reads.
    ///
    /// `u32` saturation is exact for anything real: 2^32 samples is 24 hours at
    /// 48 kHz, and both counts are bounded by a two-second lane.
    fn seconds(samples: usize, sample_rate: u32) -> Duration {
        let samples = u32::try_from(samples).unwrap_or(u32::MAX);
        Duration::from_secs_f64(f64::from(samples) / f64::from(sample_rate.max(1)))
    }
}

impl fmt::Display for CaptureOverrun {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "capture lane overran: lost {:.2}s of audio ({} samples across {} device buffers) after the recorder fell more than {:.1}s behind at {} Hz",
            self.lost().as_secs_f64(),
            self.lost_samples,
            self.refused_buffers,
            self.capacity().as_secs_f64(),
            self.sample_rate,
        )
    }
}

/// The first callback range refused during a timed capture.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct TimedCaptureOverrun {
    pub capture: CaptureOverrun,
    pub first_dropped: CaptureDescriptor,
}

/// The descriptor sidecar for a timed lane.
///
/// Its capacity derives from the negotiated minimum callback frame count. If it
/// fills before the sample ring, the producer uses the same sticky overrun path
/// and preserves the first rejected callback metadata.
struct DescriptorState {
    slots: Box<[UnsafeCell<CaptureDescriptor>]>,
    capacity: usize,
    written: AtomicUsize,
    read: AtomicUsize,
}

/// Storage and control shared by the two halves of the lane.
///
/// Every field is written by exactly one side, which is why none of them
/// needs a lock. `written`, `stop_acks`, `lost`, `refused`, raising
/// `high_water`, publishing descriptors, and setting `overrun` belong to the
/// producer; `read`, descriptor release, resetting `high_water`, and clearing
/// `overrun` belong to the consumer.
struct LaneState {
    /// Sample storage, allocated once. `UnsafeCell` per element rather than
    /// around the whole buffer, so the two halves can hold references into
    /// disjoint regions at the same time without aliasing.
    slots: Box<[UnsafeCell<f32>]>,
    capacity: usize,
    descriptors: Option<DescriptorState>,
    /// Absolute count of samples the producer has committed.
    written: AtomicUsize,
    /// Absolute count of samples the consumer has released.
    read: AtomicUsize,
    /// While set, the producer commits nothing: the recording is over.
    stopped: AtomicBool,
    /// Bumped once per callback that observed `stopped` and returned. A
    /// change in this counter is the consumer's proof that the device has
    /// delivered its last sample for the recording it is closing.
    stop_acks: AtomicU64,
    /// Sticky: a device buffer did not fit, so audio was lost and the
    /// recording in progress is invalid.
    overrun: AtomicBool,
    /// Samples the lane refused.
    lost: AtomicUsize,
    /// Device buffers the lane refused.
    refused: AtomicU32,
    /// Peak occupancy in samples, for diagnosing near-misses.
    high_water: AtomicUsize,
    /// The first timed callback the lane rejected. It is written before the
    /// producer publishes `overrun`, then read only after an acquire load of
    /// that flag.
    first_dropped: UnsafeCell<CaptureDescriptor>,
    first_dropped_present: AtomicBool,
}

// SAFETY: `slots` and descriptor slots are only ever reached through the
// producer and consumer halves, which exist once each by construction and only
// ever touch the disjoint index ranges published by `written`/`read`.
unsafe impl Sync for LaneState {}

fn make_lane(
    capacity: usize,
    descriptor_capacity: Option<usize>,
) -> (CaptureProducer, CaptureConsumer) {
    assert!(capacity > 0, "capture lane needs a non-zero capacity");
    let descriptors = descriptor_capacity.map(|descriptor_capacity| {
        let capacity = descriptor_capacity.max(1);
        DescriptorState {
            slots: (0..capacity)
                .map(|_| UnsafeCell::new(CaptureDescriptor::default()))
                .collect(),
            capacity,
            written: AtomicUsize::new(0),
            read: AtomicUsize::new(0),
        }
    });
    let state = Arc::new(LaneState {
        slots: (0..capacity).map(|_| UnsafeCell::new(0.0)).collect(),
        capacity,
        descriptors,
        written: AtomicUsize::new(0),
        read: AtomicUsize::new(0),
        stopped: AtomicBool::new(false),
        stop_acks: AtomicU64::new(0),
        overrun: AtomicBool::new(false),
        lost: AtomicUsize::new(0),
        refused: AtomicU32::new(0),
        high_water: AtomicUsize::new(0),
        first_dropped: UnsafeCell::new(CaptureDescriptor::default()),
        first_dropped_present: AtomicBool::new(false),
    });
    (
        CaptureProducer {
            state: Arc::clone(&state),
        },
        CaptureConsumer { state },
    )
}

/// Build a sample-only lane holding `capacity` samples and return its two
/// halves.
///
/// This is the only allocation in the lane's lifetime, and it happens before
/// `Stream::play()`, so no callback ever touches the heap.
#[cfg(test)]
pub fn lane(capacity: usize) -> (CaptureProducer, CaptureConsumer) {
    make_lane(capacity, None)
}

/// Build a timed lane with a descriptor capacity derived from the negotiated
/// callback frame minimum.
pub fn timed_lane_with_descriptor_capacity(
    sample_capacity: usize,
    descriptor_capacity: usize,
) -> (CaptureProducer, CaptureConsumer) {
    make_lane(sample_capacity, Some(descriptor_capacity))
}

/// The device-callback half of the lane.
pub struct CaptureProducer {
    state: Arc<LaneState>,
}

impl CaptureProducer {
    fn reject(
        &mut self,
        count: usize,
        written: usize,
        descriptor: Option<CaptureDescriptor>,
    ) -> bool {
        let state = &*self.state;
        if !state.overrun.load(Ordering::Relaxed) {
            if let Some(descriptor) =
                descriptor.and_then(|descriptor| descriptor.with_frame_range(written, count))
            {
                // SAFETY: the producer writes this exactly once before it
                // releases `overrun`; the consumer reads only after acquiring
                // that publication and clears only after discarding the lane.
                // SAFETY: publication is not visible until this write completes.
                unsafe {
                    *state.first_dropped.get() = descriptor;
                }
                state.first_dropped_present.store(true, Ordering::Relaxed);
            }
            state.overrun.store(true, Ordering::Release);
        }
        state.lost.fetch_add(count, Ordering::Relaxed);
        state.refused.fetch_add(1, Ordering::Relaxed);
        false
    }

    /// Acknowledge an already-requested stop without committing samples.
    ///
    /// The callback uses this while it is dispatching a timed source: its
    /// control state may prevent it from reaching [`Self::commit`], but the
    /// consumer still needs proof that no callback can append past the barrier.
    pub fn acknowledge_stop(&mut self) -> bool {
        let state = &*self.state;
        if !state.stopped.load(Ordering::Acquire) {
            return false;
        }
        state.stop_acks.fetch_add(1, Ordering::Release);
        true
    }

    /// Commit `count` mono samples written in place by `fill`.
    ///
    /// Realtime-safe: no allocation, no locking, no logging, no syscall, and
    /// work proportional to `count`. `fill` receives the one or two
    /// contiguous runs those samples map to, in order — the second is empty
    /// unless the write wraps the end of the buffer.
    ///
    /// Returns false when nothing was committed: either the recording is
    /// stopped, or the lane is (or has just become) overrun. An overrun is
    /// sticky for the rest of the recording — the producer stops accepting
    /// rather than resuming on the far side of a gap — so the consumer can
    /// report the loss instead of a plausible short buffer.
    pub fn commit(&mut self, count: usize, fill: impl FnOnce(&mut [f32], &mut [f32])) -> bool {
        let state = &*self.state;

        // A stop outranks everything: the recording is over, and the
        // consumer is waiting for exactly this acknowledgement.
        if state.stopped.load(Ordering::Acquire) {
            self.acknowledge_stop();
            return false;
        }

        if state.overrun.load(Ordering::Relaxed) {
            return self.reject(count, state.written.load(Ordering::Relaxed), None);
        }

        let written = state.written.load(Ordering::Relaxed);
        let used = written - state.read.load(Ordering::Acquire);
        if count > state.capacity - used {
            return self.reject(count, written, None);
        }

        let start = written % state.capacity;
        let head = (state.capacity - start).min(count);
        // `start` through `start + count` (modulo capacity) lies entirely
        // inside the range the consumer has already released, because
        // `count <= capacity - used`, and this is the only producer.
        // SAFETY: both runs are disjoint from anything the consumer can reach.
        let (first, second) = unsafe {
            (
                std::slice::from_raw_parts_mut(
                    UnsafeCell::raw_get(state.slots[start..].as_ptr()),
                    head,
                ),
                std::slice::from_raw_parts_mut(
                    UnsafeCell::raw_get(state.slots.as_ptr()),
                    count - head,
                ),
            )
        };
        fill(first, second);

        state.high_water.fetch_max(used + count, Ordering::Relaxed);
        state.written.store(written + count, Ordering::Release);
        true
    }

    /// Commit a callback-sized sample range and its metadata together.
    ///
    /// Samples publish before their descriptor. The consumer acquires the
    /// descriptor and therefore cannot observe a descriptor without all of its
    /// samples. The two rings share the original sticky-overrun rule.
    pub fn commit_timed(
        &mut self,
        count: usize,
        descriptor: CaptureDescriptor,
        fill: impl FnOnce(&mut [f32], &mut [f32]),
    ) -> bool {
        let state = &*self.state;
        if state.stopped.load(Ordering::Acquire) {
            self.acknowledge_stop();
            return false;
        }

        let written = state.written.load(Ordering::Relaxed);
        if state.overrun.load(Ordering::Relaxed) {
            return self.reject(count, written, Some(descriptor));
        }

        let Some(descriptors) = state.descriptors.as_ref() else {
            return self.reject(count, written, Some(descriptor));
        };
        let used = written - state.read.load(Ordering::Acquire);
        let descriptor_written = descriptors.written.load(Ordering::Relaxed);
        let descriptor_used = descriptor_written - descriptors.read.load(Ordering::Acquire);
        if count > state.capacity - used
            || descriptor_used == descriptors.capacity
            || u32::try_from(count).is_err()
            || u64::try_from(written).is_err()
        {
            return self.reject(count, written, Some(descriptor));
        }

        let start = written % state.capacity;
        let head = (state.capacity - start).min(count);
        // SAFETY: this matches `commit`: the producer writes only released
        // sample slots, and this producer is the only descriptor writer.
        // SAFETY: only this producer writes released sample slots.
        let (first, second) = unsafe {
            (
                std::slice::from_raw_parts_mut(
                    UnsafeCell::raw_get(state.slots[start..].as_ptr()),
                    head,
                ),
                std::slice::from_raw_parts_mut(
                    UnsafeCell::raw_get(state.slots.as_ptr()),
                    count - head,
                ),
            )
        };
        fill(first, second);

        let Some(descriptor) = descriptor.with_frame_range(written, count) else {
            return self.reject(count, written, None);
        };
        state.high_water.fetch_max(used + count, Ordering::Relaxed);
        state.written.store(written + count, Ordering::Release);
        // SAFETY: this descriptor slot is not readable until the release store
        // below, and the consumer has released it before this producer reuses it.
        // SAFETY: the consumer released this descriptor slot before reuse.
        unsafe {
            *UnsafeCell::raw_get(
                descriptors
                    .slots
                    .as_ptr()
                    .add(descriptor_written % descriptors.capacity),
            ) = descriptor;
        }
        descriptors
            .written
            .store(descriptor_written + 1, Ordering::Release);
        true
    }
}

/// The recorder-worker half of the lane.
pub struct CaptureConsumer {
    state: Arc<LaneState>,
}

impl CaptureConsumer {
    /// Samples currently waiting to be read.
    pub fn len(&self) -> usize {
        self.state.written.load(Ordering::Acquire) - self.state.read.load(Ordering::Relaxed)
    }

    /// Lane capacity in samples.
    pub fn capacity(&self) -> usize {
        self.state.capacity
    }

    /// Hand every readable sample to `consume` in order, then release the
    /// slots. `consume` runs once, or twice when the readable range wraps the
    /// end of the buffer. Returns the number of samples released.
    pub fn drain(&mut self, mut consume: impl FnMut(&[f32])) -> usize {
        let written = self.state.written.load(Ordering::Acquire);
        let read = self.state.read.load(Ordering::Relaxed);
        let ready = written - read;
        if ready == 0 {
            return 0;
        }

        let start = read % self.state.capacity;
        let head = (self.state.capacity - start).min(ready);
        // `read` through `written` (modulo capacity) is exclusively ours until
        // we publish the new `read`, and the producer only ever writes at or
        // after `written`.
        // SAFETY: both runs are disjoint from anything the producer can reach.
        unsafe {
            consume(std::slice::from_raw_parts(
                UnsafeCell::raw_get(self.state.slots[start..].as_ptr()),
                head,
            ));
            if head < ready {
                consume(std::slice::from_raw_parts(
                    UnsafeCell::raw_get(self.state.slots.as_ptr()),
                    ready - head,
                ));
            }
        }
        self.state.read.store(written, Ordering::Release);
        ready
    }

    /// Hand each timed sample range to `consume` with its descriptor.
    ///
    /// This is valid only for [`timed_lane_with_descriptor_capacity`]. The descriptor acquire
    /// synchronizes with the producer's publication after the matching samples were written.
    pub fn drain_timed(
        &mut self,
        mut consume: impl FnMut(CaptureDescriptor, &[f32], &[f32]),
    ) -> usize {
        let Some(descriptors) = self.state.descriptors.as_ref() else {
            return 0;
        };
        let mut drained = 0;

        loop {
            let descriptor_written = descriptors.written.load(Ordering::Acquire);
            let descriptor_read = descriptors.read.load(Ordering::Relaxed);
            if descriptor_read == descriptor_written {
                return drained;
            }

            // SAFETY: the producer publishes this slot with the acquire above,
            // and cannot reuse it before this consumer advances descriptor read.
            // SAFETY: acquire publication makes this descriptor initialized.
            let descriptor = unsafe {
                *UnsafeCell::raw_get(
                    descriptors
                        .slots
                        .as_ptr()
                        .add(descriptor_read % descriptors.capacity),
                )
            };
            let read = self.state.read.load(Ordering::Relaxed);
            let frame_start = match usize::try_from(descriptor.frame_start) {
                Ok(frame_start) => frame_start,
                Err(_) => {
                    self.state.overrun.store(true, Ordering::Release);
                    return drained;
                }
            };
            let frame_count = usize::try_from(descriptor.frame_count).unwrap_or(usize::MAX);
            let written = self.state.written.load(Ordering::Acquire);
            if frame_count == 0 || frame_start != read || frame_count > written.saturating_sub(read)
            {
                self.state.overrun.store(true, Ordering::Release);
                return drained;
            }

            let start = read % self.state.capacity;
            let head = (self.state.capacity - start).min(frame_count);
            // SAFETY: descriptor publication proves these sample slots were
            // written. They remain exclusively readable until `read` advances.
            // SAFETY: advancing `read` waits until these sample borrows end.
            unsafe {
                let first = std::slice::from_raw_parts(
                    UnsafeCell::raw_get(self.state.slots[start..].as_ptr()),
                    head,
                );
                let second = if head < frame_count {
                    std::slice::from_raw_parts(
                        UnsafeCell::raw_get(self.state.slots.as_ptr()),
                        frame_count - head,
                    )
                } else {
                    &[]
                };
                consume(descriptor, first, second);
            }
            self.state.read.store(read + frame_count, Ordering::Release);
            descriptors
                .read
                .store(descriptor_read + 1, Ordering::Release);
            drained += frame_count;
        }
    }

    /// Release every readable sample without looking at it. Used while no
    /// recording is active: an always-on stream keeps producing, and a lane
    /// nobody drains would fill up and poison the next recording.
    pub fn discard(&mut self) -> usize {
        self.drain(|_| {})
    }

    /// Release all samples and descriptors without delivering either.
    pub fn discard_timed(&mut self) -> usize {
        let discarded = self.discard();
        if let Some(descriptors) = self.state.descriptors.as_ref() {
            let written = descriptors.written.load(Ordering::Acquire);
            descriptors.read.store(written, Ordering::Release);
        }
        discarded
    }

    /// The overrun this lane is carrying, if any.
    pub fn overrun(&self, sample_rate: u32) -> Option<CaptureOverrun> {
        if !self.state.overrun.load(Ordering::Acquire) {
            return None;
        }
        Some(CaptureOverrun {
            lost_samples: self.state.lost.load(Ordering::Relaxed),
            refused_buffers: self.state.refused.load(Ordering::Relaxed),
            capacity_samples: self.state.capacity,
            sample_rate,
        })
    }

    /// The timed metadata for the first rejected callback, if this was a
    /// timed-lane overrun.
    pub fn timed_overrun(&self, sample_rate: u32) -> Option<TimedCaptureOverrun> {
        let capture = self.overrun(sample_rate)?;
        if !self.state.first_dropped_present.load(Ordering::Acquire) {
            return None;
        }
        // SAFETY: the producer writes this before releasing `overrun`; the
        // acquire in `overrun` and the one above make that write visible.
        // SAFETY: acquire loads above synchronize this initialized value.
        let first_dropped = unsafe { *self.state.first_dropped.get() };
        Some(TimedCaptureOverrun {
            capture,
            first_dropped,
        })
    }

    /// Drop the backlog and clear the overrun so capture resumes healthy.
    ///
    /// The backlog goes first: emptying the lane gives the producer a full
    /// capacity of headroom, so it cannot overrun again — and have that
    /// overrun erased — before the flag is cleared.
    pub fn clear_overrun(&mut self) {
        self.discard_timed();
        self.state.lost.store(0, Ordering::Relaxed);
        self.state.refused.store(0, Ordering::Relaxed);
        self.state
            .first_dropped_present
            .store(false, Ordering::Relaxed);
        self.state.overrun.store(false, Ordering::Release);
    }

    /// Peak occupancy since the last reset.
    pub fn high_water(&self) -> usize {
        self.state.high_water.load(Ordering::Relaxed)
    }

    /// Start a fresh peak measurement. Racing a concurrent raise can only
    /// lose one observation of a diagnostic counter.
    pub fn reset_high_water(&self) {
        self.state.high_water.store(0, Ordering::Relaxed);
    }

    /// Acknowledgement counter, to compare across a stop.
    pub fn stop_acks(&self) -> u64 {
        self.state.stop_acks.load(Ordering::Acquire)
    }

    /// Close the lane: the producer commits nothing more and acknowledges on
    /// its next callback.
    pub fn request_stop(&self) {
        self.state.stopped.store(true, Ordering::Release);
    }

    /// Reopen the lane after a stop.
    pub fn resume(&self) {
        self.state.stopped.store(false, Ordering::Release);
    }
}

#[cfg(test)]
mod tests {
    use super::{timed_lane_with_descriptor_capacity, CaptureDescriptor, CaptureSampleFormat};

    fn descriptor(sequence: u64, epoch: u64, timestamp: i64) -> CaptureDescriptor {
        CaptureDescriptor {
            sequence,
            source_epoch: epoch,
            native_timestamp_value: timestamp,
            native_timestamp_timescale: 1_000_000_000,
            host_monotonic_anchor_ns: Some(u64::try_from(timestamp).unwrap_or_default()),
            format_epoch: 0,
            frame_start: 0,
            frame_count: 0,
            sample_rate: 48_000,
            channels: 1,
            sample_format: CaptureSampleFormat::F32,
            flags: 0,
        }
    }

    #[test]
    fn timed_lane_preserves_descriptor_sample_pairs_across_wrap() {
        let (mut producer, mut consumer) = timed_lane_with_descriptor_capacity(8, 8);
        assert!(
            producer.commit_timed(6, descriptor(1, 3, 10), |first, second| {
                for (index, sample) in first.iter_mut().chain(second.iter_mut()).enumerate() {
                    *sample = index as f32;
                }
            })
        );

        let mut first = Vec::new();
        assert_eq!(
            consumer.drain_timed(|metadata, head, tail| {
                first.push((
                    metadata,
                    head.iter().chain(tail.iter()).copied().collect::<Vec<_>>(),
                ));
            }),
            6
        );
        assert_eq!(first.len(), 1);
        assert_eq!(first[0].0.sequence, 1);
        assert_eq!(first[0].0.source_epoch, 3);
        assert_eq!(first[0].0.frame_start, 0);
        assert_eq!(first[0].0.frame_count, 6);
        assert_eq!(first[0].1, vec![0.0, 1.0, 2.0, 3.0, 4.0, 5.0]);

        assert!(
            producer.commit_timed(5, descriptor(2, 3, 20), |head, tail| {
                for (index, sample) in head.iter_mut().chain(tail.iter_mut()).enumerate() {
                    *sample = 10.0 + index as f32;
                }
            })
        );
        let mut second = Vec::new();
        assert_eq!(
            consumer.drain_timed(|metadata, head, tail| {
                second.push((
                    metadata,
                    head.len(),
                    tail.len(),
                    head.iter().chain(tail.iter()).copied().collect::<Vec<_>>(),
                ));
            }),
            5
        );
        assert_eq!(second.len(), 1);
        assert_eq!(second[0].0.sequence, 2);
        assert_eq!(second[0].0.frame_start, 6);
        assert_eq!(second[0].0.frame_count, 5);
        assert_eq!((second[0].1, second[0].2), (2, 3));
        assert_eq!(second[0].3, vec![10.0, 11.0, 12.0, 13.0, 14.0]);
    }

    #[test]
    fn timed_lane_reports_the_first_dropped_callback() {
        let (mut producer, mut consumer) = timed_lane_with_descriptor_capacity(4, 4);
        assert!(
            producer.commit_timed(4, descriptor(7, 11, 100), |head, tail| {
                for sample in head.iter_mut().chain(tail.iter_mut()) {
                    *sample = 1.0;
                }
            })
        );
        assert!(!producer.commit_timed(2, descriptor(8, 11, 200), |_, _| {}));

        let overrun = consumer
            .timed_overrun(48_000)
            .expect("timed overrun metadata");
        assert_eq!(overrun.capture.lost_samples, 2);
        assert_eq!(overrun.capture.refused_buffers, 1);
        assert_eq!(overrun.first_dropped.sequence, 8);
        assert_eq!(overrun.first_dropped.source_epoch, 11);
        assert_eq!(overrun.first_dropped.native_timestamp_value, 200);
        assert_eq!(overrun.first_dropped.frame_start, 4);
        assert_eq!(overrun.first_dropped.frame_count, 2);

        consumer.clear_overrun();
        assert!(consumer.timed_overrun(48_000).is_none());
        assert!(
            producer.commit_timed(1, descriptor(9, 12, 300), |head, tail| {
                head[0] = 2.0;
                assert!(tail.is_empty());
            })
        );
    }

    #[test]
    fn descriptor_pressure_uses_the_same_explicit_overrun_path() {
        let (mut producer, consumer) = timed_lane_with_descriptor_capacity(8, 1);
        assert!(
            producer.commit_timed(1, descriptor(1, 1, 10), |head, tail| {
                head[0] = 1.0;
                assert!(tail.is_empty());
            })
        );
        assert!(!producer.commit_timed(1, descriptor(2, 1, 20), |_, _| {}));

        let overrun = consumer
            .timed_overrun(48_000)
            .expect("descriptor pressure recorded");
        assert_eq!(overrun.capture.lost_samples, 1);
        assert_eq!(overrun.first_dropped.sequence, 2);
        assert_eq!(overrun.first_dropped.native_timestamp_value, 20);
    }

    #[test]
    fn timed_stop_has_an_explicit_callback_acknowledgement() {
        let (mut producer, consumer) = timed_lane_with_descriptor_capacity(8, 8);
        let before = consumer.stop_acks();
        consumer.request_stop();
        assert!(producer.acknowledge_stop());
        assert_eq!(consumer.stop_acks(), before + 1);
        consumer.resume();
        assert!(!producer.acknowledge_stop());
    }
}
