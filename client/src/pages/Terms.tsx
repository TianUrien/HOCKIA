import { FileText, ArrowLeft } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

export default function Terms() {
  const navigate = useNavigate()

  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-4xl mx-auto">
        {/* Back Button */}
        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-2 text-gray-600 hover:text-gray-900 mb-6 transition-colors group"
        >
          <ArrowLeft className="w-5 h-5 group-hover:-translate-x-1 transition-transform" />
          <span className="font-medium">Back</span>
        </button>

        {/* Header Card */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8 mb-8">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 bg-purple-50 rounded-xl flex items-center justify-center flex-shrink-0">
              <FileText className="w-6 h-6 text-purple-600" />
            </div>
            <div>
              <h1 className="text-3xl font-bold text-gray-900 mb-2">Terms & Conditions</h1>
              <p className="text-gray-600">Effective date: November 2025</p>
            </div>
          </div>
        </div>

        {/* Content Card */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8 space-y-8">
          {/* Section 1: Introduction */}
          <section>
            <h2 className="text-2xl font-semibold text-gray-900 mb-4">1. Introduction</h2>
            <div className="space-y-4 text-gray-700 leading-relaxed">
              <p>
                These Terms & Conditions ("Terms") govern your use of HOCKIA, the online platform
                connecting field hockey players, coaches, and clubs. By accessing or using HOCKIA, you
                agree to comply with these Terms.
              </p>
            </div>
          </section>

          <hr className="border-gray-200" />

          {/* Section 2: Eligibility */}
          <section>
            <h2 className="text-2xl font-semibold text-gray-900 mb-4">2. Eligibility</h2>
            <div className="space-y-4 text-gray-700 leading-relaxed">
              <p>
                You must be at least 16 years old to create an account or have consent from a parent
                or guardian. You are responsible for the accuracy of the information you provide.
              </p>
            </div>
          </section>

          <hr className="border-gray-200" />

          {/* Section 3: Account Responsibilities */}
          <section>
            <h2 className="text-2xl font-semibold text-gray-900 mb-4">
              3. Account Responsibilities
            </h2>
            <div className="space-y-4 text-gray-700 leading-relaxed">
              <ul className="list-none space-y-3 ml-4">
                <li>
                  • You agree to use HOCKIA only for legitimate purposes related to hockey networking,
                  recruitment, and community.
                </li>
                <li>
                  • You are responsible for maintaining the confidentiality of your account
                  credentials.
                </li>
                <li>
                  • HOCKIA may suspend or remove accounts that violate these Terms or engage in
                  harmful behavior.
                </li>
              </ul>
            </div>
          </section>

          <hr className="border-gray-200" />

          {/* Section 4: Content Ownership */}
          <section>
            <h2 className="text-2xl font-semibold text-gray-900 mb-4">4. Content Ownership</h2>
            <div className="space-y-4 text-gray-700 leading-relaxed">
              <p>
                You retain ownership of all content you upload (photos, descriptions, etc.), but
                grant HOCKIA a non-exclusive, worldwide license to display and distribute it within
                the platform for service purposes.
              </p>
              <p className="font-medium">
                You must not upload content that is offensive, illegal, or infringes third-party
                rights.
              </p>
            </div>
          </section>

          <hr className="border-gray-200" />

          {/* Section 5: Platform Use */}
          <section>
            <h2 className="text-2xl font-semibold text-gray-900 mb-4">5. Platform Use</h2>
            <div className="space-y-4 text-gray-700 leading-relaxed">
              <p>You agree not to:</p>
              <ul className="list-none space-y-3 ml-4">
                <li>• Use HOCKIA for harassment, spam, or misinformation.</li>
                <li>• Attempt to hack, scrape, or exploit the platform.</li>
                <li>• Misrepresent your identity or role.</li>
              </ul>
            </div>
          </section>

          <hr className="border-gray-200" />

          {/* Section 6: Disclaimer */}
          <section>
            <h2 className="text-2xl font-semibold text-gray-900 mb-4">6. Disclaimer</h2>
            <div className="space-y-4 text-gray-700 leading-relaxed">
              <p>
                HOCKIA is currently in beta testing and provided "as is." We do not guarantee
                uninterrupted operation or error-free performance, but we work continuously to
                improve the experience.
              </p>
            </div>
          </section>

          <hr className="border-gray-200" />

          {/* Section 7: Limitation of Liability */}
          <section>
            <h2 className="text-2xl font-semibold text-gray-900 mb-4">
              7. Limitation of Liability
            </h2>
            <div className="space-y-4 text-gray-700 leading-relaxed">
              <p>
                HOCKIA, its creators, and contributors shall not be liable for any direct or indirect
                damages resulting from your use of the platform.
              </p>
            </div>
          </section>

          <hr className="border-gray-200" />

          {/* Section 8: Account Termination */}
          <section>
            <h2 className="text-2xl font-semibold text-gray-900 mb-4">8. Account Termination</h2>
            <div className="space-y-4 text-gray-700 leading-relaxed">
              <p>
                You may delete your account at any time through Settings. HOCKIA may suspend or
                terminate accounts violating these Terms or used inappropriately.
              </p>
            </div>
          </section>

          <hr className="border-gray-200" />

          {/* Section 9: Changes to the Terms */}
          <section>
            <h2 className="text-2xl font-semibold text-gray-900 mb-4">9. Changes to the Terms</h2>
            <div className="space-y-4 text-gray-700 leading-relaxed">
              <p>
                We may modify these Terms occasionally. Continued use of HOCKIA after updates
                constitutes acceptance of the new Terms.
              </p>
            </div>
          </section>

          <hr className="border-gray-200" />

          {/* Section 10: Contact */}
          <section>
            <h2 className="text-2xl font-semibold text-gray-900 mb-4">10. Contact</h2>
            <div className="space-y-4 text-gray-700 leading-relaxed">
              <p>If you have any questions about these Terms, please contact us at:</p>
              <p className="flex items-center gap-2">
                <span>📧</span>
                <a
                  href="mailto:team@inhockia.com"
                  className="text-[#8026FA] hover:text-[#924CEC] transition-colors"
                >
                  team@inhockia.com
                </a>
              </p>
            </div>
          </section>

          {/* Last Updated */}
          <div className="pt-8 border-t border-gray-200">
            <p className="text-sm text-gray-500 text-center">Last updated: November 2, 2025</p>
          </div>
        </div>
      </div>
    </div>
  )
}
