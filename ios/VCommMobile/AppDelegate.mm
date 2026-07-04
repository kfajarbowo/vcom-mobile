#import "AppDelegate.h"

#import <React/RCTBundleURLProvider.h>
#import <CallKit/CallKit.h>
#import <AVFoundation/AVFoundation.h>

@implementation AppDelegate

- (BOOL)application:(UIApplication *)application didFinishLaunchingWithOptions:(NSDictionary *)launchOptions
{
  self.moduleName = @"VCommMobile";
  // You can add your custom initial props in the dictionary below.
  // They will be passed down to the ViewController used by React Native.
  self.initialProps = @{};

  // Configure audio session for calls
  [self configureAudioSession];

  return [super application:application didFinishLaunchingWithOptions:launchOptions];
}

- (void)configureAudioSession
{
  NSError *error = nil;
  AVAudioSession *audioSession = [AVAudioSession sharedInstance];

  // Set category to allow both playback and recording
  [audioSession setCategory:AVAudioSessionCategoryPlayAndRecord
                       mode:AVAudioSessionModeVoiceChat
                    options:AVAudioSessionCategoryOptionDefaultToSpeaker | AVAudioSessionCategoryOptionAllowBluetooth
                      error:&error];

  if (error) {
    NSLog(@"Error configuring audio session category: %@", error.localizedDescription);
  }
}

- (NSURL *)sourceURLForBridge:(RCTBridge *)bridge
{
  return [self bundleURL];
}

- (NSURL *)bundleURL
{
#if DEBUG
  return [[RCTBundleURLProvider sharedSettings] jsBundleURLForBundleRoot:@"index"];
#else
  return [[NSBundle mainBundle] URLForResource:@"main" withExtension:@"jsbundle"];
#endif
}

@end
