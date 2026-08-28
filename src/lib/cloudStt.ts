import type {
  CloudSttProvider,
  CloudSttProviderSettings,
  RequestedEngine,
} from "@/bindings";

// The backend checks this version before it permits audio to leave the device.
// Keep this in sync with `settings::CLOUD_STT_CONSENT_VERSION`.
export const CLOUD_STT_CONSENT_VERSION = 1;

export interface CloudSttProviderMetadata {
  provider: CloudSttProvider;
  secretAccountId: string;
  labelKey: string;
}

// Consent and verification use the generated enum values. Native secret-store
// commands instead use the stable account IDs below.
export const CLOUD_STT_PROVIDERS: readonly CloudSttProviderMetadata[] = [
  {
    provider: "deepgram_nova_3",
    secretAccountId: "deepgram_nova3",
    labelKey: "settings.models.cloud.providers.deepgram",
  },
  {
    provider: "eleven_labs_scribe_v2",
    secretAccountId: "elevenlabs_scribe_v2",
    labelKey: "settings.models.cloud.providers.elevenLabs",
  },
];

export const cloudSttProviderForEngine = (
  engine: RequestedEngine | undefined,
): CloudSttProviderMetadata | undefined =>
  CLOUD_STT_PROVIDERS.find((provider) => provider.provider === engine);

export const cloudSttProviderHasCurrentConsent = (
  providers: CloudSttProviderSettings[] | undefined,
  provider: CloudSttProvider,
): boolean => {
  const state = providers?.find((candidate) => candidate.provider === provider);
  return Boolean(
    state &&
      state.consent_version === CLOUD_STT_CONSENT_VERSION &&
      state.audio_transfer_consent &&
      state.privacy_consent &&
      state.local_fallback_consent,
  );
};
