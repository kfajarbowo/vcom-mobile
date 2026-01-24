import Foundation
import React

@objc(CallKitModule)
class CallKitModule: RCTEventEmitter {

    private var hasListeners = false

    override init() {
        super.init()
        setupCallbacks()
    }

    @objc override static func requiresMainQueueSetup() -> Bool {
        return true
    }

    override func supportedEvents() -> [String]! {
        return ["onCallAction", "onIncomingCall"]
    }

    override func startObserving() {
        hasListeners = true
    }

    override func stopObserving() {
        hasListeners = false
    }

    private func setupCallbacks() {
        CallKitManager.shared.setEventCallback { [weak self] data in
            guard let self = self, self.hasListeners else { return }
            self.sendEvent(withName: "onCallAction", body: data)
        }
    }

    @objc func showIncomingCallNotification(
        _ callId: String,
        callerId: String,
        callerName: String,
        callType: String,
        isGroupCall: Bool,
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        DispatchQueue.main.async {
            CallKitManager.shared.reportIncomingCall(
                callId: callId,
                callerId: callerId,
                callerName: callerName,
                callType: callType,
                isGroupCall: isGroupCall
            ) { success, error in
                if success {
                    resolve(true)
                } else {
                    reject("ERROR", error ?? "Unknown error", nil)
                }
            }
        }
    }

    @objc func cancelCallNotification(
        _ resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        DispatchQueue.main.async {
            CallKitManager.shared.endCall { success in
                resolve(success)
            }
        }
    }

    @objc func reportCallEnded(
        _ resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        DispatchQueue.main.async {
            CallKitManager.shared.reportCallEnded()
            resolve(true)
        }
    }

    @objc func reportCallConnected(
        _ resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        DispatchQueue.main.async {
            CallKitManager.shared.reportCallConnected()
            resolve(true)
        }
    }

    // iOS doesn't need foreground service, so these are no-ops
    @objc func startGotifyService(
        _ gotifyUrl: String,
        clientToken: String,
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        // On iOS, Gotify client runs in JS layer when app is active
        // Background notifications require APNs VoIP push (future enhancement)
        resolve(true)
    }

    @objc func stopGotifyService(
        _ resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        resolve(true)
    }

    @objc func requestNotificationPermission(
        _ resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        // CallKit handles its own permissions
        resolve("granted")
    }

    @objc func checkNotificationPermission(
        _ resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        resolve(true)
    }
}
