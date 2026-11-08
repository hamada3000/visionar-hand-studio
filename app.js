import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js";

const $ = id => document.getElementById(id);
const video = $("camera");
const landmarkCanvas = $("landmarkCanvas");
const lctx = landmarkCanvas.getContext("2d");
const mount = $("threeMount");
const logEl = $("log");
const MODEL_URL = "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";
const MP_VERSION = "0.10.14";
const WASM_ROOT = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}/wasm`;
const MP_MODULE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}/vision_bundle.mjs`;

let stream = null, landmarker = null, running = false, lastVideoTime = -1;
let lastFrameAt = 0, fpsFrames = 0, fpsStart = performance.now(), currentFps = 0;
let lastGesture = "—", stableGesture = "—", gestureSince = 0;
let dragging = false, dragHand = null, lastSwipe = 0, previousPalm = null;
let handsNow = [], previousTwoHandDistance = null;
let renderer, scene, camera3d, object, particles, objectMaterial;
let objectScale = 1, rotationSpeed = 1, showLandmarks = true, showCamera = true;
let lastProcessMs = 0;

function log(message) {
  const stamp = new Date().toLocaleTimeString("en-GB");
  logEl.textContent = `[${stamp}] ${message}\n` + logEl.textContent.slice(0, 1800);
}
function setStatus(text, good=false) {
  $("systemStatus").innerHTML = `<i style="background:${good ? "#70e5b1" : "#e9b65c"}"></i> ${text}`;
}
function diagnose() {
  const cameraOK = !!navigator.mediaDevices?.getUserMedia;
  $("apiStatus").textContent = cameraOK ? "AVAILABLE" : "MISSING";
  $("apiStatus").style.color = cameraOK ? "#70e5b1" : "#ff7185";
  $("secureStatus").textContent = window.isSecureContext ? "SECURE" : "NOT SECURE";
  $("secureStatus").style.color = window.isSecureContext ? "#70e5b1" : "#ff7185";
  const testCanvas = document.createElement("canvas");
  const gl = testCanvas.getContext("webgl2") || testCanvas.getContext("webgl");
  $("webglStatus").textContent = gl ? "SUPPORTED" : "UNAVAILABLE";
  $("webglStatus").style.color = gl ? "#70e5b1" : "#ff7185";
  return cameraOK && window.isSecureContext;
}

