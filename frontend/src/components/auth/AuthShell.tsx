import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'

export const LOGO_URL = 'https://res.cloudinary.com/dmjakrnby/image/upload/v1785357030/real_logo_s3jtjp.png'

// Cream form panel on the left, dark brand panel on the right (matches Figma).
export default function AuthShell({ children, panel }: { children: React.ReactNode; panel: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-warm flex">
      <div className="flex-1 flex flex-col px-5 sm:px-12 py-6 min-w-0">
        <Link to="/" className="flex justify-center lg:justify-start">
          <img src={LOGO_URL} alt="PayPaddy" className="h-28 sm:h-36 w-auto object-contain" />
        </Link>
        <div className="flex-1 flex items-center justify-center py-4">
          <motion.div className="w-full max-w-[400px]"
            initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}>
            {children}
          </motion.div>
        </div>
        <p className="text-[11px] text-mist">Secured by PayPaddy Shield · CBN compliant processors</p>
      </div>
      <div className="hidden lg:flex flex-1 bg-black text-white p-14 flex-col justify-between">
        {panel}
      </div>
    </div>
  )
}