import { Shield, ArrowLeft } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

export default function PrivacyPolicy() {
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
            <div className="w-12 h-12 bg-blue-50 rounded-xl flex items-center justify-center flex-shrink-0">
              <Shield className="w-6 h-6 text-blue-600" />
            </div>
            <div>
              <h1 className="text-3xl font-bold text-gray-900 mb-2">Privacy Policy</h1>
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
                Welcome to HOCKIA ("we", "us", "our"). We respect your privacy and are committed to
                protecting your personal data. This Privacy Policy explains how we collect, use, and
                safeguard your information when you use our platform and related services.
              </p>
              <p>By using HOCKIA, you agree to the terms of this Privacy Policy.</p>
            </div>
          </section>

          <hr className="border-gray-200" />

          {/* Section 2: Information We Collect */}
          <section>
            <h2 className="text-2xl font-semibold text-gray-900 mb-4">2. Information We Collect</h2>
            <div className="space-y-4 text-gray-700 leading-relaxed">
              <p>
                We collect information to provide a better experience and improve our services. This
                may include:
              </p>
              <ul className="list-none space-y-3 ml-4">
                <li>
                  <strong>Account information:</strong> name, email address, and role (player, coach,
                  or club).
                </li>
                <li>
                  <strong>Profile information:</strong> photo, bio, and location (if you choose to
                  provide them).
                </li>
                <li>
                  <strong>Usage data:</strong> pages visited, device information, browser type, and
                  session duration.
                </li>
                <li>
                  <strong>Communications:</strong> messages sent through the platform or via support.
                </li>
              </ul>
              <p className="font-medium">We do not sell or rent your personal data.</p>
            </div>
          </section>

          <hr className="border-gray-200" />

          {/* Section 3: How We Use Your Information */}
          <section>
            <h2 className="text-2xl font-semibold text-gray-900 mb-4">
              3. How We Use Your Information
            </h2>
            <div className="space-y-4 text-gray-700 leading-relaxed">
              <p>We use your information to:</p>
              <ul className="list-none space-y-3 ml-4">
                <li>• Operate and maintain the HOCKIA platform.</li>
                <li>• Enable login, profile creation, and communication between users.</li>
                <li>• Improve the platform experience and fix issues.</li>
                <li>• Respond to support requests.</li>
                <li>• Send occasional service updates (never spam).</li>
              </ul>
            </div>
          </section>

          <hr className="border-gray-200" />

          {/* Section 4: Data Sharing and Storage */}
          <section>
            <h2 className="text-2xl font-semibold text-gray-900 mb-4">
              4. Data Sharing and Storage
            </h2>
            <div className="space-y-4 text-gray-700 leading-relaxed">
              <p>
                We store your data securely using Supabase and industry-standard encryption. We only
                share data when necessary to:
              </p>
              <ul className="list-none space-y-3 ml-4">
                <li>• Provide core functionality (e.g., authentication, hosting).</li>
                <li>• Comply with legal obligations.</li>
                <li>• Prevent abuse or misuse of the platform.</li>
              </ul>
              <p className="font-medium">
                We do not share user data with advertisers or unrelated third parties.
              </p>
            </div>
          </section>

          <hr className="border-gray-200" />

          {/* Section 5: Your Rights */}
          <section>
            <h2 className="text-2xl font-semibold text-gray-900 mb-4">5. Your Rights</h2>
            <div className="space-y-4 text-gray-700 leading-relaxed">
              <p>You can:</p>
              <ul className="list-none space-y-3 ml-4">
                <li>• Access, edit, or delete your profile data anytime from Settings.</li>
                <li>• Request permanent account deletion.</li>
                <li>• Contact us for any privacy concerns at team@inhockia.com.</li>
              </ul>
            </div>
          </section>

          <hr className="border-gray-200" />

          {/* Section 6: Cookies and Analytics */}
          <section>
            <h2 className="text-2xl font-semibold text-gray-900 mb-4">6. Cookies and Analytics</h2>
            <div className="space-y-4 text-gray-700 leading-relaxed">
              <p>
                HOCKIA uses limited cookies or local storage to maintain your session and improve
                navigation. We do not use invasive tracking tools or third-party ads.
              </p>
            </div>
          </section>

          <hr className="border-gray-200" />

          {/* Section 7: Data Retention */}
          <section>
            <h2 className="text-2xl font-semibold text-gray-900 mb-4">7. Data Retention</h2>
            <div className="space-y-4 text-gray-700 leading-relaxed">
              <p>
                We retain your data only as long as necessary to provide our services. Once your
                account is deleted, your personal data is permanently removed from our servers.
              </p>
            </div>
          </section>

          <hr className="border-gray-200" />

          {/* Section 8: Changes to This Policy */}
          <section>
            <h2 className="text-2xl font-semibold text-gray-900 mb-4">8. Changes to This Policy</h2>
            <div className="space-y-4 text-gray-700 leading-relaxed">
              <p>
                We may update this Privacy Policy occasionally. Any major changes will be announced
                within the app or via email.
              </p>
            </div>
          </section>

          <hr className="border-gray-200" />

          {/* Section 9: Contact */}
          <section>
            <h2 className="text-2xl font-semibold text-gray-900 mb-4">9. Contact</h2>
            <div className="space-y-4 text-gray-700 leading-relaxed">
              <p>If you have any questions or requests regarding privacy, please contact:</p>
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
