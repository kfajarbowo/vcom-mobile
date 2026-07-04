import Foundation
import CallKit
import AVFoundation
import UIKit

@objc class CallKitManager: NSObject {
    @objc static let shared = CallKitManager()

    private var provider: CXProvider?
    private let callController = CXCallController()
    private var currentCallUUID: UUID?
    private var pendingCallData: [String: Any]?

    // Event emitter callback
    private var onCallAction: (([String: Any]) -> Void)?

    override init() {
        super.init()
        setupProvider()
    }

    private func setupProvider() {
        let configuration = CXProviderConfiguration()
        configuration.supportsVideo = true
        configuration.maximumCallsPerCallGroup = 1
        configuration.maximumCallGroups = 1
        configuration.supportedHandleTypes = [.generic]
        configuration.includesCallsInRecents = true

        // App icon for CallKit
        if let iconImage = UIImage(named: "AppIcon") {
            configuration.iconTemplateImageData = iconImage.pngData()
        }

        provider = CXProvider(configuration: configuration)
        provider?.setDelegate(self, queue: nil)
    }

    @objc func setEventCallback(_ callback: @escaping ([String: Any]) -> Void) {
        onCallAction = callback
    }

    @objc func reportIncomingCall(
        callId: String,
        callerId: String,
        callerName: String,
        callType: String,
        isGroupCall: Bool,
        completion: @escaping (Bool, String?) -> Void
    ) {
        let uuid = UUID()
        currentCallUUID = uuid

        pendingCallData = [
            "callId": callId,
            "callerId": callerId,
            "callerName": callerName,
            "callType": callType,
            "isGroupCall": isGroupCall
        ]

        let update = CXCallUpdate()
        update.remoteHandle = CXHandle(type: .generic, value: callerName)
        update.localizedCallerName = callerName
        update.hasVideo = callType == "video"
        update.supportsGrouping = false
        update.supportsUngrouping = false
        update.supportsHolding = false
        update.supportsDTMF = false

        provider?.reportNewIncomingCall(with: uuid, update: update) { error in
            if let error = error {
                print("CallKitManager: Error reporting incoming call: \(error.localizedDescription)")
                completion(false, error.localizedDescription)
            } else {
                print("CallKitManager: Successfully reported incoming call")
                completion(true, nil)
            }
        }
    }

    @objc func endCall(completion: @escaping (Bool) -> Void) {
        guard let uuid = currentCallUUID else {
            completion(false)
            return
        }

        let endCallAction = CXEndCallAction(call: uuid)
        let transaction = CXTransaction(action: endCallAction)

        callController.request(transaction) { error in
            if let error = error {
                print("CallKitManager: Error ending call: \(error.localizedDescription)")
                completion(false)
            } else {
                print("CallKitManager: Successfully ended call")
                completion(true)
            }
        }
    }

    @objc func reportCallEnded() {
        guard let uuid = currentCallUUID else { return }
        provider?.reportCall(with: uuid, endedAt: Date(), reason: .remoteEnded)
        currentCallUUID = nil
        pendingCallData = nil
    }

    @objc func reportCallConnected() {
        guard let uuid = currentCallUUID else { return }
        provider?.reportOutgoingCall(with: uuid, connectedAt: Date())
    }

    private func configureAudioSession() {
        do {
            let audioSession = AVAudioSession.sharedInstance()
            try audioSession.setCategory(.playAndRecord, mode: .voiceChat, options: [.defaultToSpeaker, .allowBluetooth])
            try audioSession.setActive(true)
        } catch {
            print("CallKitManager: Failed to configure audio session: \(error.localizedDescription)")
        }
    }

    private func emitEvent(action: String) {
        guard var data = pendingCallData else { return }
        data["action"] = action
        onCallAction?(data)
    }
}

// MARK: - CXProviderDelegate
extension CallKitManager: CXProviderDelegate {
    func providerDidReset(_ provider: CXProvider) {
        print("CallKitManager: Provider did reset")
        currentCallUUID = nil
        pendingCallData = nil
    }

    func provider(_ provider: CXProvider, perform action: CXAnswerCallAction) {
        print("CallKitManager: Call answered")
        configureAudioSession()
        emitEvent(action: "accept")
        action.fulfill()
    }

    func provider(_ provider: CXProvider, perform action: CXEndCallAction) {
        print("CallKitManager: Call ended")
        emitEvent(action: "reject")
        currentCallUUID = nil
        pendingCallData = nil
        action.fulfill()
    }

    func provider(_ provider: CXProvider, perform action: CXSetMutedCallAction) {
        print("CallKitManager: Mute toggled: \(action.isMuted)")
        action.fulfill()
    }

    func provider(_ provider: CXProvider, didActivate audioSession: AVAudioSession) {
        print("CallKitManager: Audio session activated")
    }

    func provider(_ provider: CXProvider, didDeactivate audioSession: AVAudioSession) {
        print("CallKitManager: Audio session deactivated")
    }

    func provider(_ provider: CXProvider, timedOutPerforming action: CXAction) {
        print("CallKitManager: Action timed out: \(action)")
        emitEvent(action: "missed")
        action.fulfill()
    }
}
