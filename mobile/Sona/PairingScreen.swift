import CoreImage.CIFilterBuiltins
import SwiftUI

/// The one sheet behind the unpaired line: the phone publishes a candidate record, the
/// Mac approves it, the phone reads the approval back.
struct PairingScreen: View {
    @ObservedObject var model: AppModel
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                Text("pair.title")
                    .font(.title3.weight(.semibold))
                    .foregroundStyle(Theme.textPrimary)
                vault
                if let offer = model.pairingOffer {
                    code(offer)
                }
                actions
                calls
                if let message = model.pairingMessage {
                    Text(message)
                        .font(.footnote)
                        .foregroundStyle(Theme.textSecondary)
                        .accessibilityIdentifier("pair-message")
                }
            }
            .padding(24)
        }
        .background(Theme.background)
        .safeAreaInset(edge: .bottom) {
            Button { dismiss() } label: {
                Text("pair.close")
                    .font(.body.weight(.medium))
                    .foregroundStyle(Theme.textSecondary)
                    .frame(maxWidth: .infinity)
                    .frame(height: 44)
            }
            .background(Theme.background)
        }
    }

    private var vault: some View {
        VStack(spacing: 0) {
            field("pair.address", text: $model.endpointDraft, identifier: "endpoint")
                .keyboardType(.URL)
            Divider().overlay(Theme.border)
            field("pair.vaultId", text: $model.vaultIdDraft, identifier: "vault-id")
        }
        .background(
            RoundedRectangle(cornerRadius: Theme.controlRadius, style: .continuous)
                .fill(Theme.inset)
        )
        .overlay(
            RoundedRectangle(cornerRadius: Theme.controlRadius, style: .continuous)
                .strokeBorder(Theme.border, lineWidth: 1)
        )
        .overlay(alignment: .bottomLeading) {
            Text("pair.where")
                .font(.footnote)
                .foregroundStyle(Theme.textTertiary)
                .offset(y: 26)
        }
        .padding(.bottom, 26)
    }

    private func field(
        _ prompt: LocalizedStringKey, text: Binding<String>, identifier: String
    ) -> some View {
        TextField("", text: text, prompt: Text(prompt).foregroundStyle(Theme.textTertiary))
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
            .font(.body)
            .foregroundStyle(Theme.textPrimary)
            .padding(.horizontal, 12)
            .frame(height: 44)
            .accessibilityLabel(Text(prompt))
            .accessibilityIdentifier(identifier)
    }

    private func code(_ offer: PairingOffer) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("pair.show")
                .font(.footnote)
                .foregroundStyle(Theme.textSecondary)
            if let image = qrImage(offer.json) {
                /* Bounded, not `.infinity`: a full-width code pushes the button that
                 * finishes pairing off a phone screen. */
                Image(uiImage: image)
                    .interpolation(.none)
                    .resizable()
                    .frame(width: 180, height: 180)
                    .accessibilityLabel(Text("a11y.qr"))
            }
            HStack {
                Text("pair.fingerprint")
                    .font(.footnote)
                    .foregroundStyle(Theme.textSecondary)
                Spacer()
                Text(offer.fingerprint)
                    .font(.footnote.monospaced())
                    .foregroundStyle(Theme.textPrimary)
            }
            Button { UIPasteboard.general.string = offer.json } label: {
                Text("pair.copy")
                    .font(.footnote.weight(.medium))
                    .foregroundStyle(Theme.accent)
            }
            .accessibilityIdentifier("copy-code")
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
        .background(
            RoundedRectangle(cornerRadius: Theme.cardRadius, style: .continuous)
                .fill(Theme.surface)
        )
        .overlay(
            RoundedRectangle(cornerRadius: Theme.cardRadius, style: .continuous)
                .strokeBorder(Theme.border, lineWidth: 1)
        )
    }

    /// One switch, because the offer is either wanted or it is not.
    private var calls: some View {
        Toggle(isOn: Binding(get: { model.offersAfterCalls }, set: { model.offersAfterCalls = $0 })) {
            VStack(alignment: .leading, spacing: 2) {
                Text("call.toggle")
                    .font(.body)
                    .foregroundStyle(Theme.textPrimary)
                Text("call.toggle.detail")
                    .font(.footnote)
                    .foregroundStyle(Theme.textTertiary)
            }
        }
        .tint(Theme.accent)
        .accessibilityIdentifier("call-offers")
    }

    private var actions: some View {
        VStack(spacing: 12) {
            Button {
                Task { await model.createPairingCode() }
            } label: {
                filled("pair.create")
            }
            .accessibilityIdentifier("create-pairing-code")
            Button {
                Task { await model.finishPairing() }
            } label: {
                outlined("pair.finish")
            }
            .disabled(model.pairingOffer == nil)
            .opacity(model.pairingOffer == nil ? 0.4 : 1)
            .accessibilityIdentifier("finish-pairing")
        }
    }

    private func filled(_ key: LocalizedStringKey) -> some View {
        Text(key)
            .font(.body.weight(.medium))
            .foregroundStyle(Theme.onAccent)
            .frame(maxWidth: .infinity)
            .frame(height: 48)
            .background(
                RoundedRectangle(cornerRadius: Theme.controlRadius, style: .continuous)
                    .fill(Theme.accent)
            )
    }

    private func outlined(_ key: LocalizedStringKey) -> some View {
        Text(key)
            .font(.body.weight(.medium))
            .foregroundStyle(Theme.textPrimary)
            .frame(maxWidth: .infinity)
            .frame(height: 48)
            .background(
                RoundedRectangle(cornerRadius: Theme.controlRadius, style: .continuous)
                    .fill(Theme.inset)
            )
            .overlay(
                RoundedRectangle(cornerRadius: Theme.controlRadius, style: .continuous)
                    .strokeBorder(Theme.border, lineWidth: 1)
            )
    }

    private func qrImage(_ text: String) -> UIImage? {
        let filter = CIFilter.qrCodeGenerator()
        filter.message = Data(text.utf8)
        filter.correctionLevel = "M"
        guard let output = filter.outputImage else { return nil }
        let scaled = output.transformed(by: CGAffineTransform(scaleX: 8, y: 8))
        let context = CIContext()
        guard let cgImage = context.createCGImage(scaled, from: scaled.extent) else { return nil }
        return UIImage(cgImage: cgImage)
    }
}
