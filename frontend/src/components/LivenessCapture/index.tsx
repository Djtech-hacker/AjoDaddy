// src/components/LivenessCapture.tsx
//
// Automatic liveness check + auto-capture. Nobody presses a "snap" button:
//   1. finds ONE face and waits until it is INSIDE the oval and steady
//   2. asks for blink / smile / head-turn in the order the SERVER chose for this session
//   3. asks them to look straight, then captures the photo by itself
//
// The challenge order comes from POST /kyc/liveness/start (prop `challenges`).
// This component is the user experience only: the server re-checks everything.
//
// Model loading: tries LOCAL files first (frontend/public/mediapipe/...), then the CDN.
// Each source has a timeout, so it can never sit on "Loading face detection..." forever.
//
// Install once:  npm i @mediapipe/tasks-vision
//
// Local files (copy once, from the frontend folder):
//   public/mediapipe/wasm/                 <- copy of node_modules/@mediapipe/tasks-vision/wasm/*
//   public/mediapipe/face_landmarker.task  <- download from the CDN_MODEL url below

import { useEffect, useMemo, useRef, useState } from 'react'
import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision'

export type Challenge = 'blink' | 'smile' | 'turn'
export type LivenessMeta = { challenges: Challenge[]; durationMs: number; deviceLabel: string }

type Props = {
  challenges?: Challenge[] // from the server session; if the page doesn't pass it, a random order is used
  onCapture: (imageDataUrl: string, meta: LivenessMeta) => void
  onCancel?: () => void
}

const LOCAL_WASM = '/mediapipe/wasm'
const LOCAL_MODEL = '/mediapipe/face_landmarker.task'
const CDN_WASM = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm'
const CDN_MODEL =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task'

const LOAD_TIMEOUT_MS = 30000 // per source (local, then CDN)
const STEP_MS = 10000 // time allowed per challenge
const LABEL: Record<Challenge, string> = {
  blink: 'Blink your eyes',
  smile: 'Give a big smile',
  turn: 'Slowly turn your head to one side',
}

// ---------- OVAL SETTINGS (tune these) ----------
// Must match the oval drawn in the JSX below: height 78% of the box, aspect 3/4.
const OVAL_H = 0.78 // oval height as a fraction of the box height
const OVAL_ASPECT = 3 / 4 // oval width / oval height

// STRICT = used for positioning and for the final photo
const STRICT_TOL = 1.03 // 1 = landmarks must be exactly inside the oval edge
const STRICT_FILL = 0.6 // face height must be at least 60% of the oval height
// RELAXED = used while doing challenges (head turns move the face a bit)
const RELAX_TOL = 1.2
const RELAX_FILL = 0.45

const OUTLIER_ALLOWED = 0.01 // up to 1% of landmarks may stick out (noise)
const OUTSIDE_RESET_MS = 1200 // out of the oval this long during a challenge = restart
// -------------------------------------------------

