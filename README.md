# VisionAR Advanced Studio

A browser-based hand-tracking and gesture-controlled 3D playground.

## Features in this build
- Live camera preview through `getUserMedia` (HTTPS required).
- MediaPipe Hand Landmarker with 21 landmarks per detected hand.
- GPU delegate with CPU fallback.
- Heuristic gesture classification: Open Palm, Pinch, Fist, Point, Victory.
- Three.js 3D object playground with pinch-to-move and two-hand scale control.
- Live FPS, inference latency, camera and WebGL diagnostics.
- PWA manifest and same-origin app-shell service worker.

## Publish on GitHub Pages
1. Upload **all files and folders** in this package to the root of `main`.
2. Open repository **Settings → Pages**.
3. Set **Deploy from a branch**, branch `main`, folder `/(root)`, then Save.
4. Wait for deployment, then visit:
   `https://hamada3000.github.io/visionar-hand-studio/`
5. Use Chrome on Android, allow camera access, and keep internet enabled for the first model download.

## Runtime dependencies
- Three.js 0.160.0 from jsDelivr.
- MediaPipe Tasks Vision 0.10.14 from jsDelivr.
- Hand Landmarker model from Google MediaPipe model storage.

The model and libraries are downloaded by the browser at runtime. The service worker in this version caches the same-origin application shell. It does not guarantee offline inference because the AI runtime, WASM and model are remote dependencies.

## Important implementation notes
- Camera frames are processed in the browser; the video is not uploaded to a server.
- Gesture labels are geometry-based heuristics over detected landmarks, not a separately trained gesture classifier. Validate on the target device and tune thresholds for different camera angles.
- This is a camera-overlay AR experience, not optical see-through AR. WebXR immersive AR is not assumed because browser/device support varies.
- Mobile performance varies by device. The implementation uses a GPU delegate when available and falls back to CPU if GPU initialization fails.
