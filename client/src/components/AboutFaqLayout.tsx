import { ArrowLeft } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import type { FaqItem } from '@/lib/seo/aboutFaq'

interface Props {
  heading: string
  items: FaqItem[]
  /** The sibling page this one links to. */
  other: { to: string; label: string }
}

/** Shared layout of /about and /faq: the approved questions and answers as plain text. */
export default function AboutFaqLayout({ heading, items, other }: Props) {
  const navigate = useNavigate()

  return (
    <div className="min-h-screen bg-gray-50 px-4 pb-12 pt-[calc(env(safe-area-inset-top)+3rem)] sm:px-6 lg:px-8">
      <div className="mx-auto max-w-4xl">
        <button
          onClick={() => navigate(-1)}
          className="group mb-4 flex min-h-[44px] items-center gap-2 text-gray-600 transition-colors hover:text-gray-900"
        >
          <ArrowLeft className="h-5 w-5 transition-transform group-hover:-translate-x-1" />
          <span className="font-medium">Back</span>
        </button>

        <div className="mb-8 rounded-2xl border border-gray-200 bg-white p-8 shadow-sm">
          <h1 className="text-title text-ink-1">{heading}</h1>
        </div>

        <div className="space-y-8 rounded-2xl border border-gray-200 bg-white p-8 shadow-sm">
          {items.map((item) => (
            <section key={item.id} data-testid={`faq-${item.id}`}>
              <h2 className="mb-3 font-display text-[19px] font-bold leading-[1.25] tracking-[-0.02em] text-ink-1">{item.question}</h2>
              <p className="max-w-[70ch] text-[16px] leading-[1.6] text-ink-2">{item.answer}</p>
            </section>
          ))}

          <hr className="border-gray-200" />

          <nav aria-label="More about Hockia" className="flex flex-wrap gap-x-6 gap-y-2 text-[16px] font-medium">
            <Link to={other.to} className="text-hockia-primary underline-offset-4 hover:underline">{other.label}</Link>
            <Link to="/opportunities" className="text-hockia-primary underline-offset-4 hover:underline">Open field hockey roles</Link>
            <Link to="/world" className="text-hockia-primary underline-offset-4 hover:underline">Field hockey clubs by country</Link>
            <Link to="/signup" className="text-hockia-primary underline-offset-4 hover:underline">Join Hockia free</Link>
          </nav>
        </div>
      </div>
    </div>
  )
}
