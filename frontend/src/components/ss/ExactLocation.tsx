// src/components/ss/ExactLocation.tsx
// Asks the customer to share their location (the browser shows its own permission prompt),
// waits for a good GPS fix, shows it on a map, and can fill the address fields from it.

import { useCallback, useEffect, useRef, useState } from 'react'

export type GeoFix = { lat: number; lng: number; acc: number }
export type GeoAddress = { address: string; city: string; state: string }

type Status = 'idle' | 'locating' | 'done' | 'error'

const GOOD_ENOUGH_M = 30      // stop as soon as a reading is this accurate
const MAX_ACCEPT_M = 500      // refuse anything worse than this
const MAX_WAIT_MS = 15000     // stop waiting after this long and use the best reading

export function useExactLocation() {
  const [fix, setFix] = useState<GeoFix | null>(null)
  const [status, setStatus] = useState<Status>('idle')
  const [error, setError] = useState('')
  const watchId = useRef<number | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const stop = useCallback(() => {
    if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current)
    if (timer.current) clearTimeout(timer.current)
    watchId.current = null
    timer.current = null
  }, [])

  useEffect(() => stop, [stop]) // clean up when the component unmounts

  const start = useCallback(() => {
    setError('')
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
      setStatus('error'); setError('This browser cannot share your location. Type your address instead.')
      return
    }
    if (typeof window !== 'undefined' && !window.isSecureContext) {
      setStatus('error'); setError('Location only works on a secure (https) page.')
      return
    }
    stop()
    setStatus('locating')
    let best: GeolocationPosition | null = null

    const finish = () => {
      stop()
      if (!best) { setStatus('error'); setError('Could not get your location. Try again, near a window or outside.'); return }
      const acc = Math.round(best.coords.accuracy)
      if (acc > MAX_ACCEPT_M) {
        setStatus('error')
        setError(`Your location is only accurate to about ${acc} m. Turn off any VPN, move outside or near a window, and try again, or type your address.`)
        return
      }
      setFix({ lat: best.coords.latitude, lng: best.coords.longitude, acc })
      setStatus('done')
    }

    watchId.current = navigator.geolocation.watchPosition(
      pos => {
        if (!best || pos.coords.accuracy < best.coords.accuracy) best = pos
        if (pos.coords.accuracy <= GOOD_ENOUGH_M) finish()
      },
      err => {
        stop()
        setStatus('error')
        setError(err.code === 1
          ? 'Location is blocked. Allow location for this site in your browser settings, or type your address.'
          : 'Could not get your location. Try again, near a window or outside.')
      },
      { enableHighAccuracy: true, timeout: MAX_WAIT_MS, maximumAge: 0 },
    )
    timer.current = setTimeout(finish, MAX_WAIT_MS)
  }, [stop])

  const reset = useCallback(() => { stop(); setFix(null); setStatus('idle'); setError('') }, [stop])

  return { fix, status, error, start, reset, setFix }
}

// Turns coordinates into a street / area / state (OpenStreetMap Nominatim: free, light use only).
// For production traffic use your own geocoder or the Google Geocoding API.
export async function reverseGeocode(lat: number, lng: number): Promise<GeoAddress | null> {
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&addressdetails=1&zoom=18&lat=${lat}&lon=${lng}`, {
      headers: { 'Accept-Language': 'en' },
    })
    if (!res.ok) return null
    const data = await res.json()
    const a = data?.address ?? {}
    const street = [a.house_number, a.road].filter(Boolean).join(' ')
    const area = a.neighbourhood || a.suburb || a.quarter || a.residential || a.hamlet || a.city_district || ''
    const city = a.city || a.town || a.village || a.county || a.suburb || ''
    // Map data for many Nigerian streets is thin. Use the street if it exists, else the nearest named place.
    const nearest = String(data?.name || '').trim() || String(data?.display_name || '').split(',')[0].trim()
    return {
      address: street || area || nearest,
      city,
      state: String(a.state || '').replace(/ State$/i, ''),
    }
  } catch {
    return null
  }
}

const mapSrc = ({ lat, lng }: GeoFix) => {
  const dLat = 0.002, dLng = 0.003
  return `https://www.openstreetmap.org/export/embed.html?bbox=${lng - dLng},${lat - dLat},${lng + dLng},${lat + dLat}&layer=mapnik&marker=${lat},${lng}`
}

type Props = {
  value: GeoFix | null                          // the saved location, if any
  onChange: (fix: GeoFix | null) => void
  onAddress?: (a: GeoAddress) => void           // called after a new fix when the address was looked up
}

export default function ExactLocation({ value, onChange, onAddress }: Props) {
  const { fix, status, error, start } = useExactLocation()
  const [looking, setLooking] = useState(false)

  // pass each new fix up, and look up the address for it
  useEffect(() => {
    if (!fix) return
    onChange(fix)
    if (!onAddress) return
    let alive = true
    setLooking(true)
    reverseGeocode(fix.lat, fix.lng).then(a => { if (alive && a) onAddress(a) }).finally(() => alive && setLooking(false))
    return () => { alive = false }
  }, [fix]) // eslint-disable-line react-hooks/exhaustive-deps

  const shown = fix ?? value
  const locating = status === 'locating'

  return (
    <div className="ss-field">
      <label>Exact spot for the rider (recommended)</label>
      <div>
        <button type="button" className="ss-btn ghost sm" disabled={locating} onClick={start}>
          {locating ? 'Finding your exact spot…' : shown ? '📍 Update my location' : '📍 Use my current location'}
        </button>
      </div>

      {shown && (
        <>
          <p className="ss-hint">
            {shown.lat.toFixed(6)}, {shown.lng.toFixed(6)}
            {shown.acc > 0 ? ` · accurate to about ${shown.acc} m` : ''}
            {looking ? ' · finding your street…' : ''}
          </p>
          <iframe
            title="Your delivery location"
            src={mapSrc(shown)}
            style={{ width: '100%', height: 200, border: 0, borderRadius: 12 }}
            loading="lazy"
          />
          <p className="ss-hint">
            <a href={`https://www.google.com/maps?q=${shown.lat},${shown.lng}`} target="_blank" rel="noreferrer">Open in Google Maps</a>
          </p>
        </>
      )}

      {error && <p className="ss-hint">{error}</p>}
      <p className="ss-hint">Stand at the place where the rider should bring your goods, then tap the button. Your phone will ask permission first.</p>
    </div>
  )
}