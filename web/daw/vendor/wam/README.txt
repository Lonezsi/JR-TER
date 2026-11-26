@webaudiomodules/sdk 0.0.12 (MIT, WebAudioModules Working Group), dist/index.js copied as sdk.js
(source map line removed). Fetched with npm pack. It is the host side of Web Audio Modules 2:
wamhost.js uses initializeWamHost from it. Self-contained, makes no network requests.

test-gain.js and test-wam2.js are stand-in plugins for the tests; test-wam2.js extends the SDK's WebAudioModule.
