import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'

export default function NotFoundPage() {
  return (
    <div className="min-h-screen bg-warm flex items-center justify-center px-6">
      <motion.div
        className="text-center max-w-md"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
      >
        <p className="text-[100px] font-extrabold text-sand leading-none mb-4 tracking-tight select-none">404</p>
        <h1 className="text-[28px] font-extrabold text-ink tracking-tight mb-2">Page not found</h1>
        <p className="text-[14px] text-dim leading-relaxed mb-8">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="flex gap-3 justify-center">
          <Link to="/"
            className="inline-flex items-center gap-2 bg-ink text-warm text-[13px] font-bold px-5 py-3 rounded-xl hover:bg-pitch transition-all">
            ← Back home
          </Link>
          <Link to="/dashboard"
            className="inline-flex items-center gap-2 bg-white border border-black/[0.09] text-ink text-[13px] font-semibold px-5 py-3 rounded-xl hover:border-black/20 transition-all">
            Dashboard
          </Link>
        </div>
      </motion.div>
    </div>
  )
}