// Weak signal only (names are easy to fake), but it stops the lazy attacks and
// the label is sent to the server for the audit log.
const VIRTUAL_CAM = /obs|virtual|manycam|xsplit|snap camera|droidcam|iriun|epoccam|splitcam|vcam|e2esoft|camo/i

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} timed out`)), ms)
    p.then(
      v => { clearTimeout(t); resolve(v) },
      e => { clearTimeout(t); reject(e) },
    )
  })
}

async function loadLandmarker(): Promise<FaceLandmarker> {
  const sources = [
    { name: 'local', wasm: LOCAL_WASM, model: LOCAL_MODEL },
    { name: 'cdn', wasm: CDN_WASM, model: CDN_MODEL },
  ]
  let lastErr: unknown = new Error('Face model could not be loaded')
  for (const src of sources) {
    try {
      return await withTimeout(
        (async () => {
          const fileset = await FilesetResolver.forVisionTasks(src.wasm)
          const make = (delegate: 'GPU' | 'CPU') =>
            FaceLandmarker.createFromOptions(fileset, {
              baseOptions: { modelAssetPath: src.model, delegate },
              runningMode: 'VIDEO',
              numFaces: 1,
              outputFaceBlendshapes: true,
            })
          try { return await make('GPU') } catch { return await make('CPU') }
        })(),
        LOAD_TIMEOUT_MS,
        `Face model load (${src.name})`,
      )
    } catch (e) {
      console.warn(`[LivenessCapture] ${src.name} model source failed:`, e)
      lastErr = e
    }
  }
  throw lastErr
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = crypto.getRandomValues(new Uint32Array(1))[0] % (i + 1)
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

type Shapes = { categories: { categoryName: string; score: number }[] } | undefined
const shape = (bs: Shapes, name: string) => bs?.categories.find(c => c.categoryName === name)?.score ?? 0

type Pt = { x: number; y: number }
type Geom = { cw: number; ch: number; vw: number; vh: number }

// Converts a landmark (0..1 of the RAW video) into pixels inside the on-screen box,
// accounting for object-cover cropping and the mirrored (scaleX(-1)) preview.
function toView(p: Pt, g: Geom): Pt {
  const scale = Math.max(g.cw / g.vw, g.ch / g.vh)
  const ox = (g.cw - g.vw * scale) / 2
  const oy = (g.ch - g.vh * scale) / 2
  const x = p.x * g.vw * scale + ox
  const y = p.y * g.vh * scale + oy
  return { x: g.cw - x, y }
}

// Is the face inside the oval the user actually sees?
function checkOval(pts: Pt[], g: Geom, tol: number, minFill: number) {
  const ovalH = g.ch * OVAL_H
  const ry = ovalH / 2
  const rx = (ovalH * OVAL_ASPECT) / 2
  const cx0 = g.cw / 2
  const cy0 = g.ch / 2

  let outside = 0
  let minY = Infinity
  let maxY = -Infinity
  for (const p of pts) {
    const v = toView(p, g)
    const nx = (v.x - cx0) / rx
    const ny = (v.y - cy0) / ry
    if (nx * nx + ny * ny > tol * tol) outside++
    if (v.y < minY) minY = v.y
    if (v.y > maxY) maxY = v.y
  }

  const fill = (maxY - minY) / ovalH
  const stickingOut = outside > pts.length * OUTLIER_ALLOWED

  let msg = ''
  if (fill < minFill) msg = 'Move a little closer.'
  else if (stickingOut) msg = fill > 1 ? 'Move back a little.' : 'Center your face in the oval.'

  return { ok: msg === '', msg }
}

export default function LivenessCapture({ challenges: challengesProp, onCapture, onCancel }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const onCaptureRef = useRef(onCapture)
  onCaptureRef.current = onCapture

  // Keep the same array identity unless the order really changes,
  // so the camera effect below does not restart on every parent render.
  const [localOrder] = useState<Challenge[]>(() => shuffle<Challenge>(['blink', 'smile', 'turn']))
  const challengesKey = (challengesProp && challengesProp.length ? challengesProp : localOrder).join(',')
  const challenges = useMemo(() => challengesKey.split(',') as Challenge[], [challengesKey])

  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState('')
  const [hint, setHint] = useState('Starting camera…')
  const [done, setDone] = useState(0)
  // 'idle' = no face, 'bad' = face found but NOT in the oval, 'ok' = face in the oval
  const [oval, setOval] = useState<'idle' | 'bad' | 'ok'>('idle')
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    let raf = 0
    let stream: MediaStream | null = null
    let landmarker: FaceLandmarker | null = null
    let captured = false
    let deviceLabel = ''

    const cleanup = () => {
      cancelAnimationFrame(raf)
      stream?.getTracks().forEach(t => t.stop())
      try { landmarker?.close() } catch { /* ignore */ }
    }

    const run = async () => {
      try {
        setStatus('loading'); setError(''); setDone(0); setOval('idle'); setHint('Starting camera…')

        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
          audio: false,
        })
        if (cancelled) { cleanup(); return }

        deviceLabel = stream.getVideoTracks()[0]?.label || ''
        if (VIRTUAL_CAM.test(deviceLabel)) {
          cleanup()
          setStatus('error')
          setError('Virtual cameras are not allowed. Please use your phone or laptop camera.')
          return
        }

        const video = videoRef.current!
        video.srcObject = stream
        await video.play()

        setHint('Loading face detection… (the first time can take a minute)')
        landmarker = await loadLandmarker()
        if (cancelled) { cleanup(); return }
        setStatus('ready')

        const startedAt = Date.now()
        let phase: 'position' | 'challenges' | 'final' = 'position'
        let idx = 0
        let stableFrames = 0
        let finalFrames = 0
        let eyesWereOpen = false
        let smileFrames = 0
        let deadline = 0
        let lastSeen = Date.now()
        let lastVideoTime = -1
        let outsideSince = 0

        const resetToPosition = (msg?: string) => {
          phase = 'position'; idx = 0; stableFrames = 0; finalFrames = 0
          eyesWereOpen = false; smileFrames = 0; outsideSince = 0
          setDone(0); setOval('idle')
          if (msg) setHint(msg)
        }

        const capture = () => {
          const canvas = document.createElement('canvas')
          canvas.width = video.videoWidth
          canvas.height = video.videoHeight
          canvas.getContext('2d')!.drawImage(video, 0, 0)
          const dataUrl = canvas.toDataURL('image/jpeg', 0.9)
          captured = true
          cleanup()
          onCaptureRef.current(dataUrl, { challenges, durationMs: Date.now() - startedAt, deviceLabel })
        }

        const tick = () => {
          if (cancelled || captured) return
          raf = requestAnimationFrame(tick)
          if (video.readyState < 2 || video.currentTime === lastVideoTime) return
          lastVideoTime = video.currentTime

          const res = landmarker!.detectForVideo(video, performance.now())
          const faces = res.faceLandmarks
          const now = Date.now()

          if (!faces || faces.length === 0) {
            setOval('idle')
            if (phase !== 'position' && now - lastSeen > 1500) resetToPosition('Face lost. Let’s start again.')
            else if (phase === 'position') { stableFrames = 0; setHint('No face found. Look at the camera.') }
            return
          }
          if (faces.length > 1) {
            setOval('bad'); stableFrames = 0
            setHint('Only one person should be in the frame.')
            if (phase !== 'position') resetToPosition('Only one person should be in the frame.')
            return
          }
          lastSeen = now

          const pts = faces[0]
          const bs = res.faceBlendshapes?.[0] as Shapes

          // where is the face compared to the oval the user sees?
          const box = boxRef.current
          if (!box || !video.videoWidth) return
          const g: Geom = {
            cw: box.clientWidth,
            ch: box.clientHeight,
            vw: video.videoWidth,
            vh: video.videoHeight,
          }
          const strict = checkOval(pts, g, STRICT_TOL, STRICT_FILL)
          const relaxed = checkOval(pts, g, RELAX_TOL, RELAX_FILL)

          // expression / pose measurements
          const blinkL = shape(bs, 'eyeBlinkLeft')
          const blinkR = shape(bs, 'eyeBlinkRight')
          const smile = (shape(bs, 'mouthSmileLeft') + shape(bs, 'mouthSmileRight')) / 2
          const nose = pts[1], edgeA = pts[234], edgeB = pts[454]
          const span = edgeB.x - edgeA.x || 1
          const ratio = (nose.x - edgeA.x) / span // ~0.5 when looking straight

          // ---------- PHASE 1: get the face inside the oval and hold still ----------
          if (phase === 'position') {
            if (!strict.ok) { stableFrames = 0; setOval('bad'); setHint(strict.msg); return }
            setOval('ok')
            stableFrames++
            if (stableFrames < 12) { setHint('Hold still…'); return }
            phase = 'challenges'; idx = 0; deadline = now + STEP_MS
            eyesWereOpen = false; smileFrames = 0; outsideSince = 0
            setDone(0)
          }

          // ---------- PHASE 2: challenges (only count while the face is in the oval) ----------
          if (phase === 'challenges') {
            if (!relaxed.ok) {
              // face left the oval: nothing counts, progress on this step is wiped
              eyesWereOpen = false
              smileFrames = 0
              setOval('bad')
              setHint(relaxed.msg)
              if (outsideSince === 0) outsideSince = now
              if (now - outsideSince > OUTSIDE_RESET_MS) resetToPosition('Face left the oval. Let’s start again.')
              return
            }
            outsideSince = 0
            setOval('ok')

            if (now > deadline) { resetToPosition('Too slow. Let’s try again.'); return }

            const cur = challenges[idx]
            setHint(LABEL[cur])
            let passed = false

            if (cur === 'blink') {
              if (blinkL < 0.25 && blinkR < 0.25) eyesWereOpen = true
              if (eyesWereOpen && blinkL > 0.55 && blinkR > 0.55) passed = true
            } else if (cur === 'smile') {
              smileFrames = smile > 0.55 ? smileFrames + 1 : 0
              passed = smileFrames >= 4
            } else {
              passed = Math.abs(ratio - 0.5) > 0.16
            }

            if (passed) {
              idx++
              setDone(idx)
              eyesWereOpen = false
              smileFrames = 0
              deadline = now + STEP_MS
              if (idx >= challenges.length) { phase = 'final'; finalFrames = 0 }
            }
            return
          }

          // ---------- PHASE 3: final photo (strict: must be fully inside the oval) ----------
          if (now > deadline) { resetToPosition('Too slow. Let’s try again.'); return }

          if (!strict.ok) {
            finalFrames = 0
            setOval('bad')
            setHint(strict.msg)
            return
          }
          setOval('ok')
          setHint('Now look straight at the camera…')
          const straight =
            smile < 0.3 && Math.abs(ratio - 0.5) < 0.08 && blinkL < 0.3 && blinkR < 0.3
          finalFrames = straight ? finalFrames + 1 : 0
          if (finalFrames >= 6) capture()
        }

        raf = requestAnimationFrame(tick)
      } catch (err: any) {
        if (cancelled) return
        cleanup()
        setStatus('error')
        const msg = String(err?.message || '')
        setError(
          err?.name === 'NotAllowedError'
            ? 'Camera permission was denied. Allow camera access in your browser, then retry.'
            : err?.name === 'NotFoundError'
              ? 'No camera was found on this device.'
              : /timed out/i.test(msg)
                ? 'Face detection took too long to load. Your network may be slow. Retry, or switch networks.'
                : 'Could not start face detection. Check your internet connection and retry.',
        )
      }
    }

    run()
    return () => { cancelled = true; cleanup() }
  }, [attempt, challenges])

  const ovalBorder =
    oval === 'ok' ? 'border-emerald-400' : oval === 'bad' ? 'border-red-400' : 'border-white/70'

  return (
    <div className="mx-auto w-full max-w-[440px] space-y-3">
      <div
        ref={boxRef}
        className="relative aspect-[4/3] max-h-[60vh] w-full overflow-hidden rounded-2xl bg-black"
      >
        <video
          ref={videoRef}
          playsInline
          muted
          className="h-full w-full object-cover"
          style={{ transform: 'scaleX(-1)' }}
        />
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          {/* keep h-[78%] and aspect-[3/4] in sync with OVAL_H and OVAL_ASPECT at the top */}
          <div
            className={`aspect-[3/4] h-[78%] rounded-[50%] border-4 transition-colors ${ovalBorder}`}
            style={{ boxShadow: '0 0 0 999px rgba(0,0,0,0.35)' }}
          />
        </div>
        {status === 'loading' && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/30 px-6 text-center text-[13px] font-medium text-white">
            {hint}
          </div>
        )}
      </div>

      {status !== 'error' && (
        <>
          <p
            aria-live="polite"
            className={`text-center text-[14px] font-semibold ${oval === 'bad' ? 'text-red-500' : 'text-ink'}`}
          >
            {status === 'ready' ? hint : 'Please wait…'}
          </p>
          <ul className="flex justify-center gap-2 text-[12px]">
            {challenges.map((c, i) => (
              <li
                key={c}
                className={`rounded-full px-3 py-1 font-semibold ${i < done ? 'bg-emerald-100 text-emerald-700' : 'bg-black/[0.05] text-dim'}`}
              >
                {i < done ? '✓ ' : ''}{c === 'blink' ? 'Blink' : c === 'smile' ? 'Smile' : 'Turn'}
              </li>
            ))}
          </ul>
        </>
      )}

      {status === 'error' && (
        <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-[13px] font-medium text-red-600">
          {error}
          <button
            type="button"
            onClick={() => setAttempt(a => a + 1)}
            className="ml-2 font-bold underline"
          >
            Retry
          </button>
        </div>
      )}

      {onCancel && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-xl border border-black/[0.1] bg-white px-5 py-2.5 text-[13px] font-semibold text-ink"
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  )
}