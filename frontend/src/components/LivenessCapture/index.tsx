// ============================================================
// LivenessCapture (simple selfie capture)
// Blink/turn/smile removed — Prembly does real liveness on the
// backend. This just captures a clean, well-lit selfie.
//
// Folder pattern: save as components/LivenessCapture/index.tsx
//
// USAGE (unchanged — same props as before):
//   <LivenessCapture
//     onCapture={(base64) => { ...upload to cloudinary... }}
//     onCancel={() => { ... }}
//     uploadingLabel="Uploading…"
//   />
// ============================================================

import { useEffect, useRef, useState, useCallback } from 'react'

type Phase = 'loading' | 'ready' | 'countdown' | 'captured' | 'error'

export default function LivenessCapture({
  onCapture,
  onCancel,
  uploadingLabel,
}: {
  onCapture: (base64: string) => void
  onCancel: () => void
  uploadingLabel?: string
}) {
  const videoRef  = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)

  const [phase, setPhase]         = useState<Phase>('loading')
  const [countdown, setCountdown] = useState<number | null>(null)
  const [error, setError]         = useState('')

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
  }, [])

  // Start camera
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480, facingMode: 'user' }, audio: false })
        if (cancelled) { stream.getTracks().forEach(t => t.stop()); return }
        streamRef.current = stream
        if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play() }
        setPhase('ready')
      } catch {
        setError('Camera access denied. Please allow the camera and try again.')
        setPhase('error')
      }
    })()
    return () => { cancelled = true; stop() }
  }, [stop])

  // Countdown then capture
  useEffect(() => {
    if (phase !== 'countdown' || countdown === null) return
    if (countdown <= 0) { doCapture(); return }
    const t = setTimeout(() => setCountdown(c => (c ?? 1) - 1), 1000)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, countdown])

  const startCountdown = () => { setCountdown(3); setPhase('countdown') }

  const doCapture = () => {
    const video  = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas) return
    canvas.width  = video.videoWidth  || 640
    canvas.height = video.videoHeight || 480
    canvas.getContext('2d')?.drawImage(video, 0, 0)
    const base64 = canvas.toDataURL('image/jpeg', 0.9)
    stop()
    setPhase('captured')
    onCapture(base64)
  }

  const handleCancel = () => { stop(); onCancel() }

  if (phase === 'error') {
    return (
      <div className="space-y-4">
        <div className="bg-red-50 border border-red-100 rounded-xl p-4"><p className="text-[12px] text-red-600">{error}</p></div>
        <button onClick={handleCancel} className="w-full h-11 rounded-xl border border-gray-200 text-gray-700 text-[13px] font-semibold hover:bg-gray-50 transition-colors">Close</button>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="bg-blue-50 border border-blue-100 rounded-xl p-3">
        <p className="text-[12px] font-semibold text-blue-700">
          {phase === 'loading'   && 'Starting camera…'}
          {phase === 'ready'     && '👤 Center your face, good lighting, no filters'}
          {phase === 'countdown' && `Hold still — capturing in ${countdown}…`}
          {phase === 'captured'  && (uploadingLabel || 'Uploading…')}
        </p>
      </div>

      <div className="relative rounded-2xl overflow-hidden bg-gray-900" style={{ aspectRatio: '4/3' }}>
        <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" style={{ transform: 'scaleX(-1)' }}/>

        {/* Face oval guide */}
        {(phase === 'ready' || phase === 'countdown') && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className={`w-44 h-56 border-4 rounded-full transition-colors ${phase === 'countdown' ? 'border-emerald-400/80' : 'border-white/60'}`}/>
          </div>
        )}

        {/* Countdown number */}
        {phase === 'countdown' && countdown !== null && countdown > 0 && (
          <div className="absolute top-3 right-3 w-12 h-12 rounded-full bg-black/70 flex items-center justify-center">
            <span className="text-white text-[22px] font-bold">{countdown}</span>
          </div>
        )}

        {/* Loading / uploading spinner */}
        {(phase === 'loading' || phase === 'captured') && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/30">
            <div className="w-8 h-8 border-2 border-white/40 border-t-white rounded-full animate-spin"/>
          </div>
        )}
      </div>

      <canvas ref={canvasRef} className="hidden"/>

      {phase === 'ready' && (
        <button onClick={startCountdown} className="w-full h-11 rounded-xl bg-emerald-600 text-white text-[13px] font-semibold hover:bg-emerald-700 transition-colors">
          📸 Capture Photo
        </button>
      )}
      {phase !== 'captured' && (
        <button onClick={handleCancel} className="w-full h-10 rounded-xl border border-gray-200 text-gray-600 text-[13px] font-semibold hover:bg-gray-50 transition-colors">Cancel</button>
      )}
    </div>
  )
}