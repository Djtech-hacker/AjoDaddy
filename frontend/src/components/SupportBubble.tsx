import { useState } from 'react';

const WHATSAPP_NUMBER = import.meta.env.VITE_SUPPORT_WHATSAPP as string | undefined;

interface SupportBubbleProps {
  userName?: string;
}

export default function SupportBubble({ userName }: SupportBubbleProps) {
  const [open, setOpen] = useState(false);

  if (!WHATSAPP_NUMBER) return null;

  const message = encodeURIComponent(
    `Hello TAREVA support, my name is ${userName || 'a user'}. I need help with: `
  );
  const whatsappUrl = `https://wa.me/${WHATSAPP_NUMBER}?text=${message}`;

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end gap-3">
      {open && (
        <div className="w-72 overflow-hidden rounded-2xl bg-white shadow-2xl border border-gray-100">
          <div className="bg-[#0f3d2e] px-4 py-3">
            <p className="text-sm font-semibold text-white">TAREVA Support 👋</p>
            <p className="mt-0.5 text-xs text-[#d9f99d]">We typically reply within a few minutes</p>
          </div>
          <div className="p-4">
            <p className="text-sm text-gray-600">
              Have a question about your wallet, group or payout? Chat with us on WhatsApp.
            </p>
            <a
              href={whatsappUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 block w-full rounded-lg bg-[#0f3d2e] py-2 text-center text-sm font-medium text-white transition hover:bg-[#0b2e22]"
            >
              Start WhatsApp Chat
            </a>
          </div>
        </div>
      )}

      <button
        onClick={() => setOpen((prev) => !prev)}
        aria-label={open ? 'Close support chat' : 'Open support chat'}
        className="flex h-14 w-14 items-center justify-center rounded-full bg-[#0f3d2e] text-[#a3e635] shadow-lg transition hover:scale-105 hover:bg-[#0b2e22]"
      >
        {open ? (
          <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        ) : (
          <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M8 10h.01M12 10h.01M16 10h.01M21 12c0 4.418-4.03 8-9 8a9.86 9.86 0 01-4-.8L3 20l1.3-3.9A7.6 7.6 0 013 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
          </svg>
        )}
      </button>
    </div>
  );
}