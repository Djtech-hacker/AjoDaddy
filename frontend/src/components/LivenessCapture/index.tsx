// src/components/kyc/LivenessCapture.tsx
//
// Automatic liveness check + auto-capture. Nobody presses a "snap" button:
//   1. finds ONE face and waits until it is centered and steady
//   2. asks for blink / smile / head-turn in a RANDOM order (a pre-recorded video can't predict it)
//   3. asks them to look straight, then captures the photo by itself
//
// Install once:  npm i @mediapipe/tasks-vision
//
// Use:
//   <LivenessCapture
//     onCapture={(imageDataUrl, meta) => { /* send to your approve endpoint */ }}
//     onCancel={() => setOpen(false)}
//   />

import { useEffect, useRef, useState } from 'react'
import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision'

export type Challenge = 'blink' | 'smile' | 'turn'
export type LivenessMeta = { challenges: Challenge[]; durationMs: number }

type Props = {
  onCapture: (imageDataUrl: string, meta: LivenessMeta) => void
  onCancel?: () => void
}

const WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm'
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task'

const STEP_MS = 10000 // time allowed per challenge
const LABEL: Record<Challenge, string> = {
  blink: 'Blink your eyes',
  smile: 'Give a big smile',
  turn: 'Slowly turn your head to one side',
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

function faceBox(pts: { x: number; y: number }[]) {
  let minX = 1, maxX = 0, minY = 1, maxY = 0
  for (const p of pts) {
    if (p.x < minX) minX = p.x
    if (p.x > maxX) maxX = p.x
    if (p.y < minY) minY = p.y
    if (p.y > maxY) maxY = p.y
  }
  return { w: maxX - minX, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 }
}

export default function LivenessCapture({ onCapture, onCancel }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const onCaptureRef = useRef(onCapture)
  onCaptureRef.current = onCapture

  const [challenges] = useState<Challenge[]>(() => shuffle<Challenge>(['blink', 'smile', 'turn']))
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState('')
  const [hint, setHint] = useState('Starting camera…')
  const [done, setDone] = useState(0)
  const [facing, setFacing] = useState(false)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    let raf = 0
    let stream: MediaStream | null = null
    let landmarker: FaceLandmarker | null = null
    let captured = false

    const cleanup = () => {
      cancelAnimationFrame(raf)
      stream?.getTracks().forEach(t => t.stop())
      try { landmarker?.close() } catch { /* ignore */ }
    }

    const run = async () => {
      try {
        setStatus('loading'); setError(''); setDone(0); setFacing(false); setHint('Starting camera…')

        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
          audio: false,
        })
        if (cancelled) { cleanup(); return }
        const video = videoRef.current!
        video.srcObject = stream
        await video.play()

        setHint('Loading face detection…')
        const fileset = await FilesetResolver.forVisionTasks(WASM_URL)
        const make = (delegate: 'GPU' | 'CPU') =>
          FaceLandmarker.createFromOptions(fileset, {
            baseOptions: { modelAssetPath: MODEL_URL, delegate },
            runningMode: 'VIDEO',
            numFaces: 1,
            outputFaceBlendshapes: true,
          })
        try { landmarker = await make('GPU') } catch { landmarker = await make('CPU') }
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

        const resetToPosition = (msg?: string) => {
          phase = 'position'; idx = 0; stableFrames = 0; finalFrames = 0
          eyesWereOpen = false; smileFrames = 0
          setDone(0); setFacing(false)
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
          onCaptureRef.current(dataUrl, { challenges, durationMs: Date.now() - startedAt })
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
            setFacing(false)
            if (phase !== 'position' && now - lastSeen > 1500) resetToPosition('Face lost. Let’s start again.')
            else if (phase === 'position') { stableFrames = 0; setHint('No face found. Look at the camera.') }
            return
          }
          if (faces.length > 1) {
            setFacing(false); stableFrames = 0
            setHint('Only one person should be in the frame.')
            if (phase !== 'position') resetToPosition('Only one person should be in the frame.')
            return
          }
          lastSeen = now

          const pts = faces[0]
          const { w, cx, cy } = faceBox(pts)
          const bs = res.faceBlendshapes?.[0] as Shapes

          // position quality
          let posMsg = ''
          if (w < 0.22) posMsg = 'Move a little closer.'
          else if (w > 0.6) posMsg = 'Move back a little.'
          else if (Math.abs(cx - 0.5) > 0.15 || Math.abs(cy - 0.5) > 0.18) posMsg = 'Center your face in the oval.'
          const posOk = posMsg === ''

          // expression / pose measurements
          const blinkL = shape(bs, 'eyeBlinkLeft')
          const blinkR = shape(bs, 'eyeBlinkRight')
          const smile = (shape(bs, 'mouthSmileLeft') + shape(bs, 'mouthSmileRight')) / 2
          const nose = pts[1], edgeA = pts[234], edgeB = pts[454]
          const span = edgeB.x - edgeA.x || 1
          const ratio = (nose.x - edgeA.x) / span // ~0.5 when looking straight

          if (phase === 'position') {
            if (!posOk) { stableFrames = 0; setFacing(false); setHint(posMsg); return }
            setFacing(true)
            stableFrames++
            if (stableFrames < 12) { setHint('Hold still…'); return }
            phase = 'challenges'; idx = 0; deadline = now + STEP_MS
            eyesWereOpen = false; smileFrames = 0
            setDone(0)
          }

          if (phase === 'challenges') {
            if (cx < 0.2 || cx > 0.8 || w < 0.15) { resetToPosition('Keep your face inside the frame.'); return }
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

          // final: neutral, straight, eyes open -> auto capture
          if (now > deadline) { resetToPosition('Too slow. Let’s try again.'); return }
          setHint('Now look straight at the camera…')
          const straight =
            posOk && smile < 0.3 && Math.abs(ratio - 0.5) < 0.08 && blinkL < 0.3 && blinkR < 0.3
          finalFrames = straight ? finalFrames + 1 : 0
          if (finalFrames >= 6) capture()
        }

        raf = requestAnimationFrame(tick)
      } catch (err: any) {
        if (cancelled) return
        cleanup()
        setStatus('error')
        setError(
          err?.name === 'NotAllowedError'
            ? 'Camera permission was denied. Allow camera access in your browser, then retry.'
            : err?.name === 'NotFoundError'
              ? 'No camera was found on this device.'
              : 'Could not start face detection. Check your internet connection and retry.',
        )
      }
    }

    run()
    return () => { cancelled = true; cleanup() }
  }, [attempt, challenges])

  return (
    <div className="space-y-3">
      <div className="relative aspect-[4/3] overflow-hidden rounded-2xl bg-black">
        <video
          ref={videoRef}
          playsInline
          muted
          className="h-full w-full object-cover"
          style={{ transform: 'scaleX(-1)' }}
        />
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div
            className={`aspect-[3/4] h-[78%] rounded-[50%] border-4 transition-colors ${facing ? 'border-emerald-400' : 'border-white/70'}`}
            style={{ boxShadow: '0 0 0 999px rgba(0,0,0,0.35)' }}
          />
        </div>
        {status === 'loading' && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/60 text-[13px] font-medium text-white">
            {hint}
          </div>
        )}
      </div>

      {status !== 'error' && (
        <>
          <p aria-live="polite" className="text-center text-[14px] font-semibold text-ink">
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