import AboutFaqLayout from '@/components/AboutFaqLayout'
import { useDirectoryFacts } from '@/hooks/useDirectoryFacts'
import { ABOUT_HEADING, FAQ_HEADING, faqItems } from '@/lib/seo/aboutFaq'

export default function FaqPage() {
  const facts = useDirectoryFacts()
  return <AboutFaqLayout heading={FAQ_HEADING} items={faqItems(facts)} other={{ to: '/about', label: ABOUT_HEADING }} />
}