function init3D() {
  scene = new THREE.Scene();
  camera3d = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
  camera3d.position.set(0, 0, 7);
  renderer = new THREE.WebGLRenderer({ alpha:true, antialias:true, powerPreference:"high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.7));
  renderer.setSize(mount.clientWidth || 640, mount.clientHeight || 420);
  renderer.setClearColor(0x000000, 0);
  mount.appendChild(renderer.domElement);
  scene.add(new THREE.AmbientLight(0x8dbdff, 1.8));
  const key = new THREE.PointLight(0x5de9e8, 30, 30); key.position.set(2,3,5); scene.add(key);
  const rim = new THREE.PointLight(0x597dff, 22, 30); rim.position.set(-3,-2,2); scene.add(rim);
  objectMaterial = new THREE.MeshPhysicalMaterial({color:0x62e7e8,metalness:.65,roughness:.18,transmission:.18,thickness:.8,emissive:0x073c55,emissiveIntensity:.8,wireframe:false});
  object = makeObject("icosahedron");
  scene.add(object);
  const count = 500, positions = new Float32Array(count*3);
  for(let i=0;i<count;i++){positions[i*3]=(Math.random()-.5)*11;positions[i*3+1]=(Math.random()-.5)*7;positions[i*3+2]=(Math.random()-.5)*3-1;}
  const geo = new THREE.BufferGeometry(); geo.setAttribute("position",new THREE.BufferAttribute(positions,3));
  particles = new THREE.Points(geo,new THREE.PointsMaterial({color:0x5bdde8,size:.018,transparent:true,opacity:.65}));
  scene.add(particles);
  new ResizeObserver(resize3D).observe(mount);
  animate3D();
}
function makeObject(type) {
  let geometry;
  if(type==="torus") geometry=new THREE.TorusKnotGeometry(.85,.22,160,24,2,3);
  else if(type==="sphere") geometry=new THREE.IcosahedronGeometry(1.05,3);
  else if(type==="box") geometry=new THREE.BoxGeometry(1.65,1.65,1.65,4,4,4);
  else geometry=new THREE.IcosahedronGeometry(1.15,1);
  const mesh=new THREE.Mesh(geometry,objectMaterial);
  mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(geometry),new THREE.LineBasicMaterial({color:0xc1ffff,transparent:true,opacity:.5})));
  return mesh;
}
function resize3D() {
  if(!renderer)return;
  const w=mount.clientWidth||640,h=mount.clientHeight||420;
  renderer.setSize(w,h,false);camera3d.aspect=w/h;camera3d.updateProjectionMatrix();
  const d=window.devicePixelRatio||1;landmarkCanvas.width=Math.round(w*d);landmarkCanvas.height=Math.round(h*d);
  landmarkCanvas.style.width=w+"px";landmarkCanvas.style.height=h+"px";lctx.setTransform(d,0,0,d,0,0);
}
function animate3D() {
  requestAnimationFrame(animate3D);
  if(object && $("autoRotate").checked && !dragging){object.rotation.x += .004*rotationSpeed;object.rotation.y += .006*rotationSpeed;}
  if(particles){particles.visible=$("particlesToggle").checked;particles.rotation.y+=.00025;}
  if(renderer)renderer.render(scene,camera3d);
}
function drawLandmarks(results) {
  const w=landmarkCanvas.clientWidth,h=landmarkCanvas.clientHeight;
  lctx.clearRect(0,0,w,h);
  if(!showLandmarks || $("skeletonMode").value==="off" || !results.landmarks)return;
  const connections=[[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],[10,11],[11,12],[9,13],[13,14],[14,15],[15,16],[13,17],[17,18],[18,19],[19,20],[0,17]];
  results.landmarks.forEach((points,handIndex)=>{
    const color=handIndex===0?"#5df1e7":"#8c9bff";
    if($("skeletonMode").value==="all"){
      lctx.strokeStyle=color;lctx.lineWidth=2;lctx.shadowColor=color;lctx.shadowBlur=7;
      connections.forEach(([a,b])=>{lctx.beginPath();lctx.moveTo((1-points[a].x)*w,points[a].y*h);lctx.lineTo((1-points[b].x)*w,points[b].y*h);lctx.stroke();});
    }
    lctx.shadowBlur=8;lctx.fillStyle="#f1ffff";
    points.forEach((p,i)=>{lctx.beginPath();lctx.arc((1-p.x)*w,p.y*h,i===0?4:2.5,0,Math.PI*2);lctx.fill();});
  });
  lctx.shadowBlur=0;
}
function dist(a,b){return Math.hypot(a.x-b.x,a.y-b.y);}
function classifyGesture(p) {
  const wrist=p[0], tips=[8,12,16,20], bases=[5,9,13,17];
  const extended=tips.map((t,i)=>dist(p[t],wrist)>dist(p[bases[i]],wrist)*1.16);
  const count=extended.filter(Boolean).length;
  const pinch=dist(p[4],p[8])<.065;
  if(pinch)return "PINCH";
  if(count===4)return "OPEN PALM";
  if(count===0)return "FIST";
  if(extended[0] && extended[1] && !extended[2] && !extended[3])return "VICTORY";
  if(extended[0] && !extended[1] && !extended[2] && !extended[3])return "POINT";
  return "TRACKING";
}
function palmCenter(p){return {x:(p[0].x+p[5].x+p[9].x+p[13].x+p[17].x)/5,y:(p[0].y+p[5].y+p[9].y+p[13].y+p[17].y)/5};}
function processGestures(results) {
  const landmarks=results.landmarks||[];
  handsNow=landmarks;
  $("handsMetric").textContent=landmarks.length;
  $("handsValue").textContent=`${landmarks.length} HAND${landmarks.length===1?"":"S"}`;
  if(!landmarks.length){
    $("gestureValue").textContent="NO HAND";$("gestureMetric").textContent="—";
    dragging=false;previousTwoHandDistance=null;previousPalm=null;return;
  }
  const p=landmarks[0],g=classifyGesture(p);
  if(g!==lastGesture){lastGesture=g;gestureSince=performance.now();}
  if(performance.now()-gestureSince>160)stableGesture=g;
  $("gestureValue").textContent=stableGesture;$("gestureMetric").textContent=stableGesture;
  const center=palmCenter(p);
  if(stableGesture==="PINCH"){
    dragging=true;dragHand=0;
    object.position.x=(.5-center.x)*5.3;
    object.position.y=(.5-center.y)*3.1;
    object.scale.setScalar(objectScale);
  } else if(stableGesture==="FIST"){dragging=false;}
  else if(stableGesture==="OPEN PALM"){dragging=false;}
  if(previousPalm && performance.now()-lastSwipe>700){
    const dx=center.x-previousPalm.x;
    if(Math.abs(dx)>.23){object.rotation.y += dx>0?1.1:-1.1;lastSwipe=performance.now();log("SWIPE detected · scene rotated");}
  }
  previousPalm=center;
  if(landmarks.length>=2){
    const c1=palmCenter(landmarks[0]),c2=palmCenter(landmarks[1]);
    const d=dist(c1,c2);
    if(previousTwoHandDistance!==null){
      const ratio=d/previousTwoHandDistance;
      if(ratio>1.025||ratio<.975){objectScale=THREE.MathUtils.clamp(objectScale*ratio,.5,2.2);object.scale.setScalar(objectScale);$("objectScale").value=objectScale;$("scaleOut").textContent=objectScale.toFixed(1)+"×";}
    }
    previousTwoHandDistance=d;
  }else previousTwoHandDistance=null;
}
async function loadVision() {
  if(landmarker)return;
  setStatus("تحميل محرك الرؤية…");
  $("modelStatus").textContent="تحميل MediaPipe…";
  log("Loading MediaPipe Tasks Vision runtime");
  const mp=await import(MP_MODULE);
  const vision=await mp.FilesetResolver.forVisionTasks(WASM_ROOT);
  const options={baseOptions:{modelAssetPath:MODEL_URL,delegate:"GPU"},runningMode:"VIDEO",numHands:Number($("maxHands").value),minHandDetectionConfidence:Number($("confidence").value),minHandPresenceConfidence:.5,minTrackingConfidence:.5};
  try {landmarker=await mp.HandLandmarker.createFromOptions(vision,options);}
  catch(gpuError){
    log("GPU delegate unavailable; retrying CPU");
    options.baseOptions.delegate="CPU";
    landmarker=await mp.HandLandmarker.createFromOptions(vision,options);
  }
  $("modelStatus").textContent="MediaPipe جاهز";
  $("visionStatus").textContent="LOADED";
  log("Hand Landmarker initialized");
}
async function startCamera() {
  if(!diagnose()){alert("لازم تفتح التطبيق من رابط HTTPS في Chrome أو متصفح يدعم الكاميرا.");return;}
  try{
    $("startBtn").disabled=true;
    if(stream)stopCamera();
    const facingMode=$("cameraSelect").value;
    stream=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:facingMode},width:{ideal:1280},height:{ideal:720}}});
    video.srcObject=stream;await video.play();video.style.display=showCamera?"block":"none";
    $("welcome").style.display="none";$("trackingHud").style.display="flex";
    await loadVision();
    running=true;lastVideoTime=-1;
    $("stopBtn").disabled=false;setStatus("التتبع يعمل",true);
    log("Camera started · "+facingMode);
    requestAnimationFrame(processFrame);
  }catch(error){
    console.error(error);log("ERROR: "+error.name+" — "+error.message);
    setStatus("فشل التشغيل");$("startBtn").disabled=false;
    alert("لم يبدأ التتبع: "+error.message+"\nتأكد من السماح للكاميرا والاتصال بالإنترنت لتحميل نموذج AI.");
    stopCamera();
  }
}
function processFrame(now) {
  if(!running)return;
  if(video.readyState>=2 && video.currentTime!==lastVideoTime){
    lastVideoTime=video.currentTime;
    const t0=performance.now();
    try{
      const result=landmarker.detectForVideo(video,now);
      lastProcessMs=performance.now()-t0;
      drawLandmarks(result);processGestures(result);
    }catch(e){log("Inference error: "+e.message);}
    fpsFrames++;
    if(now-fpsStart>=1000){currentFps=Math.round(fpsFrames*1000/(now-fpsStart));fpsFrames=0;fpsStart=now;$("fpsMetric").textContent=currentFps;}
    $("latencyMetric").textContent=Math.round(lastProcessMs);
  }
  requestAnimationFrame(processFrame);
}
function stopCamera() {
  running=false;
  if(stream){stream.getTracks().forEach(t=>t.stop());stream=null;}
  video.pause();video.srcObject=null;video.style.display="none";
  $("welcome").style.display="flex";$("trackingHud").style.display="none";
  $("startBtn").disabled=false;$("stopBtn").disabled=true;
  $("handsMetric").textContent="0";$("fpsMetric").textContent="—";$("latencyMetric").textContent="—";
  $("gestureMetric").textContent="—";$("handsValue").textContent="0 HANDS";$("gestureValue").textContent="NO GESTURE";
  lctx.clearRect(0,0,landmarkCanvas.clientWidth,landmarkCanvas.clientHeight);
  setStatus("الكاميرا متوقفة");log("Camera stopped");
}
function resetScene(){
  object.position.set(0,0,0);object.rotation.set(0,0,0);objectScale=1;object.scale.setScalar(1);
  $("objectScale").value=1;$("scaleOut").textContent="1.0×";previousTwoHandDistance=null;
  log("Scene reset");
}

