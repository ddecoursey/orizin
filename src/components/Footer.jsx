import { useState } from "react";

// Slim app footer: trademark, contact, donation, and social links.
const CONTACT_EMAIL = "dl.decour@gmail.com";
const DONATE_URL =
  "https://www.paypal.com/donate/?business=WSFPNM5GZ25GU&no_recurring=0&item_name=Hope+you+found+it+useful%21&currency_code=USD";
// Socials go nowhere for now — wire up real URLs later.
const SOCIALS = [
  { name: "X", href: "#", icon: XIcon },
  { name: "GitHub", href: "#", icon: GitHubIcon },
  { name: "LinkedIn", href: "#", icon: LinkedInIcon },
];

export default function Footer() {
  const year = new Date().getFullYear();
  const [donateOpen, setDonateOpen] = useState(false);
  const [contactOpen, setContactOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const copyEmail = async () => {
    try {
      await navigator.clipboard.writeText(CONTACT_EMAIL);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  return (
    <footer className="shrink-0 border-t border-gray-800 bg-gray-950 px-3 lg:px-4 py-2 flex items-center gap-3 lg:gap-4 text-[11px] text-gray-500">
      <span className="whitespace-nowrap">
        © {year} <span className="font-semibold text-gray-400">Orizen</span>™<span className="hidden lg:inline"> · All rights reserved</span>
      </span>

      {/* Contact — popover with the address + copy + open-in-mail */}
      <div className="relative">
        <button
          onClick={() => setContactOpen((o) => !o)}
          className="hover:text-gray-300 transition-colors whitespace-nowrap"
        >
          Contact Us
        </button>

        {contactOpen && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setContactOpen(false)} />
            <div className="absolute bottom-full left-0 mb-2 z-50 w-60 rounded-xl bg-gray-900 border border-gray-700 shadow-2xl shadow-black/50 p-3 flex flex-col gap-2">
              <span className="text-[10px] uppercase tracking-wider font-bold text-gray-500">
                Contact
              </span>
              <span className="text-xs font-mono text-gray-200 break-all">{CONTACT_EMAIL}</span>
              <div className="flex gap-2">
                <button
                  onClick={copyEmail}
                  className="flex-1 text-center px-2 py-1.5 rounded-lg text-[11px] font-semibold bg-gray-800 text-gray-200 hover:bg-gray-700 transition-colors"
                >
                  {copied ? "✓ Copied" : "Copy"}
                </button>
                <a
                  href={`mailto:${CONTACT_EMAIL}`}
                  onClick={() => setContactOpen(false)}
                  className="flex-1 text-center px-2 py-1.5 rounded-lg text-[11px] font-semibold bg-blue-600 text-white hover:bg-blue-500 transition-colors"
                >
                  Email
                </a>
              </div>
            </div>
          </>
        )}
      </div>

      <span className="text-gray-700 hidden sm:inline">·</span>

      {/* Donate — opens a small popover with QR code + PayPal link */}
      <div className="relative">
        <button
          onClick={() => setDonateOpen((o) => !o)}
          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold
            bg-gradient-to-br from-pink-500 via-rose-500 to-red-500 text-white
            hover:brightness-110 transition-all whitespace-nowrap"
        >
          ♥ Donate
        </button>

        {donateOpen && (
          <>
            {/* Click-away backdrop */}
            <div className="fixed inset-0 z-40" onClick={() => setDonateOpen(false)} />
            <div className="absolute bottom-full left-0 mb-2 z-50 w-52 rounded-xl bg-gray-900 border border-gray-700 shadow-2xl shadow-black/50 p-3 flex flex-col items-center gap-2">
              <span className="text-[11px] font-semibold text-gray-300">Scan to donate</span>
              <img
                src="/qr-code.png"
                alt="PayPal donation QR code"
                className="w-36 h-36 rounded-lg bg-white p-1"
              />
              <a
                href={DONATE_URL}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => setDonateOpen(false)}
                className="w-full text-center px-3 py-1.5 rounded-lg text-[11px] font-semibold
                  bg-gradient-to-br from-pink-500 via-rose-500 to-red-500 text-white
                  hover:brightness-110 transition-all"
              >
                Donate via PayPal
              </a>
            </div>
          </>
        )}
      </div>

      <div className="ml-auto flex items-center gap-3">
        {SOCIALS.map(({ name, href, icon: Icon }) => (
          <a
            key={name}
            href={href}
            title={name}
            aria-label={name}
            className="text-gray-500 hover:text-gray-200 transition-colors"
          >
            <Icon className="w-4 h-4" />
          </a>
        ))}
      </div>
    </footer>
  );
}

function XIcon({ className = "" }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231 5.45-6.231Zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77Z" />
    </svg>
  );
}

function GitHubIcon({ className = "" }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true">
      <path d="M12 .5C5.73.5.5 5.73.5 12a11.5 11.5 0 0 0 7.86 10.94c.575.106.785-.25.785-.555 0-.274-.01-1.0-.015-1.96-3.2.695-3.875-1.543-3.875-1.543-.523-1.33-1.277-1.683-1.277-1.683-1.044-.714.08-.7.08-.7 1.154.082 1.762 1.185 1.762 1.185 1.026 1.758 2.693 1.25 3.35.955.103-.743.4-1.25.728-1.538-2.555-.29-5.243-1.278-5.243-5.688 0-1.256.45-2.283 1.183-3.088-.119-.29-.513-1.46.112-3.045 0 0 .965-.31 3.163 1.18a11 11 0 0 1 5.762 0c2.196-1.49 3.16-1.18 3.16-1.18.626 1.585.232 2.755.114 3.045.737.805 1.18 1.832 1.18 3.088 0 4.42-2.69 5.394-5.255 5.68.413.355.78 1.057.78 2.13 0 1.538-.014 2.778-.014 3.156 0 .308.207.667.79.554A11.5 11.5 0 0 0 23.5 12C23.5 5.73 18.27.5 12 .5Z" />
    </svg>
  );
}

function LinkedInIcon({ className = "" }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true">
      <path d="M20.45 20.45h-3.56v-5.57c0-1.33-.02-3.04-1.85-3.04-1.85 0-2.14 1.45-2.14 2.94v5.67H9.35V9h3.42v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28ZM5.34 7.43a2.07 2.07 0 1 1 0-4.14 2.07 2.07 0 0 1 0 4.14ZM7.12 20.45H3.55V9h3.57v11.45ZM22.22 0H1.77C.79 0 0 .77 0 1.73v20.54C0 23.23.79 24 1.77 24h20.45c.98 0 1.78-.77 1.78-1.73V1.73C24 .77 23.2 0 22.22 0Z" />
    </svg>
  );
}
