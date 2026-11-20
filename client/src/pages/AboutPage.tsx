import AboutFaqLayout from '@/components/AboutFaqLayout'
import { ABOUT_HEADING, FAQ_HEADING, UNKNOWN_FACTS, aboutItems } from '@/lib/seo/aboutFaq'

/** None of the /about answers depends on the directory, so no read is made here. */
export default function AboutPage() {
  return <AboutFaqLayout heading={ABOUT_HEADING} items={aboutItems(UNKNOWN_FACTS)} other={{ to: '/faq', label: FAQ_HEADING }} />
}