$("startBtn").addEventListener("click",startCamera);
$("stopBtn").addEventListener("click",stopCamera);
$("cameraSelect").addEventListener("change",()=>{if(running)startCamera();});
$("fullscreenBtn").addEventListener("click",()=>{if(!document.fullscreenElement)document.documentElement.requestFullscreen?.();else document.exitFullscreen?.();});
$("toggleLandmarks").addEventListener("click",e=>{showLandmarks=!showLandmarks;e.currentTarget.classList.toggle("active",showLandmarks);});
$("toggleCamera").addEventListener("click",e=>{showCamera=!showCamera;video.style.display=showCamera&&stream?"block":"none";e.currentTarget.classList.toggle("active",showCamera);});
$("confidence").addEventListener("input",e=>$("confidenceOut").textContent=Number(e.target.value).toFixed(2));
$("maxHands").addEventListener("change",()=>{if(running){stopCamera();startCamera();}});
$("skeletonMode").addEventListener("change",e=>{showLandmarks=e.target.value!=="off";});
$("objectType").addEventListener("change",e=>{const old=object;object=makeObject(e.target.value);object.position.copy(old.position);object.rotation.copy(old.rotation);object.scale.copy(old.scale);scene.remove(old);old.geometry.dispose();});
$("objectScale").addEventListener("input",e=>{objectScale=Number(e.target.value);object.scale.setScalar(objectScale);$("scaleOut").textContent=objectScale.toFixed(1)+"×";});
$("rotationSpeed").addEventListener("input",e=>{rotationSpeed=Number(e.target.value);$("speedOut").textContent=rotationSpeed.toFixed(1)+"×";});
$("diagnoseBtn").addEventListener("click",()=>{diagnose();log("Environment diagnostics refreshed");});
$("resetBtn").addEventListener("click",resetScene);
document.querySelectorAll(".nav-item").forEach(btn=>btn.addEventListener("click",()=>{
  document.querySelectorAll(".nav-item").forEach(b=>b.classList.toggle("active",b===btn));
  document.querySelectorAll(".control-panel").forEach(p=>p.classList.toggle("active",p.id==="panel-"+btn.dataset.panel));
}));
window.addEventListener("pagehide",stopCamera);
init3D();resize3D();diagnose();
if("serviceWorker" in navigator && location.protocol!=="file:"){
  navigator.serviceWorker.register("./sw.js").then(()=>log("Offline service worker registered")).catch(e=>log("SW registration failed: "+e.message));
}
log("VisionAR Advanced initialized");
